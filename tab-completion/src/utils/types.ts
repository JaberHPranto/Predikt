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
