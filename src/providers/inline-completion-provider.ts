import * as vscode from "vscode";
import { LLMClient } from "../client/llm-client";
import {
  ChatMessage,
  PendingCompletion,
  ReplacementEdit,
} from "../utils/types";
import { IntentTracker } from "../services/intent-tracker";
import { CompletionCache } from "../cache/completion-cache";
import { ContextGatherer } from "../services/context/context-gatherer";
import { ASTService } from "../services/ast/ast-service";

export class InlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly outputChannel: vscode.OutputChannel;
  private readonly llmClient: LLMClient;
  private readonly intentTracker: IntentTracker;
  private readonly completionCache: CompletionCache;
  private readonly contextGatherer: ContextGatherer;

  // what llm last gave to the user
  private pendingCompletion: PendingCompletion | null = null;

  // what vscode/extension last gave to the user
  private lastCompletionText = "";
  private lastCompletionPosition: vscode.Position | null = null;
  private lastCompletionUri = "";

  constructor(astService: ASTService, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.llmClient = new LLMClient(outputChannel);
    this.intentTracker = new IntentTracker();
    this.completionCache = new CompletionCache();
    this.contextGatherer = new ContextGatherer(astService, this.intentTracker);
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | null> {
    try {
      this.log(
        `provideInlineCompletion called at position: ${position.line}:${position.character}`,
      );

      // Stage 1: Pending completion
      const pendingCompletionResult = this.handlePendingCompletion(
        document,
        position,
      );

      if (pendingCompletionResult !== undefined) {
        return pendingCompletionResult;
      }

      // Stage 2: Cache Completion/Lookup
      const editHistoryHash = this.intentTracker.computeHash();
      const cacheCompletionResult = this.tryCacheCompletion(
        document,
        position,
        editHistoryHash,
      );

      if (cacheCompletionResult !== undefined) {
        return cacheCompletionResult;
      }

      // Stage 3: Continue prediction
      const continuePredictionResult = this.tryContinuePrediction(
        document,
        position,
      );

      if (continuePredictionResult !== undefined) {
        return continuePredictionResult;
      }

      if (token.isCancellationRequested) {
        this.log("Request cancelled");
        return null;
      }

      const prefix = await this.contextGatherer.gatherContext(
        document,
        position,
      );

      this.log(`Prefix: ${prefix}`);

      const messages: ChatMessage[] = [
        {
          role: "system",
          content:
            "You are a code completion engine. Continue the code exactly at the cursor. Output only the raw continuation: no markdown fences, no repetition of existing code, no explanation.",
        },
        { role: "user", content: prefix },
      ];

      let completion = "";
      try {
        const generator = await this.llmClient.complete(messages);

        for await (const chunk of generator) {
          if (token.isCancellationRequested) {
            this.llmClient.cancelRequest();
            break;
          }
          completion += chunk;
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          this.log(
            `Error occurred while providing inline completion items: ${error}`,
          );
        }
        return null;
      }

      // Remove markdown fences
      completion = completion
        .replace(/^```[a-z]*\n?/, "")
        .replace(/```\s*$/, "");
      this.log(
        `completion (${completion.length} chars): ${JSON.stringify(completion.slice(0, 120))}`,
      );
      if (!completion.trim()) {
        return null;
      }

      const replacementEdit: ReplacementEdit = {
        startPosition: position,
        insertText: completion,
      };

      this.completionCache.set(
        document,
        position,
        editHistoryHash,
        replacementEdit,
      );

      this.activateCompletion(replacementEdit, document);

      return this.createInlineCompletionList(completion);
    } catch (error) {
      this.log(
        `Error occurred while providing inline completion items: ${error}`,
      );
      return null;
    }
  }

  private activateCompletion(
    edit: ReplacementEdit,
    document: vscode.TextDocument,
  ): void {
    this.lastCompletionText = edit.insertText;
    this.lastCompletionPosition = edit.startPosition;
    this.lastCompletionUri = document.uri.toString();

    this.pendingCompletion = {
      documentUri: document.uri.toString(),
      edit: {
        startPosition: edit.startPosition,
        insertText: edit.insertText,
      },
    };
  }

  private tryCacheCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    editHistoryHash: string,
  ): vscode.InlineCompletionList | undefined {
    const cachedEdit = this.completionCache.get(
      document,
      position,
      editHistoryHash,
    );

    if (!cachedEdit) {
      return undefined;
    }

    this.log(
      `Cache hit for document ${document.uri.toString()} at position ${position.line}:${position.character}`,
    );

    this.activateCompletion(cachedEdit, document);
    return this.createInlineCompletionList(cachedEdit.insertText);
  }

  private tryContinuePrediction(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.InlineCompletionList | null | undefined {
    if (
      !this.lastCompletionPosition ||
      !this.lastCompletionText ||
      this.lastCompletionUri !== document.uri.toString()
    ) {
      return undefined;
    }

    if (position.line !== this.lastCompletionPosition.line) {
      return undefined;
    }

    // character offset
    const charSinceLastCompletion =
      position.character - this.lastCompletionPosition.character;

    //  not forwarding typing
    if (charSinceLastCompletion <= 0) {
      return undefined;
    }

    // user's typing
    const typedText = document.getText(
      new vscode.Range(this.lastCompletionPosition, position),
    );

    // user is typing the same thing
    if (
      charSinceLastCompletion <= this.lastCompletionText.length &&
      this.lastCompletionText.startsWith(typedText)
    ) {
      const remaining = this.lastCompletionText.slice(typedText.length);
      if (remaining) {
        this.log(
          `Continuing prediction: typed "${typedText}", remaining "${remaining}"`,
        );
        return this.createInlineCompletionList(
          remaining,
          new vscode.Range(position, position),
        );
      }

      this.log("User completed entire prediction");
      this.lastCompletionText = "";
      this.lastCompletionPosition = null;
      return null;
    }

    this.log(
      `Divergence detected: expected ${this.lastCompletionText}, got ${typedText}`,
    );
    this.lastCompletionText = "";
    this.lastCompletionPosition = null;
    return undefined;
  }

  private handlePendingCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.InlineCompletionList | null | undefined {
    if (!this.pendingCompletion) {
      return undefined;
    }

    const pendingDocumentUri = this.pendingCompletion.documentUri;
    const pendingPosition = this.pendingCompletion.edit.startPosition;

    if (pendingDocumentUri !== document.uri.toString()) {
      this.handleClearCompletion();
      return undefined;
    }

    if (pendingPosition.line !== position.line) {
      this.handleClearCompletion();
      return undefined;
    }

    if (pendingPosition.character === position.character) {
      this.log("provideInlineCompletionItems called with pending completion");
      return this.createInlineCompletionList(
        this.pendingCompletion.edit.insertText,
      );
    }

    this.handleClearCompletion();
    return undefined;
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[InlineCompletionProvider] ${message}`);
  }

  private createInlineCompletionList(
    text: string,
    range?: vscode.Range,
  ): vscode.InlineCompletionList {
    const newItem = new vscode.InlineCompletionItem(text, range);

    return { items: [newItem] };
  }

  private handleClearCompletion(): void {
    this.pendingCompletion = null;
  }
}
