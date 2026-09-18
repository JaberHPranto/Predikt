import { EnclosingScope } from "../../utils/types";
import { LSPService } from "../lsp-service";
import * as vscode from "vscode";

// Only works for local dependencies of Class
export class LocalDependencyResolver {
  constructor(private readonly lspService: LSPService) {}

  async collectSameFileDependencies(
    document: vscode.TextDocument,
    position: vscode.Position,
    scopes: EnclosingScope,
    usedIdentifiers: Set<string>,
  ): Promise<string[]> {
    //   Phase 1: Finding out base class - for example: class Dog extends Animal
    let output: string[] = [];
    const includedSymbols = new Set<string>();

    if (scopes.enclosingClass) {
      const classStartLine = scopes.enclosingClass.range.start.line;
      const classNamePosition = scopes.enclosingClass.selectionRange.start;
      const baseNames = await this.lspService.getSuperTypeName(
        document,
        classNamePosition,
      );

      for (const baseName of baseNames) {
        if (includedSymbols.has(baseName)) {
          continue;
        }

        const baseSymbol = this.findNearestSymbolBeforeLine(
          scopes.symbolByNames,
          baseName,
          classStartLine,
        );
        if (!baseSymbol) {
          continue;
        }

        output.push("");
        output.push(...this.getSymbolLines(document, baseSymbol));

        includedSymbols.add(baseName);
      }
    }

    // Phase 2: Finding out any class, interface or enum with that name defined earlier in this file

    for (const identifier of usedIdentifiers) {
      if (includedSymbols.has(identifier)) {
        continue;
      }

      const symbol = this.findNearestSymbolBeforeLine(
        scopes.symbolByNames,
        identifier,
        position.line,
      );

      if (symbol) {
        output.push("");
        output.push(...this.getSymbolLines(document, symbol));
        includedSymbols.add(identifier);
      }
    }

    return output;
  }

  private findNearestSymbolBeforeLine(
    symbolsByName: Map<string, vscode.DocumentSymbol[]>,
    name: string,
    lineExclusive: number,
  ): vscode.DocumentSymbol | null {
    const candidates = symbolsByName.get(name);

    if (!candidates || candidates.length === 0) {
      return null;
    }

    let best = null;

    for (const candidate of candidates) {
      // unrelated/irrelevant symbol (comes after current class) - skip
      if (
        candidate.range.end.line >= lineExclusive ||
        !this.isClassSymbol(candidate.kind)
      ) {
        continue;
      }

      // picking the symbol with the longest range  (nearest)
      if (!best || candidate.range.end.line > best.range.end.line) {
        best = candidate;
      }
    }

    return best;
  }

  private getSymbolLines(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
  ): string[] {
    const lines: string[] = [];

    for (
      let line = symbol.range.start.line;
      line <= symbol.range.end.line;
      line++
    ) {
      const lineText = document.lineAt(line).text;
      lines.push(lineText);
    }

    return lines;
  }

  private isClassSymbol(kind: vscode.SymbolKind): boolean {
    return (
      kind === vscode.SymbolKind.Class ||
      kind === vscode.SymbolKind.Interface ||
      kind === vscode.SymbolKind.Struct ||
      kind === vscode.SymbolKind.Enum
    );
  }
}
