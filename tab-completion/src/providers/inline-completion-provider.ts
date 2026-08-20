import * as vscode from "vscode";

export class InlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
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

      const newItem = new vscode.InlineCompletionItem("console.log();");

      return { items: [newItem] };
    } catch (error) {
      this.log(
        `Error occurred while providing inline completion items: ${error}`,
      );
      return null;
    }
  }
}
