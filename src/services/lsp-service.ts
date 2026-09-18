import * as vscode from "vscode";
import { BoundedCache, buildCacheKey } from "../cache/bounded-cache";
import { getConfig } from "./configuration-service";

interface DefinitionTarget {
  uri: vscode.Uri;
  range: vscode.Range;
}

type RawTypeHierarchyItems =
  | vscode.TypeHierarchyItem
  | vscode.TypeHierarchyItem[];

export class LSPService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private cache: BoundedCache<unknown>;
  private currentMaxEntries: number;

  constructor() {
    const configService = getConfig();
    this.currentMaxEntries = configService.lspCacheMaxEntries;
    this.cache = new BoundedCache<unknown>(this.currentMaxEntries);

    this.disposables.push(
      configService.onConfigChange((config) => {
        if (config.lspCacheMaxEntries !== this.currentMaxEntries) {
          this.currentMaxEntries = config.lspCacheMaxEntries;
          this.cache = new BoundedCache<unknown>(this.currentMaxEntries);
        }
      }),
    );

    this.registerListeners();
  }

  private registerListeners() {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.cache.invalidateGroup(event.document.uri.toString());
      }),

      vscode.workspace.onDidCloseTextDocument((document) => {
        this.cache.invalidateGroup(document.uri.toString());
      }),
    );
  }

  async getDocumentSymbols(
    document: vscode.TextDocument,
  ): Promise<vscode.DocumentSymbol[]> {
    const documentUri = document.uri.toString();

    const cacheKey = buildCacheKey(documentUri, "documentSymbols");

    const cached = this.cache.get(cacheKey);

    if (cached) {
      return cached as vscode.DocumentSymbol[];
    }
    try {
      const symbolsList = await vscode.commands.executeCommand<
        vscode.DocumentSymbol[]
      >("vscode.executeDocumentSymbolProvider", document.uri);

      this.cache.set(cacheKey, symbolsList, {
        groupKey: documentUri,
      });
      return symbolsList ?? [];
    } catch (error) {
      return [];
    }
  }

  async getSuperTypeName(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<string[]> {
    const documentUri = document.uri.toString();

    const cacheKey = buildCacheKey(
      documentUri,
      "superTypeName",
      `${position.line}:${position.character}`,
    );

    const cached = this.cache.get(cacheKey);

    if (cached !== undefined) {
      return cached as string[];
    }

    try {
      const prepared =
        await vscode.commands.executeCommand<RawTypeHierarchyItems>(
          "vscode.prepareTypeHierarchy",
          document.uri,
          position,
        );

      if (!prepared) {
        return [];
      }

      const roots: DefinitionTarget[] = Array.isArray(prepared)
        ? prepared
        : [prepared];

      const superTypeResults = await Promise.allSettled(
        roots.map((item) =>
          vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
            "vscode.provideSuperTypes",
            item, // TypeHierarchyItem
          ),
        ),
      );

      const names: string[] = [];

      for (const result of superTypeResults) {
        if (result.status === "fulfilled" && result.value) {
          for (const item of result.value) {
            names.push(item.name);
          }
        }
      }

      const uniqueNames = Array.from(new Set(names));

      this.cache.set(cacheKey, uniqueNames, {
        groupKey: documentUri,
      });

      return uniqueNames;
    } catch (error) {
      return [];
    }
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.cache.clear();
  }
}
