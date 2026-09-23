import { BoundedCache, buildCacheKey } from "../../cache/bounded-cache";
import { IndexedSymbol } from "../../utils/types";
import * as vscode from "vscode";
import { ASTService } from "../ast/ast-service";
import { extractSignatureFromAST } from "../ast/ast-analysis";

export class SignatureProvider {
  private readonly signatureCache: BoundedCache<string>;

  constructor(private readonly astService: ASTService) {
    this.signatureCache = new BoundedCache(1000);
  }

  async extract(symbols: IndexedSymbol[]): Promise<IndexedSymbol[]> {
    const result: IndexedSymbol[] = [];

    for (const symbol of symbols) {
      const signature = await this.extractSignature(symbol);

      if (!signature) {
        continue;
      }

      result.push({
        ...symbol,
        signature,
      });
    }

    return result;
  }

  private async extractSignature(
    symbol: IndexedSymbol,
  ): Promise<string | undefined> {
    const cachedKey = buildCacheKey(
      "signatureProvider",
      symbol.uri,
      symbol.kind,
      symbol.name,
      symbol.range.startLine,
      symbol.range.startCharacter,
      symbol.range.endLine,
      symbol.range.endCharacter,
    );

    const cachedSignature = this.signatureCache.get(cachedKey);
    if (cachedSignature !== undefined) {
      return cachedSignature;
    }

    const uri = vscode.Uri.parse(symbol.uri);

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return undefined; // file deleted/renamed since it was indexed
    }

    const range = new vscode.Range(
      symbol.range.startLine,
      symbol.range.startCharacter,
      symbol.range.endLine,
      symbol.range.endCharacter,
    );

    const fullText = document.getText(range);

    const signature = this.astService.withParseTree(fullText, (tree) =>
      extractSignatureFromAST(tree, symbol.kind),
    );

    if (signature) {
      this.signatureCache.set(cachedKey, signature, {
        groupKey: symbol.uri,
      });
      return signature;
    } else {
      return undefined;
    }
  }
}
