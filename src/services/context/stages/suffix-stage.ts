import * as vscode from "vscode";
import { REGION_LINE_LIMIT } from "../../../utils/constants";

//  Small window of code to help the AI knows
// what closers already exist so it doesn't regenerate them again
export class SuffixStage {
  buildSuffixAfterRegion(
    document: vscode.TextDocument,
    position: vscode.Position,
  ) {
    const output: string[] = [
      document.lineAt(position.line).text.slice(position.character),
    ];

    const startLine = position.line + 1;
    const endLine = Math.min(
      document.lineCount - 1,
      startLine + REGION_LINE_LIMIT - 1,
    );

    for (let i = startLine; i <= endLine; i++) {
      const lineText = document.lineAt(i).text;

      const trimmedLine = lineText.trim();
      if (trimmedLine.length === 0) {
        continue;
      } else if (trimmedLine.replace(/[{}\[\]()=;,.>]/g, "").trim() === "") {
        //   got a blank line after replacing brackets, semicolons, etc.
        output.push(lineText);
      } else {
        // have actual code, can't go any further
        break;
      }
    }
    return output.join("\n");
  }
}
