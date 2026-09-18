## 5.1 Tree-sitter, In Depth

> **Tree-sitter is a fast, incremental parser built for code editors.**
>
> It takes source code + a language grammar and produces a syntax tree that stays useful even while the code is incomplete or broken.

---

### 1. Tree-sitter = Parser Engine + Language Grammar

There are two pieces:

```text
web-tree-sitter
    ↓
Parsing engine (WASM)
    ↓
Doesn't know JavaScript, TypeScript, Python, etc.
```

and:

```text
tree-sitter-typescript.wasm
tree-sitter-javascript.wasm
tree-sitter-python.wasm
    ↓
Language grammar
```

Together:

```text
Source Code
    +
Language Grammar
    ↓
Tree-sitter Parser
    ↓
Syntax Tree
```

So in this repo:

```ts
import Parser from "web-tree-sitter";

await Parser.init();

const parser = new Parser();

const TypeScript = await Parser.Language.load("tree-sitter-typescript.wasm");

parser.setLanguage(TypeScript);

const tree = parser.parse("const user = getUser();");
```

The important idea:

> **One Tree-sitter engine can parse different languages by loading a different grammar.**

---

### 2. What Does Tree-sitter Actually Give Us?

Tree-sitter parses code according to the grammar and builds a **Concrete Syntax Tree (CST)**.

For example:

```ts
const user = getUser();
```

you can think of the tree roughly like:

```text
program
└── variable_declaration
    ├── const
    ├── identifier: user
    ├── =
    └── call_expression
        └── identifier: getUser
```

The tree contains both:

- **Named nodes** → `variable_declaration`, `call_expression`, `identifier`
- **Anonymous nodes** → `const`, `=`, `(`, `)`, `;`, etc.

In practice, you'll usually work mostly with **named nodes**.

---

### 3. CST vs AST

Tree-sitter gives you a **CST**, not a traditional compiler-style AST.

### AST

An AST focuses on the important structure:

```text
BinaryExpression
├── left: 2
├── operator: +
└── right: 3
```

### CST

A CST keeps more of the original syntax:

```text
expression
├── 2
├── +
└── 3
```

The difference is:

> **AST = simplified structure**
>
> **CST = structure + more of the original syntax**

For an editor, keeping details like punctuation can actually be useful.

For example, knowing whether a `)` exists can help answer:

```text
"Is this function call already closed?"
```

---

### 4. Why Positions Matter So Much

Every Tree-sitter node knows **where it appears in the source code**.

For example:

```ts
node.startPosition;
// { row: 3, column: 8 }

node.endPosition;
// { row: 3, column: 14 }
```

That means you can ask:

> **"Which syntax node is the cursor currently inside?"**

```ts
const node = tree.rootNode.descendantForPosition({
  row,
  column,
});
```

For a completion extension, this is extremely useful.

Suppose the user is here:

```ts
user.foo(
        ↑
```

Tree-sitter can help you determine that the cursor is inside:

```text
call_expression
└── arguments
```

Or here:

```ts
user.name
     ↑
```

you can identify:

```text
member_expression
├── user
└── name
```

So instead of manually scanning strings, you can ask the syntax tree.

---

### 5. Tree-sitter Handles Incomplete Code

This is one of its biggest advantages for editors.

While typing, code is constantly incomplete:

```ts
const user =
```

A compiler-style parser might simply say:

```text
❌ expected expression
```

Tree-sitter tries to preserve as much structure as possible:

```text
variable_declaration
├── const
├── user
├── =
└── ERROR
```

Then you continue typing:

```ts
const user = getUser();
```

and the tree becomes:

```text
variable_declaration
├── const
├── user
├── =
└── call_expression
    └── getUser
```

So the important idea is:

> **Tree-sitter doesn't pretend broken code is valid. It keeps a useful partial tree despite the error.**

That's exactly what an editor needs.

---

### 6. Incremental Parsing

Tree-sitter is also **incremental**.

Imagine this:

```ts
const user = {
  name: "Pranto",
  age: 26,
  country: "Bangladesh",
};
```

Now change only:

```ts
age: 26;
```

to:

```ts
age: 27;
```

Tree-sitter can reuse the unaffected parts of the old tree and update the changed part.

```text
Old Tree

      Program
     /   |    \
  name   age   country
          ↑
        changed
```

becomes:

```text
New Tree

      Program
     /   |    \
  name  age'   country
```

In code:

```ts
tree.edit({
  startIndex,
  oldEndIndex,
  newEndIndex,

  startPosition,
  oldEndPosition,
  newEndPosition,
});

const newTree = parser.parse(newSource, tree);
```

The key idea:

> **Don't throw away the whole tree after every keystroke. Reuse what didn't change.**

This is what makes Tree-sitter suitable for editor workloads.

---

### 7. Queries: The Easy Way to Find Things

You don't always need to manually walk the tree.

Tree-sitter provides a **query language** using S-expressions.

For example, to find function declarations:

```scheme
(function_declaration
  name: (identifier) @fn.name
  body: (statement_block) @fn.body)
```

You can run this against the tree and get all matching nodes and their positions.

Another example:

```scheme
(import_statement
  source: (string) @import.source)
```

This can find imports without doing fragile string matching.

So instead of:

```text
"search the file for the word import"
```

you can say:

```text
"find nodes that are actually import_statement"
```

This is particularly useful for replacing logic like:

```text
src/utils/import-analysis.ts
```

which currently relies heavily on string scanning.

---

### 8. Where Tree-sitter Fits Next to LSP

The easiest way to think about them is:

```text
Tree-sitter
    ↓
"What is the syntax here?"

Language Server
    ↓
"What does this code mean?"
```

For example:

```ts
user.
```

Tree-sitter can tell you:

```text
This is member access.
The object is `user`.
The cursor is after `.`
```

The language server can tell you:

```text
`user` refers to this variable.
Its type is `User`.
`User` has:
  name
  age
  email
```

So:

```text
Tree-sitter
→ syntax / structure / cursor context

Language Server
→ symbols / types / definitions / semantic meaning
```

---

### 9. Tree-sitter vs Language Server

|                             | Tree-sitter       | Language Server                            |
| --------------------------- | ----------------- | ------------------------------------------ |
| Main job                    | Understand syntax | Understand meaning                         |
| Knows types?                | ❌                | ✅                                         |
| Knows scope?                | ❌                | ✅                                         |
| Knows symbol definitions?   | ❌                | ✅                                         |
| Handles incomplete code     | ✅                | Depends on implementation                  |
| Incremental parsing         | ✅                | Usually relies on its own mechanisms       |
| Finds syntax nodes          | ✅                | ✅, but usually at a higher semantic level |
| Provides autocomplete       | Not by itself     | ✅                                         |
| Go to Definition            | Not by itself     | ✅                                         |
| Syntax-aware cursor context | ✅                | ✅                                         |

Important:

> **LSP and Tree-sitter are not competing technologies.**

A language server can use Tree-sitter internally:

```text
                  Language Server
                       │
              ┌────────┴────────┐
              ↓                 ↓
         Tree-sitter       Semantic Engine
              │                 │
              ↓                 ↓
           Syntax            Meaning
```
