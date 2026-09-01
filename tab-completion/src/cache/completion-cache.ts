import * as vscode from "vscode";
import * as crypto from "crypto";
import { BoundedCache, buildCacheKey } from "./bounded-cache";
import { ReplacementEdit } from "../utils/types";
import { getConfig } from "../services/configuration-service";

export class CompletionCache implements vscode.Disposable {
  private cache: BoundedCache<ReplacementEdit>;
  private readonly disposables: vscode.Disposable[] = [];
  private ttlMs: number;
  private currentMaxEntries: number;
  private contentHashByDocument: Map<
    string,
    { hash: string; version: number }
  > = new Map();

  constructor() {
    const configService = getConfig();
    this.ttlMs = configService.completionCacheTtlMs;
    this.currentMaxEntries = configService.completionCacheMaxEntries;

    this.cache = new BoundedCache<ReplacementEdit>(this.currentMaxEntries);

    this.disposables.push(
      configService.onConfigChange((config) => {
        if (config.completionCacheMaxEntries !== this.currentMaxEntries) {
          this.currentMaxEntries = config.completionCacheMaxEntries;
          this.cache = new BoundedCache<ReplacementEdit>(
            this.currentMaxEntries,
          );
        }

        if (config.completionCacheTtlMs !== this.ttlMs) {
          this.ttlMs = config.completionCacheTtlMs;
        }
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        const documentUri = document.uri.toString();

        this.cache.invalidateGroup(documentUri);
        this.contentHashByDocument.delete(documentUri);
      }),
    );
  }

  computeHash(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
  }

  private getContentHash(document: vscode.TextDocument): string {
    const uri = document.uri.toString();

    const cached = this.contentHashByDocument.get(uri);
    if (cached && cached.version === document.version) {
      return cached.hash;
    }

    const content = document.getText();
    const hash = this.computeHash(content);
    this.contentHashByDocument.set(uri, { hash, version: document.version });
    return hash;
  }

  get(
    document: vscode.TextDocument,
    position: vscode.Position,
    editHistoryHash: string,
  ): ReplacementEdit | undefined {
    const documentUri = document.uri.toString();
    const contentHash = this.getContentHash(document);

    const key = buildCacheKey(
      documentUri,
      position.line,
      position.character,
      contentHash,
      editHistoryHash,
    );

    return this.cache.get(key);
  }

  // this set going to talk to vscode editor
  set(
    document: vscode.TextDocument,
    position: vscode.Position,
    editHistoryHash: string,
    completion: ReplacementEdit,
  ): void {
    const documentUri = document.uri.toString();
    const contentHash = this.getContentHash(document);

    const key = buildCacheKey(
      documentUri,
      position.line,
      position.character,
      contentHash,
      editHistoryHash,
    );

    this.cache.set(key, completion, {
      ttlMs: this.ttlMs,
      groupKey: documentUri,
    });
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.cache.clear();
    this.contentHashByDocument.clear();
  }
}
