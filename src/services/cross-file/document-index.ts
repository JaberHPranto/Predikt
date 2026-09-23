import * as vscode from "vscode";
import { LSPService } from "../lsp-service";
import { BoundedCache, buildCacheKey } from "../../cache/bounded-cache";
import { IndexedSymbol } from "../../utils/types";
export class DocumentIndex {
  private readonly cache: BoundedCache<{
    version: number;
    symbols: IndexedSymbol[];
  }>;
  private trackedUris: Set<string>;

  constructor(private readonly lspService: LSPService) {
    this.cache = new BoundedCache(1000);
    this.trackedUris = new Set();
  }

  getAllSymbols(): IndexedSymbol[] {
    const result: IndexedSymbol[] = [];
    for (const uri of this.trackedUris) {
      const entry = this.cache.get(buildCacheKey("documentIndex", uri));
      if (!entry) {
        this.trackedUris.delete(uri);
        continue;
      }
      if (entry.symbols.length > 0) {
        result.push(...entry.symbols);
      }
    }

    return result;
  }

  async indexDocument(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== "file") {
      return;
    }

    const uri = document.uri.toString();
    const cacheKey = buildCacheKey("documentIndex", uri);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.version === document.version) {
      return;
    }

    const symbols = await this.lspService.getDocumentSymbols(document);
    const indexedSymbols = this.extractSymbols(symbols, uri);

    this.cache.set(
      cacheKey,
      { version: document.version, symbols: indexedSymbols },
      {
        groupKey: uri,
      },
    );

    this.trackedUris.add(uri);
  }

  private extractSymbols(
    symbols: vscode.DocumentSymbol[],
    uri: string,
    containerName?: string,
  ): IndexedSymbol[] {
    const result: IndexedSymbol[] = [];

    for (const symbol of symbols) {
      if (this.isRelevantSymbolKind(symbol.kind)) {
        result.push({
          name: symbol.name,
          kind: symbol.kind,
          containerName,
          uri,
          range: {
            startLine: symbol.range.start.line,
            startCharacter: symbol.range.start.character,
            endLine: symbol.range.end.line,
            endCharacter: symbol.range.end.character,
          },
        });
      }

      if (symbol.children && symbol.children.length > 0) {
        const childContainer = containerName
          ? `${containerName}.${symbol.name}`
          : symbol.name;
        result.push(
          ...this.extractSymbols(symbol.children, uri, childContainer),
        );
      }
    }

    return result;
  }

  private isRelevantSymbolKind(kind: vscode.SymbolKind): boolean {
    return [
      vscode.SymbolKind.Class,
      vscode.SymbolKind.Interface,
      vscode.SymbolKind.Enum,
      vscode.SymbolKind.Function,
      vscode.SymbolKind.Method,
      vscode.SymbolKind.Property,
      vscode.SymbolKind.Constant,
      vscode.SymbolKind.TypeParameter,
      vscode.SymbolKind.Struct,
    ].includes(kind);
  }

  clear(): void {
    this.cache.clear();
    this.trackedUris.clear();
  }
}
