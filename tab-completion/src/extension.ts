import * as vscode from "vscode";
import { InlineCompletionProvider } from "./providers/inline-completion-provider";
import { ASTService } from "./services/ast-service";

let inlineCompletionProvider: InlineCompletionProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let astService: ASTService | undefined;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Predikt");
  outputChannel.appendLine("Predikt extension activated.");

  astService = new ASTService(context.extensionPath);
  astService.initialize().then(() => {
    outputChannel?.appendLine("AST service initialized.");

    // preload AST (language) for active editor
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      astService?.ensureLanguage(activeEditor.document.languageId);
    }
  });

  // load AST (language) whenever editor changes
  vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && astService?.isReady) {
      astService?.ensureLanguage(editor.document.languageId);
    }
  });

  inlineCompletionProvider = new InlineCompletionProvider(outputChannel);
  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    // match all files irrespective of language
    { pattern: "**" },
    inlineCompletionProvider,
  );

  context.subscriptions.push(disposable, outputChannel);
}

export function deactivate() {}
