import * as vscode from "vscode";
import { IntentTracker } from "../intent-tracker";
import { PrefixStage } from "./stages/prefix-stage";
import { LSPService } from "../lsp-service";

import { ASTService } from "../ast/ast-service";
import { ReplacementRegionStage } from "./stages/replacement-region-stage";
import { SuffixStage } from "./stages/suffix-stage";

export class ContextGatherer implements vscode.Disposable {
  private readonly intentTracker: IntentTracker;
  private readonly prefixStage: PrefixStage;
  private readonly lspService: LSPService;
  private readonly replacementRegionStage: ReplacementRegionStage;
  private readonly suffixStage: SuffixStage;

  constructor(astService: ASTService, intentTracker: IntentTracker) {
    this.intentTracker = intentTracker;
    this.lspService = new LSPService();
    this.prefixStage = new PrefixStage(this.lspService);
    this.suffixStage = new SuffixStage();
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

    const prefix = await this.prefixStage.buildPrefix(
      document,
      replacementRegion.range.end,
    );

    const suffix = this.suffixStage.buildSuffixAfterRegion(document, position);

    const editHistory = this.intentTracker.serialize();

    return suffix ?? "";
  }

  dispose() {
    // no-op to dispose of, but we implement this to
    // satisfy the vscode.Disposable interface
  }
}
