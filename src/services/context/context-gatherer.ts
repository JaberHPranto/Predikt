import * as vscode from "vscode";
import { IntentTracker } from "../intent-tracker";
import { PrefixStage } from "./stages/prefix-stage";
import { LSPService } from "../lsp-service";
import { ReplacementRegionStage } from "./replacement-region-stage";
import { ASTService } from "../ast/ast-service";

export class ContextGatherer implements vscode.Disposable {
  private readonly intentTracker: IntentTracker;
  private readonly prefixStage: PrefixStage;
  private readonly lspService: LSPService;
  private readonly replacementRegionStage: ReplacementRegionStage;

  constructor(astService: ASTService, intentTracker: IntentTracker) {
    this.intentTracker = intentTracker;
    this.lspService = new LSPService();
    this.prefixStage = new PrefixStage(this.lspService);
    this.replacementRegionStage = new ReplacementRegionStage(astService);
  }

  async gatherContext(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<string> {
    const replacementRegion = this.replacementRegionStage.compute(
      document,
      position,
    );

    const prefix = await this.prefixStage.buildPrefix(document, position);

    const editHistory = this.intentTracker.serialize();

    return replacementRegion.text ?? "";
  }

  dispose() {
    // no-op to dispose of, but we implement this to
    // satisfy the vscode.Disposable interface
  }
}
