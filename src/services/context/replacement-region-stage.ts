import {
  REGION_CHARACTER_LIMIT,
  REGION_LINE_LIMIT,
} from "../../utils/constants";
import { ReplacementRegion } from "../../utils/types";
import { findStatementEnd } from "../ast/ast-analysis";
import { ASTService } from "../ast/ast-service";
import * as vscode from "vscode";

export class ReplacementRegionStage {
  constructor(private readonly astService: ASTService) {}

  compute(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): ReplacementRegion {
    const currentLineText = document.lineAt(position.line).text;
    let textAfterCursor = currentLineText.slice(position.character);

    let endLine = position.line;
    let endChar = currentLineText.length;

    const shouldTryExtension = this.shouldTryExtension(textAfterCursor);

    if (shouldTryExtension && textAfterCursor.length < REGION_CHARACTER_LIMIT) {
      const extendedStatement = this.extendToStatementEnd(
        document,
        position,
        REGION_CHARACTER_LIMIT - textAfterCursor.length,
        REGION_LINE_LIMIT,
      );

      if (extendedStatement) {
        textAfterCursor = extendedStatement.text;
        endLine = extendedStatement.endLine;
        endChar = extendedStatement.endChar;
      }
    }

    return {
      text: textAfterCursor,
      range: new vscode.Range(position, new vscode.Position(endLine, endChar)),
    };
  }

  private shouldTryExtension(textAfterCursor: string): boolean {
    const trimmedText = textAfterCursor.trim();

    if (trimmedText.length === 0) {
      return false;
    }

    // Case-1: balance bracket using regex
    const opens = (trimmedText.match(/[([{]/g) || []).length;
    const closes = (trimmedText.match(/[)\]}]/g) || []).length;

    if (opens > closes) {
      return true;
    }

    // Case-2: continuation operator
    const continuationEndings = [
      ",",
      "+",
      "-",
      "*",
      "/",
      "&&",
      "||",
      "|",
      "&",
      ".",
      "->",
      "\\",
      "=",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "&=",
      "|=",
      "^=",
      ">>=",
      "<<=",
      "**=",
      "//=",
      "...",
      "?",
      ":",
    ];

    for (const ending of continuationEndings) {
      if (trimmedText.endsWith(ending)) {
        return true;
      }
    }

    //Case 3 - too short & contains statement terminators
    if (trimmedText.length < 20) {
      const statementTerminators = [";", "{", "}", ":"];
      const endsWithTerminator = statementTerminators.some((terminator) =>
        trimmedText.endsWith(terminator),
      );
      if (!endsWithTerminator) {
        return true;
      }
    }

    return false;
  }

  private extendToStatementEnd(
    document: vscode.TextDocument,
    position: vscode.Position,
    maxChars: number,
    maxLines: number,
  ): { text: string; endLine: number; endChar: number } | null {
    const startLine = position.line;
    const endLine = Math.min(document.lineCount - 1, startLine + maxLines);

    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(document.lineAt(i).text);
    }

    const regionText = lines.join("\n");

    return this.astService.withParseTree(regionText, (tree) => {
      const result = findStatementEnd(tree, {
        row: 0,
        col: position.character,
      });

      if (!result) {
        return null;
      }

      const absoluteEndLine = startLine + result.endLine;
      const absoluteEndChar = result.endChar;

      let text = document.lineAt(startLine).text.slice(position.character);
      for (let i = startLine + 1; i <= absoluteEndLine; i++) {
        text += `\n${document.lineAt(i).text}`;
      }
      if (text.length > maxChars) {
        return null;
      }

      return {
        text,
        endLine: absoluteEndLine,
        endChar: absoluteEndChar,
      };
    });
  }
}
