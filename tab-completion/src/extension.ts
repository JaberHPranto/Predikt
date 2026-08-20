import * as vscode from "vscode";
import { InlineCompletionProvider } from "./providers/inline-completion-provider";

let inlineCompletionProvider: InlineCompletionProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("Predikt");

  inlineCompletionProvider = new InlineCompletionProvider(outputChannel);
  const disposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" }, // Match all files
    inlineCompletionProvider,
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
