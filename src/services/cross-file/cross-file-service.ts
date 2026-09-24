import * as vscode from "vscode";
import { LSPService } from "../lsp-service";
import { ASTService } from "../ast/ast-service";
import { DocumentIndex } from "./document-index";
import { IndexedSymbol } from "../../utils/types";
import { ReferenceExtractor } from "./reference-extractor";
import { SignatureProvider } from "./signature-provider";

export class CrossFileService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lspService: LSPService;
  private readonly astService: ASTService;
  private readonly documentIndex: DocumentIndex;
  private readonly referenceExtractor: ReferenceExtractor;
  private readonly signatureProvider: SignatureProvider;

  constructor(lspService: LSPService, astService: ASTService) {
    this.lspService = lspService;
    this.astService = astService;
    this.documentIndex = new DocumentIndex(lspService);
    this.referenceExtractor = new ReferenceExtractor(astService);
    this.signatureProvider = new SignatureProvider(astService);

    this.registerListeners();
  }

  private registerListeners() {
    (this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.documentIndex.indexDocument(document);
      }),
    ),
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.documentIndex.indexDocument(document);
      }));
  }

  async getRelevantSymbols(
    document: vscode.TextDocument,
    prefix: string,
  ): Promise<IndexedSymbol[]> {
    const nearByContext = await this.referenceExtractor.extract(
      prefix,
      document.languageId,
    );

    if (nearByContext.referenceNames.size === 0) {
      return [];
    }

    const allSymbols = this.documentIndex.getAllSymbols();

    const candidateSymbols = allSymbols.filter(
      (symbol) =>
        // exclude current document
        symbol.uri !== document.uri.toString() &&
        !nearByContext.declaredIdentifiers.has(symbol.name),
    );

    const referenceCandidateSymbols = candidateSymbols.filter(
      (symbol) =>
        nearByContext.nearByIdentifiers.has(symbol.name) &&
        symbol.kind !== vscode.SymbolKind.Constructor, // many language have constructor with the same name as class
    );

    if (referenceCandidateSymbols.length === 0) {
      return [];
    }

    const result = await this.signatureProvider.extract(
      referenceCandidateSymbols,
    );

    return result;
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.signatureProvider.clear();
    this.documentIndex.clear();
  }
}
