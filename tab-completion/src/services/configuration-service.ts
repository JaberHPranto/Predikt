import * as vscode from "vscode";

export interface TabCompletionConfig {
  // API Keys
  openrouterApiKey: string;
  groqApiKey: string;
  fireworksApiKey: string;

  // Model Settings
  model: string;
  maxTokens: number;

  // Cache Settings
}

const DEFAULT_CONFIG: TabCompletionConfig = {
  openrouterApiKey: "",
  groqApiKey: "",
  fireworksApiKey: "",

  model: "qwen/qwen3-32b",
  maxTokens: 512,
};

export class ConfigurationService implements vscode.Disposable {
  private static instance: ConfigurationService | null = null;
  private cachedConfig: TabCompletionConfig;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeListeners: Set<(config: TabCompletionConfig) => void> =
    new Set();

  public static getInstance(): ConfigurationService {
    if (!ConfigurationService.instance) {
      ConfigurationService.instance = new ConfigurationService();
    }
    return ConfigurationService.instance;
  }

  private constructor() {
    // Private constructor to prevent direct instantiation
    this.cachedConfig = this.loadConfiguration();
    this.registerConfigurationChangeListener();
  }

  private loadConfiguration(): TabCompletionConfig {
    const config = vscode.workspace.getConfiguration("predikt"); // not secure

    return {
      openrouterApiKey: config.get<string>("openrouterApiKey", ""),
      groqApiKey: config.get<string>("groqApiKey", ""),
      fireworksApiKey: config.get<string>("fireworksApiKey", ""),
      model: config.get<string>("model", DEFAULT_CONFIG.model),
      maxTokens: config.get<number>("maxTokens", DEFAULT_CONFIG.maxTokens),
    };
  }

  private registerConfigurationChangeListener() {
    const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("predikt")) {
        this.cachedConfig = this.loadConfiguration();
        this.notifyChangeListeners();
      }
    });
    this.disposables.push(disposable);
  }

  private notifyChangeListeners() {
    for (const listener of this.changeListeners) {
      try {
        listener(this.cachedConfig);
      } catch (error) {
        console.error("Error in config listener:", error);
      }
    }
  }

  get model(): string {
    return this.cachedConfig.model;
  }
  get fireworksApiKey(): string {
    return this.cachedConfig.fireworksApiKey;
  }
  get groqApiKey(): string {
    return this.cachedConfig.groqApiKey;
  }
  get openrouterApiKey(): string {
    return this.cachedConfig.openrouterApiKey;
  }
  get maxTokens(): number {
    return this.cachedConfig.maxTokens;
  }

  onConfigChange(callback: (config: TabCompletionConfig) => void) {
    this.changeListeners.add(callback);
    return {
      dispose: () => {
        this.changeListeners.delete(callback);
      },
    };
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.changeListeners.clear();
  }
}

export function getConfig(): ConfigurationService {
  return ConfigurationService.getInstance();
}
