# Activation & Trigger Flow

Two phases, from the sequence diagram.

## Diagram

```mermaid
sequenceDiagram
    participant User
    participant Editor as VS Code Editor
    participant Ext as extension.ts
    participant Provider as InlineCompletionProvider

    rect rgb(255, 249, 196)
    note over User, Provider: Extension Activation (on startup)
    end
    Ext->>Provider: new InlineCompletionProvider(outputChannel, statusCallback)
    Ext->>Editor: registerInlineCompletionItemProvider(selector, provider)

    rect rgb(255, 249, 196)

    note over User, Provider: Runtime Trigger
    end
    User->>Editor: Types character / moves cursor
    Editor->>Editor: Debounce input
    Editor->>Provider: provideInlineCompletionItems(document, position, context, token)
    Provider-->>Editor: Promise<InlineCompletionList | null>
```

## Activation (on startup)

`extension.ts` runs on activation and:

1. `new InlineCompletionProvider(outputChannel, statusCallback)` — provider owns the completion logic; `outputChannel` for logging, `statusCallback` to report state back (e.g. status bar).
2. `vscode.languages.registerInlineCompletionItemProvider(selector, provider)` — hands the provider to the editor. `selector` decides which documents/languages it applies to.

After this, `extension.ts` is out of the loop — the editor talks to the provider directly.

so basically, upon startup new `InlineCompletionProvider` is created and registered with the editor. The provider will be used to handle the completion requests from the editor. The provider will be responsible for gathering context, constructing prompts, calling the LLM API, processing the response, and displaying the suggestions in the editor.

## Runtime trigger

1. User types a character or moves the cursor.
2. Editor debounces the input (avoids one request per keystroke).
3. Editor calls `provideInlineCompletionItems(document, position, context, token)`.
4. Provider returns `Promise<InlineCompletionList | null>` — `null` means no suggestion.

`token` is the cancellation token: if the user keeps typing, the editor cancels the in-flight request, so every step after this (cache check, context gathering, LLM call) must bail on cancellation.

Everything in [architecture.md](architecture.md) steps 2–7 happens inside step 3 above.

# Simplified MVP

```mermaid
flowchart LR
    A["Text before cursor"]:::input --> B["LLM"]:::process --> C["Ghost Suggestion"]:::output

    classDef input fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef process fill:#ffe082,stroke:#ff8f00,color:#e65100
    classDef output fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
```

# Pending Completion Handling

`provideInlineCompletionItems` reuses an in-flight/last suggestion instead of
re-requesting the LLM when the cursor hasn't moved off it.
Handle vscode firing `provideInlineCompletionItems` multiple times in the exact same position. This often happens - focus changes, re-renders, etc. — without the user typing anything. It then returns the same `pendingCompletion` if it hasn't changed.

```mermaid
flowchart TD
    Entry["provideInlineCompletionItems()"]

    subgraph Check["Pending Completion Check"]
        A{"Has Pending Completion?"}
        B{"Same Document?"}
        C{"Same Line?"}
        D{"Same Position?"}
        Return["Return Existing Completion"]
        Clear["Clear Pending & Continue"]
    end

    Entry --> A
    A -- Yes --> B
    A -- No --> Clear
    B -- Yes --> C
    B -- No --> Clear
    C -- Yes --> D
    C -- No --> Clear
    D -- Yes --> Return
    D -- No --> Clear
```

## Prediction Continuation (`tryContinuePrediction`)

Handles the case where the user typed forward, matching what the ghost text already predicted. It checks if the typed text is a prefix of `lastCompletionText`; if so, it slices off what's left and re-anchors it at the new cursor position with no new LLM call.

