import { ChatMessage, CompletionContext } from "../utils/types";

const DEFAULT_PROMPT_OVERHEAD_TOKENS = 50; // for the XML tags (Going to add tokens in user prompt)

const DEFAULT_TOKEN_BUDGET = {
  systemPrompt: 1000,
  currentFile: 6000,
  importedSignatures: 3000,
  editHistory: 1500,
  outputSpace: 3000,
  buffer: 1000,
  total: 15000,
};

export interface FitToBudgetInput {
  systemPrompt: string;
  prefix: string;
  replaceRegion: string;
  suffix: string;
  importedSignatures: string[];
  editHistory: string;
  languageId: string;
  promptOverheadTokens?: number;
}

export interface FitToBudgetResult {
  prefix: string;
  replacementRegion: string;
  suffix: string;
  importedSignatures: string;
  editHistory: string;
}

const SYSTEM_PROMPT = `You are a code completion engine that can REPLACE existing code.

<format>
Input format:
- <prefix>: code before cursor with an inline <cursor /> marker at the exact cursor boundary
- <replace_region>: text from cursor that MAY be replaced
- <suffix>: code after replace_region (read-only context)
</format>

<task>
Output what <replace_region> should become. This may involve:
- Keeping some/all of the existing text unchanged
- Inserting new code
- Replacing incorrect/incomplete code
- Deleting unnecessary code
</task>

<rules>
- Output ONLY the replacement text, nothing else
- NO markdown, NO backticks, NO explanations
- Match surrounding indentation and style
- Be MINIMAL: only change what's necessary
- If region should stay unchanged, output it verbatim
- If inserting at cursor with no changes to region, prepend your insertion to the existing text
</rules>

<output_format>
Output the complete replacement text for <replace_region>.
Just the raw code, nothing else.
</output_format>`;

export class PromptBuilder {
  buildPrompt(context: CompletionContext): ChatMessage[] {
    const userContent = this.buildUserPrompt(context);

    return [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: userContent,
      },
    ];
  }

  private buildUserPrompt(context: CompletionContext): string {
    const importedSignatures = this.getImportedSignatures(context);

    const fitted = this.fitToBudget({
      systemPrompt: SYSTEM_PROMPT,
      prefix: context.prefix,
      replaceRegion: context.replacementRegion.text,
      suffix: context.suffixAfterRegion,
      importedSignatures,
      editHistory: context.editHistory,
      languageId: context.languageId,
      promptOverheadTokens: DEFAULT_PROMPT_OVERHEAD_TOKENS,
    });

    const parts: string[] = [];

    parts.push(
      `<file lang="${context.languageId}" path="${context.filePath}">`,
    );
    if (fitted.importedSignatures) {
      parts.push("<types>");
      parts.push(fitted.importedSignatures);
      parts.push("</types>");
    }

    if (fitted.editHistory) {
      parts.push("<recent_edits>");
      parts.push(fitted.editHistory);
      parts.push("</recent_edits>");
    }

    parts.push("<prefix>");
    parts.push(`${fitted.prefix}<cursor />`);
    parts.push("</prefix>");

    parts.push("<replace_region>");
    parts.push(fitted.replacementRegion);
    parts.push("</replace_region>");

    parts.push("<suffix>");
    parts.push(fitted.suffix);
    parts.push("</suffix>");

    parts.push(`</file>`);

    return parts.join("\n");
  }

  private fitToBudget(parts: FitToBudgetInput): FitToBudgetResult {
    let editHistory = this.truncateToTokens(
      parts.editHistory,
      DEFAULT_TOKEN_BUDGET.editHistory,
    );

    let importedSignatures = this.truncateToTokens(
      parts.importedSignatures.join("\n"),
      DEFAULT_TOKEN_BUDGET.importedSignatures,
    );

    const currentFileContent = this.fitCurrentFile(
      parts.prefix,
      parts.replaceRegion,
      parts.suffix,
    );

    return {
      ...currentFileContent,
      importedSignatures,
      editHistory,
    };
  }

  private fitCurrentFile(
    prefix: string,
    replacementRegion: string,
    suffix: string,
  ): Pick<FitToBudgetResult, "prefix" | "replacementRegion" | "suffix"> {
    const currentFileCap = this.tokensToChars(DEFAULT_TOKEN_BUDGET.currentFile);

    if (
      prefix.length + replacementRegion.length + suffix.length >
      currentFileCap
    ) {
      // We always the keep replacement region to full extend otherwise model will be confused
      const keep = Math.max(0, currentFileCap - replacementRegion.length);

      const prefixShare = Math.min(prefix.length, Math.ceil(keep * 0.9)); // Keep 90% of prefix
      const suffixShare = Math.min(suffix.length, keep - prefixShare); // Keep 10% of suffix

      prefix = prefix.slice(prefix.length - prefixShare); // latest prefix is more relevant, closer to cursor
      suffix = suffix.slice(0, suffixShare);
    }

    return { prefix, replacementRegion, suffix };
  }

  private getImportedSignatures(context: CompletionContext): string[] {
    const symbols = context.crossFileSymbols
      .map((symbol) => symbol.signature)
      .filter(Boolean) as string[];

    return symbols ?? [];
  }

  private truncateToTokens(text: string, maxTokens: number): string {
    const maxChars = this.tokensToChars(maxTokens);

    if (!text || text.length <= maxChars) {
      return text;
    }

    return text.substring(0, maxChars);
  }

  // (Simplistic Approach) Considering 1 token = 4 characters
  private tokensToChars(tokens: number): number {
    return Math.max(0, tokens) * 4;
  }
}
