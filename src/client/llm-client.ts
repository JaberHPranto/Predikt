import * as vscode from "vscode";
import { getConfig } from "../services/configuration-service";
import { ChatMessage, ChatStreamChunk } from "../utils/types";

export type LLMProvider = "openrouter" | "groq" | "fireworks";

interface ProviderConfig {
  endpoint: string;
  getApiKey: () => string;
  getModel: () => string;
}

const PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    getApiKey: () => getConfig().openrouterApiKey,
    getModel: () => getConfig().model,
  },
  groq: {
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    getApiKey: () => getConfig().groqApiKey,
    getModel: () => getConfig().model,
  },
  fireworks: {
    endpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
    getApiKey: () => getConfig().fireworksApiKey,
    getModel: () => getConfig().model,
  },
};

export class LLMClient implements vscode.Disposable {
  private readonly outputChannel: vscode.OutputChannel;
  private pendingRequest: AbortController | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[LLMClient] ${message}`);
  }

  getActiveProvider(): LLMProvider | null {
    const config = getConfig();
    if (config.openrouterApiKey) {
      return "openrouter";
    } else if (config.groqApiKey) {
      return "groq";
    } else if (config.fireworksApiKey) {
      return "fireworks";
    }

    return null;
  }

  async complete(
    messages: ChatMessage[],
  ): Promise<AsyncGenerator<string, void, unknown>> {
    const activeProvider = this.getActiveProvider();

    if (!activeProvider) {
      throw new Error("No API key configured");
    }

    this.cancelRequest();
    this.pendingRequest = new AbortController();

    const config = getConfig();
    const maxTokens = config.maxTokens;

    const providerConfig = PROVIDER_CONFIGS[activeProvider];
    const model = providerConfig.getModel();

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      stream: true,
      temperature: 0.1,
    };

    if (activeProvider === "openrouter") {
      body.reasoning = { enabled: false };
    }

    this.log(
      `[${activeProvider}] Request: model=${model}, max_tokens: ${maxTokens}`,
    );

    return this.streamRequest(
      providerConfig.endpoint,
      body,
      providerConfig.getApiKey(),
      this.pendingRequest.signal,
    );
  }

  cancelRequest() {
    if (this.pendingRequest) {
      this.pendingRequest.abort();
      this.pendingRequest = null;
    }
  }

  private async *streamRequest(
    endpoint: string,
    body: Record<string, unknown>,
    apiKey: string,
    signal: AbortSignal,
  ): AsyncGenerator<string, void, unknown> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Request failed with status ${response.status}: ${errorText}`,
      );
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              return;
            }

            try {
              const chunk = JSON.parse(data) as ChatStreamChunk;
              if (chunk.choices && chunk.choices.length > 0) {
                const content = chunk.choices[0].delta?.content;
                if (content) {
                  yield content;
                }
              }
            } catch (error) {
              this.log(`Error parsing stream data: ${error}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  dispose() {
    this.cancelRequest();
  }
}
