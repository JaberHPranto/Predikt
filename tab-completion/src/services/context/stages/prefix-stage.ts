import * as vscode from "vscode";
import {
  FUNCTION_SETUP_LINE_LIMIT,
  LARGE_FUNCTION_LINE_LIMIT,
  PREFIX_LINE_LIMIT,
  RECENT_CONTEXT_LINE_LIMIT,
} from "../../../utils/constants";
import { LSPService } from "../../lsp-service";
import { EnclosingScope } from "../../../utils/types";
import {
  extractIdentifiers,
  getTruncationMarker,
} from "../../../utils/language-utils";
import {
  findImportLineSpans,
  parseImportBindings,
} from "../../../utils/import-analysis";
import { LocalDependencyResolver } from "../local-dependency-resolver";

export class PrefixStage {
  private readonly localDependencyResolver: LocalDependencyResolver;

  constructor(private readonly lspService: LSPService) {
    this.localDependencyResolver = new LocalDependencyResolver(this.lspService);
  }

  async buildPrefix(document: vscode.TextDocument, position: vscode.Position) {
    if (position.line <= PREFIX_LINE_LIMIT) {
      return this.getVerbatimPrefix(document, position);
    }

    const scope = await this.getEnclosingScope(document, position);

    if (!scope.enclosingFunction) {
      return this.buildSimplifiedPrefix(document, position);
    }

    const functionStartLine = scope.enclosingFunction.range.start.line;
    const lineFromStart = position.line - functionStartLine;

    const isLargeFunction = lineFromStart > LARGE_FUNCTION_LINE_LIMIT;

    return await this.buildScopedPrefix(
      document,
      position,
      scope,
      isLargeFunction,
    );
  }

