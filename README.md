# Predikt — Tab Completion

A VS Code extension that provides LLM-backed inline code completion (ghost text). It builds a compact, relevant prompt from your file using the language server rather than dumping raw context, then streams a continuation from an OpenAI-compatible provider.

## Features

- **Inline completions** for any file type, rendered as ghost text you accept with Tab.
- **LSP-aware context building** — uses document symbols and type hierarchy to include the enclosing class, its base types, and locally-defined types the code actually references.
- **Import filtering** — only imports whose bindings appear in the surrounding code are sent, instead of the whole import block.
- **Completion cache** — keyed on document, cursor position, file content hash, and recent edit history, with TTL and LRU eviction.
- **Prediction continuation** — if you type text matching the pending suggestion, the remainder is re-offered instead of re-querying the model; divergence discards it.
- **Edit-intent tracking** — recent typing/paste/file-switch activity is hashed into the cache key so suggestions reflect what you just did.
- **Multiple providers** — OpenRouter, Groq, and Fireworks (whichever API key is set, in that order).

## Requirements

- VS Code `^1.125.0`
- An API key for OpenRouter, Groq, or Fireworks
- For the best context quality, a language extension providing document symbols and type hierarchy for your language (e.g. the built-in TypeScript support)

## Extension Settings

| Setting                             | Default          | Description                              |
| ----------------------------------- | ---------------- | ---------------------------------------- |
| `predikt.openrouterApiKey`          | `""`             | OpenRouter API key                       |
| `predikt.groqApiKey`                | `""`             | Groq API key                             |
| `predikt.fireworksApiKey`           | `""`             | Fireworks API key                        |
| `predikt.model`                     | `qwen/qwen3-32b` | Model used for completion                |
| `predikt.maxTokens`                 | `512`            | Max tokens to generate                   |
| `predikt.completionCacheMaxEntries` | `100`            | Max cached completions (10–1000)         |
| `predikt.completionCacheTtlMs`      | `30000`          | Cache entry lifetime in ms (5000–120000) |
| `predikt.lspCacheMaxEntries`        | `250`            | Max cached LSP results (10–1000)         |

Provider selection is implicit: the first non-empty key wins, checked in the order OpenRouter → Groq → Fireworks.

## How it works

`provideInlineCompletionItems` runs a short-circuit pipeline before ever calling the model:

1. **Pending completion** — a suggestion already shown at this exact position is re-served.
2. **Cache lookup** — key is `documentUri + line + character + contentHash + editHistoryHash`.
3. **Continue prediction** — if you typed a prefix of the last suggestion, serve the remainder.
4. **Context gathering** → **LLM request** — build the prefix, stream the completion, strip markdown fences, cache it, show it.

Prefix construction (`PrefixStage`) picks a strategy based on where the cursor is:

- **Verbatim** — file is short (cursor within `PREFIX_LINE_LIMIT`, 150 lines): send everything up to the cursor.
- **Scoped** — cursor sits inside a function: send the used imports, the enclosing class header, resolved local dependencies, and the function body up to the cursor.
- **Simplified** — cursor is outside any function (e.g. at top level after a class): send the last `PREFIX_LINE_LIMIT` lines plus the imports they use.

`LocalDependencyResolver` adds same-file declarations in two phases: base classes/interfaces found via `vscode.prepareTypeHierarchy` + `vscode.provideSuperTypes`, then any class, interface, struct, or enum referenced by the surrounding code and declared earlier in the file.

## Project structure

```
src/
  extension.ts                          activation, provider registration
  providers/inline-completion-provider  completion pipeline
  client/llm-client.ts                  streaming chat client, provider selection
  services/
    configuration-service.ts            settings singleton with live reload
    intent-tracker.ts                   recent edit history + hashing
    lsp-service.ts                      cached document symbols & type hierarchy
    context/
      context-gatherer.ts               context assembly entry point
      local-dependecy-resolver.ts       same-file dependency inclusion
      stages/prefix-stage.ts            prefix strategies
  cache/
    bounded-cache.ts                    TTL + LRU cache with group invalidation
    completion-cache.ts                 completion-specific keying
  utils/                                import parsing, language helpers, types
```

## Development

```bash
npm install
npm run compile      # or: npm run watch
npm run lint
npm test
```

Press `F5` in VS Code to launch an Extension Development Host. Logs go to the **Predikt** output channel.

## Known Issues

- API keys are stored in plain settings rather than VS Code's secret storage.
- Context quality depends on the language server; languages without symbol or type-hierarchy providers fall back to plain line-based context.
- Import parsing is regex-based and may miss unusual formatting.

## Release Notes

### 0.0.1

Initial development version: inline completion pipeline, caching, edit-intent tracking, and LSP-aware prefix construction.