```mermaid
flowchart TD
    Entry["provideInlineCompletionItems()\n(pending check missed)"]:::entry

    subgraph Continuation["Prediction Continuation"]
        A{"Has Last Completion?\n(text, position, same doc)"}:::decision
        B{"Same Line?"}:::decision
        C{"Typed Forward?\ncharSinceLastCompletion > 0"}:::decision
        D{"Matches Prediction Prefix?\nlastText.startsWith(typedText)"}:::decision
        E{"Remaining Text Left?"}:::decision
        Return["Return Remaining Text"]:::success
        Completed["Prediction Fully Typed\nClear state, return null"]:::info
        Diverged["Diverged\nClear state"]:::warn
        ToApi["Continue to API"]:::neutral
    end

    Entry --> A
    A -- Yes --> B
    A -- No --> ToApi
    B -- Yes --> C
    B -- No --> ToApi
    C -- Yes --> D
    C -- No --> ToApi
    D -- Yes --> E
    D -- No --> Diverged
    E -- Yes --> Return
    E -- No --> Completed
    Diverged --> ToApi

    classDef entry fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#d1c4e9,stroke:#5e35b1,color:#311b92
    classDef success fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
    classDef warn fill:#ffccbc,stroke:#d84315,color:#bf360c
    classDef info fill:#b3e5fc,stroke:#0277bd,color:#01579b
    classDef neutral fill:#ffe082,stroke:#ff8f00,color:#e65100
```

## Intent Tracking Flow (`IntentTracker`)

buffers raw text-change events into higher-level `intent` entries for the LLM's edit-history context.
[intent-tracker.ts](../src/services/intent-tracker.ts).
Flow: keystroke → `handleDocumentChange` filters (active file only, skips undo/redo) → `processChange` groups changes into a `pendingIntent` if same file + <1.5s since last edit, else flushes old one and starts new → `classifies` type (added > edited, or pasted if >50 chars) → 1.5s debounce timer → `finalizeIntent` builds an `IntentEntry` and either `merges` it into a recent buffer entry (`tryMergeWithRecent`, if same file + within 5s + line ranges overlap/adjacent) or pushes it to the buffer (capped at 35).

```mermaid
sequenceDiagram
    participant User
    participant VSCode as VS Code
    participant Tracker as IntentTracker
    participant Buffer as buffer[]

    User->>VSCode: Types "c"
    VSCode->>Tracker: onDidChangeTextDocument
    Tracker->>Tracker: handleDocumentChange()\n(scheme / active editor / version-jump filters)
    Tracker->>Tracker: processChange()
    Tracker->>Tracker: create pendingIntent (type: added/pasted)
    Tracker->>Tracker: scheduleFlush() -> 1.5s timer

    User->>VSCode: Types "onst" ...
    VSCode->>Tracker: onDidChangeTextDocument (xN)
    Tracker->>Tracker: canContinuePendingIntent?\n(same file & < 1.5s since last activity)
    Tracker->>Tracker: captureOriginalLineContent() (first touch per line only)
    Tracker->>Tracker: update currentContent, classifyIntentType()
    Tracker->>Tracker: scheduleFlush() -> reset 1.5s timer

    note over Tracker: 1.5s of no typing, OR file/timeout break

    Tracker->>Tracker: finalizeIntent()
    Tracker->>Tracker: original vs current per line -> hasChange?
    alt no real change
        Tracker--xTracker: discard (no entry)
    else changed
        Tracker->>Tracker: build IntentEntry (1-indexed lineRange)
        Tracker->>Buffer: tryMergeWithRecent()\n(same file, <5s old, overlap/adjacent)
        alt merge found
            Buffer-->>Tracker: replace existing entry
        else no merge
            Buffer-->>Tracker: push new entry\n(trim oldest if > MAX_BUFFER_SIZE)
        end
    end
```

### Merge Logic (`tryMergeWithRecent`)

```mermaid
flowchart LR
    subgraph Before["Before Merge"]
        E1["[edited] app.ts:10\n'const x = 5;'"]
        E2["[edited] app.ts:11\n'const y = 10;'"]
    end

    subgraph Cond["Merge Conditions (checked newest -> oldest, stop past 5s)"]
        A{"Same file?"}
        B{"Within 5s\nmerge window?"}
        C{"Overlapping or\nadjacent (<=1 line) ranges?"}
    end

    subgraph After["After Merge"]
        R["[edited] app.ts:10-11\n'const y = 10;'\n(id kept from existing entry)"]
    end

    E1 --> A
    E2 --> A
    A -- Yes --> B
    A -- No --> Skip["Not merged\n(new buffer entry)"]
    B -- Yes --> C
    B -- No --> Skip
    C -- Yes --> R
    C -- No --> Skip

    classDef before fill:#ffcdd2,stroke:#c62828,color:#b71c1c
    classDef cond fill:#ffe0b2,stroke:#ef6c00,color:#e65100
    classDef after fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
    class E1,E2 before
    class A,B,C cond
    class R after
```