  private async getEnclosingScope(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<EnclosingScope> {
    const symbols = await this.lspService.getDocumentSymbols(document);
    const symbolByName = new Map<string, vscode.DocumentSymbol[]>();

    let enclosingFunction: vscode.DocumentSymbol | null = null;
    let enclosingClass: vscode.DocumentSymbol | null = null;

    let functionDepth = -1;
    let classDepth = -1;

    const findEnclosing = (symbols: vscode.DocumentSymbol[], depth: number) => {
      for (const symbol of symbols) {
        const existing = symbolByName.get(symbol.name);
        if (existing) {
          existing.push(symbol);
          continue;
        }

        symbolByName.set(symbol.name, [symbol]);

        if (symbol.range.contains(position)) {
          if (this.isFunctionSymbol(symbol.kind) && depth >= functionDepth) {
            enclosingFunction = symbol;
            functionDepth = depth;
          }
          if (this.isClassSymbol(symbol.kind) && depth >= classDepth) {
            enclosingClass = symbol;
            classDepth = depth;
          }
        }

        if (symbol.children && symbol.children.length > 0) {
          findEnclosing(symbol.children, depth + 1);
        }
      }
    };

    findEnclosing(symbols, 0);

    return {
      enclosingFunction,
      enclosingClass,
      symbolByNames: symbolByName,
    };
  }

  private isFunctionSymbol(kind: vscode.SymbolKind): boolean {
    return (
      kind === vscode.SymbolKind.Function ||
      kind === vscode.SymbolKind.Method ||
      kind === vscode.SymbolKind.Constructor
    );
  }

  private isClassSymbol(kind: vscode.SymbolKind): boolean {
    return (
      kind === vscode.SymbolKind.Class ||
      kind === vscode.SymbolKind.Interface ||
      kind === vscode.SymbolKind.Struct ||
      kind === vscode.SymbolKind.Enum
    );
  }

  private async buildScopedPrefix(
    document: vscode.TextDocument,
    position: vscode.Position,
    scopes: EnclosingScope,
    isLargeFunction: boolean,
  ): Promise<string> {
    const cursorLine = position.line;
    const functionStartLine =
      scopes.enclosingFunction?.range.start.line ?? cursorLine;
    const classHeaderLines = this.collectClassHeaderLines(
      document,
      scopes,
      functionStartLine,
    );

    // For Small Function strategy
    if (!isLargeFunction) {
      const functionLines = this.collectLinesUptoCursor(
        document,
        functionStartLine,
        position,
      );

      const usedIdentifiers = extractIdentifiers(
        [...classHeaderLines, ...functionLines].join("\n"),
        document.languageId,
      );
      const usedImports = this.getUsedImports(document, usedIdentifiers);

      const sameFileDeps =
        await this.localDependencyResolver.collectSameFileDependencies(
          document,
          position,
          scopes,
          usedIdentifiers,
        );

      return this.assemblePrefixParts(
        usedImports,
        sameFileDeps,
        classHeaderLines,
        functionLines,
      ).join("\n");
    }

    // For Large Function strategy
    const functionSetupEnd = Math.min(
      functionStartLine + FUNCTION_SETUP_LINE_LIMIT,
      cursorLine,
    );

    const functionSetupLines = this.collectLinesUptoCursor(
      document,
      functionStartLine,
      new vscode.Position(functionSetupEnd + 1, 0),
    );

    const recentContextStart = Math.max(
      cursorLine - RECENT_CONTEXT_LINE_LIMIT,
      functionSetupEnd + 1,
    );

    const recentContextLines = this.collectLinesUptoCursor(
      document,
      recentContextStart,
      new vscode.Position(cursorLine + 1, 0), // +1 to include the cursor line to capture previous line full text
    );

    const usedIdentifiers = extractIdentifiers(
      [...classHeaderLines, ...functionSetupLines, ...recentContextLines].join(
        "\n",
      ),
      document.languageId,
    );
    const usedImports = this.getUsedImports(document, usedIdentifiers);

    const sameFileDeps =
      await this.localDependencyResolver.collectSameFileDependencies(
        document,
        position,
        scopes,
        usedIdentifiers,
      );

    const output = this.assemblePrefixParts(
      usedImports,
      sameFileDeps,
      classHeaderLines,
      functionSetupLines,
    );

    if (recentContextLines.length > 0) {
      const skippedLines = recentContextStart - functionSetupEnd;

      if (skippedLines > 0) {
        output.push(getTruncationMarker(document.languageId, skippedLines));
      }

      output.push(...recentContextLines);
    }

    return output.join("\n");
  }

  private collectClassHeaderLines(
    document: vscode.TextDocument,
    scopes: EnclosingScope,
    functionStartLine: number,
  ): string[] {
    const classStartLine = scopes.enclosingClass?.range.start.line;
    if (classStartLine === undefined || classStartLine >= functionStartLine) {
      return [];
    }

    const classHeaderEnd = this.findClassHeaderEnd(document, classStartLine);

    return this.collectLinesUptoCursor(
      document,
      classStartLine,
      new vscode.Position(classHeaderEnd + 1, 0),
    );
  }

  private findClassHeaderEnd(
    document: vscode.TextDocument,
    classStartLine: number,
  ): number {
    if (document.languageId === "python") {
      for (let i = classStartLine; i < document.lineCount; i++) {
        if (document.lineAt(i).text.includes(":")) {
          return i;
        }
      }
      return classStartLine;
    }

    for (
      let i = classStartLine;
      i < Math.min(classStartLine + 10, document.lineCount);
      i++
    ) {
      if (document.lineAt(i).text.includes("{")) {
        return i;
      }
    }

    return classStartLine;
  }

  private buildSimplifiedPrefix(
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    const cursorLine = position.line;
    const startLine = Math.max(0, cursorLine - PREFIX_LINE_LIMIT);

    const recentLines = this.collectLinesUptoCursor(
      document,
      startLine,
      position,
    );

    const usedIdentifiers = extractIdentifiers(
      recentLines.join("\n"),
      document.languageId,
    );
    const usedImports = this.getUsedImports(document, usedIdentifiers);

    return this.assemblePrefixParts(usedImports, [], [], recentLines).join(
      "\n",
    );
  }

  private getUsedImports(
    document: vscode.TextDocument,
    usedIdentifiers: Set<string>,
  ): string[] {
    if (usedIdentifiers.size === 0) {
      return [];
    }

    const importSpans = findImportLineSpans(
      document.getText(),
      document.languageId,
    );

    if (importSpans.length === 0) {
      return [];
    }

    const usedImports: string[] = [];

    for (const span of importSpans) {
      const importLines: string[] = [];

      for (let i = span.start; i <= span.end && i < document.lineCount; i++) {
        importLines.push(document.lineAt(i).text);
      }

      const importText = importLines.join("\n");

      // package statements are always included for go and java
      if (this.isAlwaysIncludedImportSpan(importLines, document.languageId)) {
        usedImports.push(...importLines);
        continue;
      }

      const bindings = parseImportBindings(importText, document.languageId);
      const providedNames = Array.from(bindings.importedLocalNames);
      const isUsed = providedNames.some((name) => usedIdentifiers.has(name));

      if (isUsed) {
        usedImports.push(...importLines);
      }
    }

    return usedImports;
  }

  private isAlwaysIncludedImportSpan(
    lines: string[],
    languageId: string,
  ): boolean {
    if (languageId !== "go" && languageId !== "java") {
      return false;
    }

    const firstNonEmptyLine = lines.find((line) => line.trim() !== "")?.trim();
    return firstNonEmptyLine?.startsWith("package ") ?? false;
  }

  private assemblePrefixParts(
    usedImports: string[],
    sameFileDeps: string[],
    classHeaderLins: string[],
    primaryLines: string[],
  ): string[] {
    const output: string[] = [];

    if (usedImports.length > 0) {
      output.push(...usedImports);
    }

    if (sameFileDeps.length > 0) {
      output.push(...sameFileDeps);
    }

    if (classHeaderLins.length > 0) {
      output.push(...classHeaderLins);
    }

    if (primaryLines.length > 0) {
      output.push(...primaryLines);
    }

    return output;
  }

  private getVerbatimPrefix(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): string {
    const prefix = this.collectLinesUptoCursor(document, 0, position);
    return prefix.join("\n");
  }

  private collectLinesUptoCursor(
    document: vscode.TextDocument,
    startLine: number,
    cursorPosition: vscode.Position,
  ): string[] {
    if (startLine < 0 || startLine > cursorPosition.line) {
      return [];
    }

    const lines: string[] = [];

    for (let line = startLine; line <= cursorPosition.line; line++) {
      const lineText = document.lineAt(line).text;
      lines.push(
        line === cursorPosition.line
          ? lineText.substring(0, cursorPosition.character)
          : lineText,
      );
    }

    return lines;
  }
}
