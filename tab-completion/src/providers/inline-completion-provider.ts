import * as vscode from "vscode";
import { LLMClient } from "../client/llm-client";
import { ChatMessage } from "../utils/types";

export class InlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly outputChannel: vscode.OutputChannel;
  private readonly llmClient: LLMClient;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.llmClient = new LLMClient(outputChannel);
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[InlineCompletionProvider] ${message}`);
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

      const prefix = document.getText(
        new vscode.Range(new vscode.Position(0, 0), position),
      );

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

      const newItem = new vscode.InlineCompletionItem(completion);

      return { items: [newItem] };
    } catch (error) {
      this.log(
        `Error occurred while providing inline completion items: ${error}`,
      );
      return null;
    }
  }
}
