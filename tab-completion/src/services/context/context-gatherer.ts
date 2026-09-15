import * as vscode from "vscode";
import { IntentTracker } from "../intent-tracker";
import { PrefixStage } from "./stages/prefix-stage";
import { LSPService } from "../lsp-service";

export class ContextGatherer implements vscode.Disposable {
  private readonly intentTracker: IntentTracker;
  private readonly prefixStage: PrefixStage;
  private readonly lspService: LSPService;

  constructor(intentTracker: IntentTracker) {
    this.intentTracker = intentTracker;
    this.lspService = new LSPService();
    this.prefixStage = new PrefixStage(this.lspService);
  }

  async gatherContext(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<string> {
    const editHistory = this.intentTracker.serialize();

    const prefix = await this.prefixStage.buildPrefix(document, position);
    return prefix ?? "";
  }

  dispose() {
    // no-op to dispose of, but we implement this to
    // satisfy the vscode.Disposable interface
  }
}
