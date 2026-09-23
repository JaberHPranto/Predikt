import {
  findImportLineSpans,
  parseImportBindings,
  removeLineSpans,
} from "../../utils/import-analysis";
import { extractIdentifiers } from "../../utils/language-utils";
import { extractDeclaredNames } from "../ast/ast-analysis";
import { ASTService } from "../ast/ast-service";

interface NearByContext {
  nearByIdentifiers: Set<string>;
  declaredIdentifiers: Set<string>;
  referenceNames: Set<string>;
}

export class ReferenceExtractor {
  constructor(private readonly astService: ASTService) {}

  public async extract(
    prefix: string,
    languageId: string,
  ): Promise<NearByContext> {
    const { importedAliasesByOriginal } = parseImportBindings(
      prefix,
      languageId,
    );

    const importSpans = findImportLineSpans(prefix, languageId);
    const prefixWithoutImports = removeLineSpans(prefix, importSpans);

    const lines = prefixWithoutImports.split("\n");

    const nearByText = lines.slice(-15).join("\n");
    const nearByIdentifiers = extractIdentifiers(nearByText, languageId);

    // function or class declared/defined in this file (not imported)
    const declaredIdentifiers =
      this.astService.withParseTree(prefix, extractDeclaredNames) ??
      new Set<string>();

    const referenceNames = this.buildReferenceNames(
      nearByIdentifiers,
      importedAliasesByOriginal,
      declaredIdentifiers,
    );

    return {
      referenceNames,
      declaredIdentifiers,
      nearByIdentifiers,
    };
  }

  private buildReferenceNames(
    nearByIdentifiers: Set<string>,
    aliasesByOriginal: Map<string, Set<string>>,
    declaredIdentifiers: Set<string>,
  ): Set<string> {
    const references = new Set<string>();
    const originalByAlias = new Map<string, string>();

    for (const [original, aliases] of aliasesByOriginal) {
      for (const alias of aliases) {
        originalByAlias.set(alias, original);
      }
    }

    for (const identifier of nearByIdentifiers) {
      if (declaredIdentifiers.has(identifier)) {
        continue;
      }

      const original = originalByAlias.get(identifier) ?? identifier; // alias -> original, original -> original

      references.add(original);
    }

    return references;
  }
}
