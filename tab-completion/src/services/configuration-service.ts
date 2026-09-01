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
  completionCacheMaxEntries: number;
  completionCacheTtlMs: number;
}

const DEFAULT_CONFIG: TabCompletionConfig = {
  openrouterApiKey: "",
  groqApiKey: "",
  fireworksApiKey: "",

  model: "qwen/qwen3-32b",
  maxTokens: 512,

  completionCacheMaxEntries: 100,
  completionCacheTtlMs: 30 * 1000, // 30 seconds
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
      completionCacheMaxEntries: config.get<number>(
        "completionCacheMaxEntries",
        DEFAULT_CONFIG.completionCacheMaxEntries,
      ),
      completionCacheTtlMs: config.get<number>(
        "completionCacheTtlMs",
        DEFAULT_CONFIG.completionCacheTtlMs,
      ),
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

  onConfigChange(callback: (config: TabCompletionConfig) => void) {
    this.changeListeners.add(callback);
    return {
      dispose: () => {
        this.changeListeners.delete(callback);
      },
    };
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
  get completionCacheMaxEntries(): number {
    return this.cachedConfig.completionCacheMaxEntries;
  }
  get completionCacheTtlMs(): number {
    return this.cachedConfig.completionCacheTtlMs;
  }

  dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.changeListeners.clear();
  }
}

export function getConfig(): ConfigurationService {
  return ConfigurationService.getInstance();
}