Note: content is not concatenated on merge — the merged entry takes the
_new_ entry's `content` and `timestamp` outright (`intentEntry.content`,
[intent-tracker.ts:301](../src/services/intent-tracker.ts#L301)), only the
line range is widened to cover both. So `'const y = 10;'` above replaces
`'const x = 5;'` rather than joining it; only `type` is chosen by priority
(`edited` > `pasted` > whatever the new entry was).

### Notes

- **Filtering (`handleDocumentChange`)**: ignores non-file documents, edits outside the active editor, and version jumps > 1 (undo/redo) — an undo/redo drops the in-flight `pendingIntent` instead of aggregating it.
- **One intent = one burst of typing.** `pendingIntent` stays open while edits keep landing in the same file within `INTENT_TIMEOUT` (1.5s, [constants.ts](../src/utils/constants.ts)); a gap, a file switch, or an undo/redo forces `finalizeIntent()` first.
- **`captureOriginalLineContent`** only records a line's _before_ state the first time that line is touched in the current intent — later edits to the same line don't overwrite it, so the diff against `currentContent` reflects the whole burst, not just the last keystroke.
- **`classifyIntentType`**: `pasted` (text > 50 chars in one change, `PASTE_TEXT_LENGTH_LIMIT`) always wins; otherwise `added` if any affected line went from blank to non-blank, else `edited`.
- **`finalizeIntent`** drops the intent entirely if `current.trim() === original.trim()` for every affected line (e.g. type-then-undo-by-hand nets no change).
- **`tryMergeWithRecent`** folds a new entry into a recent one (within `BUFFER_MERGE_TIME_LIMIT`) in the same file if their line ranges overlap or sit within 1 line of each other — keeps the buffer from fragmenting one logical edit into many entries. Note: the constant is named `BUFFER_MERGE_TIME_LIMIT = 50000` with a `//5s` comment in [constants.ts](../src/utils/constants.ts) — the value is actually 5s, the comment is stale.
- **Buffer eviction**: FIFO, oldest entry dropped once `buffer.length > MAX_BUFFER_SIZE` (35).
- **Unfinished**: `handleActiveEditorChange()` and `dispose()` both currently `throw new Error("Method not implemented.")` — switching editors or disposing the extension will throw as-is.

## Full Lifecycle (target architecture)

Sequence across the request's whole lifecycle, including pieces not yet
built: `isLanguageEnabled`, `CompletionCache`/`computeHash`, and
`IntentTracker` don't exist in [inline-completion-provider.ts](../src/providers/inline-completion-provider.ts)
today — this is the target design, not the current implementation.

```mermaid
sequenceDiagram
    participant Provider as InlineCompletionProvider
    participant Pending as Pending Completion
    participant Cache as CompletionCache
    participant Intent as IntentTracker

    Provider->>Pending: handleExistingPendingCompletion()
    alt Has valid pending completion
        Pending-->>Provider: Return existing completion
    else Different doc/line/position
        Pending-->>Provider: Clear & return undefined
    end

    Provider->>Provider: isLanguageEnabled(languageId)
    alt Language disabled
        Provider->>Provider: Return null
    end

    Provider->>Intent: computeHash()
    Intent-->>Provider: editHistoryHash
    Provider->>Cache: get(document, position, hash)
    alt Cache hit
        Cache-->>Provider: Return cached ReplacementEdit
        Provider->>Provider: activateCompletion(edit)
    end

    Provider->>Provider: tryContinuePrediction()
    alt User typing along prediction
        Provider->>Provider: Return remaining text
    else User diverged
        Provider->>Provider: Clear prediction, continue
    end
```

## Context Gathering (target design)

Same target-design status as the sections above — `LSPService`,
`CrossFileSymbolService`, and `ASTService` don't exist yet in
[inline-completion-provider.ts](../src/providers/inline-completion-provider.ts).
See [architecture.md](architecture.md) step 3 for the prose walkthrough.

```mermaid
flowchart TD
    Start(["Start gathering context"]) --> LoadParser
    LoadParser["Load the code parser (tree-sitter)<br/>for this file's language if not loaded yet"] --> Replacement

    Replacement["1. Replacement Region<br/>Figure out what text after the cursor<br/>might need to be replaced"] --> Prefix
    Prefix["2. Prefix (code before cursor)<br/>Collect the most relevant code<br/>that comes before where you're typing"] --> Suffix
    Suffix["3. Suffix (code after cursor)<br/>Collect a small window of code<br/>that comes after the replacement region"] --> Parallel

    Parallel{"These two run<br/>at the same time<br/>(in parallel)"}
    Parallel --> TypeDefs
    Parallel --> CrossFile

    TypeDefs["4. Type Definitions<br/>Ask the language server for<br/>type info about what's at the cursor"] --> WaitBoth
    CrossFile["5. Cross-File Symbols<br/>Find relevant functions/classes<br/>from other files in the project"] --> WaitBoth

    WaitBoth["Wait for both to finish"] --> EditHistory
    EditHistory["6. Edit History<br/>Summarize what you've been<br/>editing recently (your intent)"] --> Finalize
    Finalize["7. Package everything up into one context bundle and return it"]
```

## Cache Eviction Strategy (target design — `evictLeastUsed`)

Hybrid LRU + LFU eviction for `CompletionCache` (not yet implemented — same
target-design status as the section above). TTL expiry gives the LRU half
(time-based), `accessCount / ageSeconds` gives the LFU half (frequency-based,
lower score = less useful = eviction candidate). One call evicts at most one
entry: the first expired entry found, or, if none are expired, the lowest-scoring
one across the whole scan.

```mermaid
flowchart TD
    Start["evictLeastUsed()"]:::entry
    Scan["Scan all entries"]:::process
    TTL{"Entry TTL expired?"}:::decision
    DeleteExpired["Delete expired entry\n(free cleanup)"]:::danger
    Score["Score = accessCount / ageSeconds"]:::process
    Compare{"Score < lowestScore?"}:::decision
    Mark["Mark as eviction candidate"]:::process
    Skip["Skip"]:::neutral
    Continue["Continue scan"]:::process
    DeleteLowest["Delete entry with lowest score"]:::danger
    Return["Return"]:::success

    Start --> Scan --> TTL
    TTL -- Yes --> DeleteExpired --> Return
    TTL -- No --> Score --> Compare
    Compare -- Yes --> Mark --> Continue
    Compare -- No --> Skip --> Continue
    Continue -- "next entry" --> TTL
    Continue -- "scan complete" --> DeleteLowest --> Return

    classDef entry fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef process fill:#ffe082,stroke:#ff8f00,color:#e65100
    classDef decision fill:#d1c4e9,stroke:#5e35b1,color:#311b92
    classDef danger fill:#ff8a80,stroke:#c62828,color:#b71c1c
    classDef neutral fill:#eceff1,stroke:#455a64,color:#263238
    classDef success fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
```

- **LRU half**: TTL expiry — an entry idle past its time-to-live is deleted
  immediately on sight, no need to compare it against anything else.
- **LFU half**: for non-expired entries, `score = accessCount / ageSeconds`
  approximates "uses per second alive" — the lowest-scoring entry seen during
  the scan is tracked as the eviction candidate and deleted only after the
  full scan confirms no entry was expired.
- Expired-entry cleanup and lowest-score eviction are mutually exclusive per
  call: finding an expired entry short-circuits the scan and returns
  immediately, so the LFU comparison never runs against entries scanned after it.

## Prefix Stage (target design)

How the prefix (code before the cursor) is built for the LLM prompt. Small
files/functions get sent verbatim; large ones get windowed via the language
server, then enriched with only the imports/dependencies actually used.

```mermaid
flowchart TD
    Start["How much code is before the cursor?"]:::entry
    Within150{"Is the cursor within\nthe first 150 lines\nof the file?"}:::decision
    Verbatim["Strategy: Verbatim\nInclude everything from line 1\nto the cursor, unchanged.\nThe file is small enough to send it all."]:::strategy

    AskLSP["Ask the language server:\nwhat function/method\nam I currently inside?"]:::process
    InFunc{"Is the cursor inside\na function or method?"}:::decision
    Simplified["Strategy: Simplified\nLast 150 lines before the cursor\n+ only the imports actually used\nin those lines"]:::strategy

    FuncLong{"Is the function itself\nlonger than 150 lines\n(from its start to the cursor)?"}:::decision
    SmallFunc["Strategy: Small Function\nInclude the entire function body\nfrom its first line to the cursor"]:::strategy
    LargeFunc["Strategy: Large Function\nTwo windows:\n1. First 30 lines of the function\n(setup, params, declarations)\n2. Last 100 lines before the cursor\n(recent context), with a marker\nshowing lines were skipped"]:::strategy

    Enrich["Enrich the prefix with:"]:::process
    UsedImports["Only the import/require statements\nactually referenced in the collected code"]:::process
    ClassHeader["If inside a class: include the\nclass declaration line\n(class Name extends Base {})"]:::process
    SameFileDeps["Include same-file dependencies"]:::process

    Assemble["Assemble final prefix:\n1. Used imports (top)\n2. Same-file dependencies\n3. Class header (if applicable)\n4. Code lines (with truncation\nmarker if needed)"]:::process
    Return(["Return the prefix string"]):::exit

    Start --> Within150
    Within150 -- Yes --> Verbatim
    Within150 -- "No (cursor is deep\nin a large file)" --> AskLSP
    AskLSP --> InFunc
    InFunc -- No --> Simplified
    InFunc -- Yes --> FuncLong
    FuncLong -- No --> SmallFunc
    FuncLong -- Yes --> LargeFunc
    SmallFunc --> Enrich
    LargeFunc --> Enrich
    Enrich --> UsedImports --> ClassHeader --> SameFileDeps --> Assemble
    Simplified --> Assemble
    Verbatim --> Return
    Assemble --> Return

    classDef entry fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#d1c4e9,stroke:#5e35b1,color:#311b92
    classDef process fill:#ffe092,stroke:#ff8f00,color:#e65100
    classDef strategy fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
    classDef exit fill:#b3e5fc,stroke:#0277bd,color:#01579b
```

### Notes

- **150-line threshold** decides between two branches: near-top-of-file
  (verbatim, no LSP call needed) vs. deep-in-file (ask the language server to
  locate the enclosing function, then window around it).
- **Simplified strategy** is the fallback when the cursor isn't inside any
  function (e.g. top-level/module code deep in a large file) — just a sliding
  150-line window plus used imports, no LSP-derived function boundaries.
- **Small vs. Large function** split is also a 150-line threshold, but
  measured from the function's own start to the cursor, not the file's start.
  Large functions lose their middle (only first 30 + last 100 lines survive),
  with a marker noting the gap so the LLM knows lines were skipped.
- **Enrichment is shared** by both the Small Function and Large Function
  branches (imports → class header → same-file deps), but the Simplified and
  Verbatim strategies skip straight to assembly — Simplified already computed
  its own "used imports," and Verbatim needs no enrichment since it's the
  whole file-to-cursor already.
- **Import filtering** is not "all imports" — only ones actually referenced
  in the collected code lines are included, to keep the prefix compact.

## Replacement Region Stage

Unlike the sections above, this one is implemented today:
[replacement-region-stage.ts](../src/services/context/replacement-region-stage.ts)

- [ast-analysis.ts](../src/services/ast/ast-analysis.ts). It decides how much
  _already-typed_ code after the cursor a completion is allowed to overwrite —
  not just insert in front of — so accepting a suggestion can't leave a
  duplicated or dangling bracket behind from code that was already there.
  `ContextGatherer` calls it ([context-gatherer.ts:26](../src/services/context/context-gatherer.ts#L26))
  but doesn't use the result yet — wired ahead of the feature landing.

```mermaid
flowchart TD
    Start["compute(document, position)"]:::entry
    Default["Default region:\ntext = rest of current line\nrange = cursor -> end of line"]:::process

    TailCheck{"shouldTryExtension()?\n(cheap, no parsing)"}:::decision
    Case1["unbalanced ( [ { vs ) ] }"]:::note
    Case2["ends with an operator\n( , + - * / && || . = ? : ...)"]:::note
    Case3["short (<20 chars) AND\nno ; { } : at the end"]:::note

    LenCheck{"tail shorter than\nREGION_CHARACTER_LIMIT (200)?"}:::decision
    Window["Grab up to REGION_LINE_LIMIT (3)\nlines starting at the cursor's line"]:::process
    Parse["Parse just that window\n(tree-sitter, not the whole file)"]:::process

    Smallest["findSmallestNode:\ndescend to the innermost node\ncontaining the cursor"]:::process
    SelfCheck{"Is that node itself\na statement boundary?\n(if/for/while/return/declaration/...)"}:::decision
    Climb["Climb .parent until a\nstatement-boundary type is hit"]:::process

    NullCheck{"Result found,\nand extended text\nwithin maxChars?"}:::decision
    Extend["Build absolute range/text\nfrom cursor to statement end\n(may span the extra lines)"]:::success

    Return(["Return ReplacementRegion\n{ text, range }"]):::exit

    Start --> TailCheck
    TailCheck -. one of .-> Case1
    TailCheck -. one of .-> Case2
    TailCheck -. one of .-> Case3
    TailCheck -- No --> Default
    TailCheck -- Yes --> LenCheck
    LenCheck -- No --> Default
    LenCheck -- Yes --> Window --> Parse --> Smallest --> SelfCheck
    SelfCheck -- Yes --> NullCheck
    SelfCheck -- No --> Climb --> NullCheck
    NullCheck -- No --> Default
    NullCheck -- Yes --> Extend --> Return
    Default --> Return

    classDef entry fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#d1c4e9,stroke:#5e35b1,color:#311b92
    classDef process fill:#ffe082,stroke:#ff8f00,color:#e65100
    classDef note fill:#eceff1,stroke:#455a64,color:#263238
    classDef success fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
    classDef exit fill:#b3e5fc,stroke:#0277bd,color:#01579b
```

### `findStatementEnd` — descend then climb

The heart of the "extend" path. Two passes over the tree, in opposite
directions, each doing a different job:

```mermaid
flowchart LR
    Root["rootNode of the\nparsed window"]:::entry --> Descend

    subgraph Descend["1. Descend: find WHERE the cursor is"]
        D1["Walk down, keep every node\nthat contains the cursor"]:::process
        D2["Smallest span so far\n= current best"]:::process
        D1 --> D2
    end

    Descend --> Best["bestNode\n(the innermost node\nunder the cursor)"]:::success

    Best --> Climb

    subgraph Climb["2. Climb: find the NEAREST enclosing statement"]
        C1{"Is bestNode already\na statement boundary?"}:::decision
        C2["Walk .parent upward,\nstop at first\nstatement-boundary type"]:::process
        C1 -- Yes --> Skip["skip climbing —\nalready there"]:::note
        C1 -- No --> C2
    end

    Skip --> Result
    C2 --> Result["currentNode.endPosition\n= the statement's end"]:::exit

    classDef entry fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef process fill:#ffe082,stroke:#ff8f00,color:#e65100
    classDef decision fill:#d1c4e9,stroke:#5e35b1,color:#311b92
    classDef success fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
    classDef note fill:#eceff1,stroke:#455a64,color:#263238
    classDef exit fill:#b3e5fc,stroke:#0277bd,color:#01579b
```

### Notes

- **Why descend then climb, not just climb from the top**: descending first
  finds the exact leaf the cursor is inside of, with no ambiguity. Climbing
  from there checks ancestors nearest-first, so the _first_ statement-boundary
  type hit is guaranteed to be the **innermost** enclosing statement — e.g. the
  nested `if` the cursor is actually in, not an outer `if` that happens to
  wrap it too.
- **`SelfCheck` before climbing** (`if (!STATEMENT_BOUNDARY_TYPES.has(currentNode.type))`
  in [ast-analysis.ts](../src/services/ast/ast-analysis.ts)) fixes a real bug:
  without it, a cursor landing exactly on a statement's first token (e.g. right
  before `if`) made `bestNode` itself already a boundary type, but the old code
  still climbed past it looking at parents — running out of statement-typed
  ancestors and falling back to the whole parsed window's end, which could
  swallow unrelated sibling statements after the real one.
- **Small parse window, not the whole file**: at most `REGION_LINE_LIMIT` (3)
  lines are parsed, starting at the cursor's line — cheap enough to run on
  every keystroke, at the cost of only working when the statement's real end
  is nearby.
- **`shouldTryExtension`'s three checks** exist purely as a cheap early-out —
  no point parsing anything if the current line already looks like a complete,
  terminated statement.
- **Fallback is always safe**: if extension is skipped, fails, or the result
  would exceed `REGION_CHARACTER_LIMIT`, the region silently stays "replace to
  end of current line" — the same behavior as if there were no AST-awareness
  at all.

## Cross-File Symbols

[cross-file-service.ts](../src/services/cross-file/cross-file-service.ts) finds
classes/functions from _other_ files that the user is referencing near the
cursor, and returns their bodies-stripped signatures for the LLM prompt. Two
parts: a background **index** (filled on open/save) and a per-request
**lookup** (`getRelevantSymbols`).

```mermaid
flowchart TD
    subgraph Index["Background: DocumentIndex (onDidOpen / onDidSave)"]
        I1["File opened/saved"]:::entry
        I2{"Same document.version\nalready indexed?"}:::decision
        I3["LSP: executeDocumentSymbolProvider\n(same data as Outline view)"]:::process
        I4["Flatten tree, keep Class / Interface / Enum /\nFunction / Method / Property / Constant / ..."]:::process
        I5[("cache[uri] =\n{ version, symbols:\nname, kind, range }")]:::success
        I1 --> I2
        I2 -- Yes --> Skip["Skip"]:::neutral
        I2 -- No --> I3 --> I4 --> I5
    end

    subgraph Lookup["Per request: getRelevantSymbols(document, prefix)"]
        R1["ReferenceExtractor.extract(prefix)"]:::entry
        R2["Strip imports, take last 15 lines\n-> nearByIdentifiers (minus keywords)"]:::process
        R3["tree-sitter on prefix\n-> declaredIdentifiers (this file)"]:::process
        R4{"referenceNames empty?\n(nearBy - declared, aliases -> original)"}:::decision
        R5["getAllSymbols() from index"]:::process
        R6["Filter 1: other files only,\nnot declared here"]:::process
        R7["Filter 2: name in nearBy,\nnot a Constructor"]:::process
        R8{"Any candidates?"}:::decision
        R9["SignatureProvider:\nopen file -> text in range ->\ntree-sitter -> strip bodies\n(cached per uri+kind+name+range)"]:::process
        Out(["IndexedSymbol[] with signature"]):::exit
        Empty(["[]"]):::warn

        R1 --> R2 --> R3 --> R4
        R4 -- Yes --> Empty
        R4 -- No --> R5 --> R6 --> R7 --> R8
        R8 -- No --> Empty
        R8 -- Yes --> R9 --> Out
    end

    I5 -. read by .-> R5

    classDef entry fill:#bbdefb,stroke:#1565c0,color:#0d47a1
    classDef decision fill:#d1c4e9,stroke:#5e35b1,color:#311b92
    classDef process fill:#ffe082,stroke:#ff8f00,color:#e65100
    classDef success fill:#c8e6c9,stroke:#2e7d32,color:#1b5e20
    classDef neutral fill:#eceff1,stroke:#455a64,color:#263238
    classDef warn fill:#ffccbc,stroke:#d84315,color:#bf360c
    classDef exit fill:#b3e5fc,stroke:#0277bd,color:#01579b
```

### Example

```js
// jungle-animal.js (indexed earlier)
export class JungleAnimal {
  constructor(name, species, sound) { ... }
  makeSound() { ... }
  info() { ... }
}
```

```js
// main.js (typing, cursor at |)
import { JungleAnimal } from "./jungle-animal";

const dog = new JungleAnimal(|
```

| Step                                        | Value                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| nearBy (last 15 lines, no imports/keywords) | `{dog, JungleAnimal}`                                                                                    |
| declared (tree-sitter on prefix)            | `{}` — unfinished line parses as ERROR, so `dog` isn't seen                                              |
| referenceNames                              | `{dog, JungleAnimal}`                                                                                    |
| candidates (other files, name in nearBy)    | `[JungleAnimal]`                                                                                         |
| signature                                   | `class JungleAnimal`<br>`  constructor(name, species, sound);`<br>`  makeSound();`<br>`  info();`<br>`}` |
