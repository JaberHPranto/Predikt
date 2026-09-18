# High Level Architecture

## Step 1: Trigger

user types in the editor and vscode going to request for completion. Some handlers will be used to get the actual text.

## Step 2: Early exit checks

Will setup a `InlineCompletionProvider` to handle the request. It will be used to suggest ghost text based on the current context. At first it going to check the cache. If cache is hit, then will return the `CompletionCache` object as return. The object contains information the modification/replacement region, which section should added, which one should be removed, and the new text to be added. The stuffs we already compute.
If cache is missed, will check if prediction is continued or not (for example if i am writhing like `console...` and the suggestion is `console.log()`, then we don't need to trigger a new prediction, we can just use the one we already generated). Basically we going to check if the current context is a continuation of the previous one. If it is, we can reuse the previous prediction. If not, we will proceed to generate a new prediction.

## Step 3: Context Gathering

Context is gathered from 4 sources -> `LSPService`, `CrossFileSymbolService`, `IntentTracker` and `ASTService`. The `LSPService` will provide the current document content and the cursor position. The `CrossFileSymbolService` will provide information about symbols defined in other files that are relevant to the current context. The `IntentTracker` will track the user's intent based on their previous actions and suggestions. The `ASTService` will provide the abstract syntax tree of the current document, which can be used to understand the structure of the code.

`LSPService` and `ASTService` will be used to generate the prefix. Prefix is the text before the cursor position and suffix is the text after the cursor position. For our case, suffix will be empty so the model can keep predicting. Prefix will be very crucial since the we can just put everything int the prefix. We need to smartly calculate which things are useful and which things are not. For example, if the user is writing a function, we can include the function signature and the previous lines of code in the prefix. If the user is writing a class, we can include the class definition and the previous methods in the prefix. We can also include comments and docstrings in the prefix to provide more context to the model.

`CrossFileSymbolService` will be used to gather information about symbols defined in other files that are relevant to the current context. For example, if the a function returns a User type object and the User type is defined in another file, we can include the definition of the User type in the prefix. This will help the model understand the context better and generate more accurate suggestions.

`IntentTracker` will be used to track the user's intent based on their previous actions and suggestions. Which line user recently added, which one remove, which is edited, which suggestion user accepted, which one user rejected. For example, if the user has previously accepted a suggestion to use a certain library, we can include that library in the prefix to provide more context to the model. We can also track the user's coding style and preferences to generate suggestions that are more aligned with their coding habits.

## Step 4: Prompt Construction

All the gathered context will be used to construct a prompt for the model via `PromptBuilder`. There will be also `TokenBudgetManager` to manage the token budget. For example, the computed prefix will be in a certain token length, the suffix will be in a certain token length, and the model has a maximum token limit. The `TokenBudgetManager` will ensure that the total token length of the prompt does not exceed the model's maximum token limit. If it does, it will truncate the prefix or suffix accordingly. Without the token budget, the cost can go up significantly and the model may hallucinate (the service should be cheap as it going to run so many times). After the prompt is constructed, we going to construct system and user prompt.

## Step 5: LLM API Call

The constructed prompt will be sent to the LLM API for generating the completion. There will be multiple providers - `openrouter`, `groq`.

## Step 6: Response Processing

Once the response is received from the LLM, it will be cleaned/sanitized first. Then will be went through the `DeduplicationService` to remove any duplicate suggestions. For example the model might generate some lines that are already present in the prefix or suffix (higher chance of duplication here as we don't pass anything after the cursor). We will remove those lines to avoid redundancy. `ASTService` will be used here as well.
If the suggestion is duplicate, we will go to `InlineCompletionProvider` again to generate a new suggestion. But if the suggestion is unique, we will move to the next step.

## Step 7: Complete Display

Fro unique suggestion, we will compute the `minimal diff`. Then it can call `DeletionDecorationManager` if the change requires deletion/modification of some text. Then upon clicking tab, the ghost text will replace that text that needs to be deleted/modified.
But for brand new text, we will use create `InlineCompletionItem` and display the `ghost text` in the editor. The ghost text will be displayed in the editor as a suggestion for the user to accept or reject. If the user accepts the suggestion, the ghost text will be inserted into the document at the cursor position. If the user rejects the suggestion, the ghost text will be removed from the editor.
