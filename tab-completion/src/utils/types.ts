import * as vscode from "vscode";
export interface ChatStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    finish_reason: string | null;
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
  }[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ReplacementEdit {
  startPosition: vscode.Position;
  insertText: string;
}
export interface PendingCompletion {
  documentUri: string;
  edit: ReplacementEdit;
}

export type IntentType =
  | "added"
  | "pasted"
  | "edited"
  | "accepted"
  | "rejected";

export interface PendingIntent {
  type: IntentType;
  filePath: string;
  originalContent: Map<number, string>; // {1: 'console.log()'}
  currentContent: Map<number, string>; // {1: 'console.log("hello world")'}
  startTime: number;
  lastActivityTime: number;
  affectedLines: Set<number>;
}

export interface IntentEntry {
  id: string;
  type: IntentType;
  filePath: string;
  lineRange: {
    start: number;
    end: number;
  };
  content: string;
  timestamp: number;
  suggestionPreview?: string;
}
