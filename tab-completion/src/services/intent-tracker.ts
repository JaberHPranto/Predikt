/*  Keep track user recent edit history, actions  */
import * as vscode from "vscode";
import { IntentEntry, IntentType, PendingIntent } from "../utils/types";
import {
  BUFFER_MERGE_TIME_LIMIT,
  INTENT_TIMEOUT,
  MAX_BUFFER_SIZE,
  PASTE_TEXT_LENGTH_LIMIT,
} from "../utils/constants";

export class IntentTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private buffer: IntentEntry[] = [];
  private lastDocumentVersion: Map<string, number> = new Map();
  private pendingIntent: PendingIntent | null = null;
  private flushTimeout: NodeJS.Timeout | null = null;
  private idCounter: number = 0;

  constructor() {
    this.registerListeners();
  }
  private registerListeners() {
    // Track document relayed changes -> user paste a text or user types something
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) =>
        this.handleDocumentChange(e),
      ),
    );
    // Track active editor changes ( 1 file/tab -> another)
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((e) =>
        this.handleActiveEditorChange(e),
      ),
    );
  }

  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    // *** Stage: Event filtering ***/

    // 1. Check if it is actually a document
    const document = event.document;
    if (document.uri.scheme !== "file") {
      return;
    }

    // 2. If changes is made in the active editor file
    const activeEditor = vscode.window.activeTextEditor;
    if (
      !activeEditor ||
      activeEditor.document.uri.toString() !== document.uri.toString()
    ) {
      return;
    }
    // 3. Detecting version jump -> usually it increases by 1
    const docKey = document.uri.toString();
    const currentVersion = document.version;
    const previousVersion = this.lastDocumentVersion.get(docKey) || 0;

    this.lastDocumentVersion.set(docKey, currentVersion);

    if (
      previousVersion !== undefined &&
      Math.abs(currentVersion - previousVersion) > 1
    ) {
      // undo/redo operation
      if (
        this.pendingIntent &&
        this.pendingIntent.filePath === document.uri.fsPath
      ) {
        this.pendingIntent = null;
        this.clearFlushTimeout();
      }
      return;
    }

    // *** Stage: Processing ***/

    // 4. Change processing
    for (const change of event.contentChanges) {
      this.processChange(document, change);
    }
  }

  private processChange(
    document: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent,
  ) {
    const filePath = document.uri.fsPath;
    const now = Date.now();
    const isPaste = change.text.length > PASTE_TEXT_LENGTH_LIMIT; // user pasted a text more than 50 characters
    const line = change.range.start.line;
    const currentLineContent =
      line < document.lineCount ? document.lineAt(line).text : "";

    //  5. Can only continue pending intent if it's same file and time between changes is less than 1.5 second
    const canContinuePendingIntent =
      this.pendingIntent &&
      this.pendingIntent.filePath === filePath &&
      now - this.pendingIntent.lastActivityTime < INTENT_TIMEOUT;

    if (!canContinuePendingIntent) {
      this.finalizeIntent();
    }

    if (!this.pendingIntent) {
      this.pendingIntent = {
        type: isPaste ? "pasted" : "added",
        filePath,
        originalContent: new Map(),
        currentContent: new Map(),
        startTime: now,
        lastActivityTime: now,
        affectedLines: new Set(),
      };
    }

    this.captureOriginalLineContent(change, line, currentLineContent);

    this.pendingIntent?.currentContent.set(line, currentLineContent);
    this.pendingIntent.affectedLines.add(line);
    this.pendingIntent.lastActivityTime = now;

    if (isPaste) {
      this.pendingIntent.type = "pasted";
    }

    this.pendingIntent.type = this.classifyIntentType(this.pendingIntent);

    // 6. Schedule Flash
    this.scheduleFlush();
  }

  private captureOriginalLineContent(
    change: vscode.TextDocumentContentChangeEvent,
    line: number,
    currentLineContent: string,
  ): void {
    if (this.pendingIntent?.originalContent.has(line)) {
      return;
    }

    let originalLineContent = currentLineContent;

    // only insertion event
    if (change.rangeLength === 0 && change.text.length > 0) {
      const startChar = change.range.start.character;
      originalLineContent =
        currentLineContent.slice(0, startChar) +
        currentLineContent.slice(startChar + change.text.length);
    }

    this.pendingIntent?.originalContent.set(line, originalLineContent);
  }

  private classifyIntentType(pendingIntent: PendingIntent): IntentType {
    if (pendingIntent.type === "pasted") {
      return "pasted";
    }

    let hasAddition = false;
    let hasModification = false;

    for (const line of pendingIntent.affectedLines) {
      const current = pendingIntent.currentContent.get(line) ?? "";
      const original = pendingIntent.originalContent.get(line) ?? "";

      if (original.trim().length === 0 && current.trim().length > 0) {
        hasAddition = true;
      } else if (current.trim() !== original.trim()) {
        hasModification = true;
      }
    }

    return hasAddition ? "added" : "edited";
  }

  private scheduleFlush() {
    this.clearFlushTimeout();

    this.flushTimeout = setTimeout(() => {
      this.finalizeIntent();
    }, INTENT_TIMEOUT);
  }

  private clearFlushTimeout() {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
  }

  private finalizeIntent(): void {
    this.clearFlushTimeout();

    if (!this.pendingIntent) {
      return;
    }

    const pending = this.pendingIntent;
    this.pendingIntent = null;

    let hasChange = false;

    for (const line of pending.affectedLines) {
      const current = pending.currentContent.get(line) ?? "";
      const original = pending.originalContent.get(line) ?? "";

      if (current.trim() !== original.trim()) {
        hasChange = true;
        break;
      }
    }

    if (!hasChange) {
      return;
    }

    const lines = Array.from(pending.affectedLines).sort((a, b) => a - b);
    const startLine = lines[0] + 1; // 1 based line
    const endLine = lines[lines.length - 1] + 1;

    const contentLines: string[] = [];

    for (const line of lines) {
      const current = pending.currentContent.get(line) ?? "";
      contentLines.push(current);
    }

    const content = contentLines.join("\n");

    const intentEntry: IntentEntry = {
      id: `intent_${++this.idCounter}`,
      type: pending.type,
      filePath: pending.filePath,
      lineRange: {
        start: startLine,
        end: endLine,
      },
      content,
      timestamp: pending.lastActivityTime,
    };

    const merged = this.tryMergeWithRecent(intentEntry);

    if (merged) {
      const idx = this.buffer.findIndex((e) => e.id === merged.id);
      if (idx !== -1) {
        this.buffer[idx] = merged;
      }
    } else {
      this.buffer.push(intentEntry);

      while (this.buffer.length > MAX_BUFFER_SIZE) {
        this.buffer.shift();
      }
    }
  }

  private tryMergeWithRecent(intentEntry: IntentEntry): IntentEntry | null {
    const now = Date.now();

    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const existing = this.buffer[i];

      if (now - existing.timestamp > BUFFER_MERGE_TIME_LIMIT) {
        break;
      }

      if (existing.filePath !== intentEntry.filePath) {
        continue;
      }

      const overlap =
        existing.lineRange.start <= intentEntry.lineRange.end &&
        intentEntry.lineRange.start <= existing.lineRange.end;

      // adjacent = things are next to each other (1 line away)
      const adjacent =
        Math.abs(existing.lineRange.end - intentEntry.lineRange.start) <= 1 ||
        Math.abs(intentEntry.lineRange.end - existing.lineRange.start) <= 1;

      if (overlap || adjacent) {
        const mergedType: IntentType =
          existing.type === "edited" || intentEntry.type === "edited"
            ? "edited"
            : existing.type === "pasted" || intentEntry.type === "pasted"
              ? "pasted"
              : intentEntry.type;

        const mergedRange = {
          start: Math.min(
            existing.lineRange.start,
            intentEntry.lineRange.start,
          ),
          end: Math.max(existing.lineRange.end, intentEntry.lineRange.end),
        };

        return {
          id: existing.id, // keeping the existing id
          type: mergedType,
          content: intentEntry.content,
          filePath: intentEntry.filePath,
          timestamp: intentEntry.timestamp,
          lineRange: mergedRange,
        };
      }
    }

    return null;
  }

  private handleActiveEditorChange(event: vscode.TextEditor | undefined): void {
    throw new Error("Method not implemented.");
  }
  dispose() {
    throw new Error("Method not implemented.");
  }
}
