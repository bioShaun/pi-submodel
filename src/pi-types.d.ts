/**
 * Minimal structural declarations for the Pi host API surface this extension uses.
 * The real package is provided by Pi at runtime (aliased by the loader); these types pin
 * the verified subset (Pi 0.84.4) so the extension typechecks without a checkout.
 */
declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionTheme {
    fg(color: string, text: string): string;
    bold(text: string): string;
  }

  export interface EditorComponentLike {
    render(width: number): string[];
    invalidate(): void;
    handleInput?(data: string): void;
    dispose?(): void;
  }

  export interface ExtensionUIContext {
    notify(message: string, level?: "info" | "warning" | "error"): void;
    theme: ExtensionTheme;
    custom<T>(
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: T) => void,
      ) => EditorComponentLike | Promise<EditorComponentLike>,
      options?: { overlay?: boolean },
    ): Promise<T | undefined>;
  }

  export interface RegistryModelLike {
    provider: string;
    id: string;
  }

  export interface ExtensionContext {
    mode: "tui" | "rpc" | "json" | "print";
    hasUI: boolean;
    cwd: string;
    scopedModels: ReadonlyArray<{ model: RegistryModelLike; thinkingLevel?: string }>;
    modelRegistry: {
      getAvailable(): RegistryModelLike[];
      getAll(): RegistryModelLike[];
      find(provider: string, modelId: string): RegistryModelLike | undefined;
    };
    ui: ExtensionUIContext;
  }

  export interface ExtensionCommandContext extends ExtensionContext {}

  export interface ExtensionAPI {
    registerCommand(
      name: string,
      options: {
        description?: string;
        getArgumentCompletions?: (argumentPrefix: string) => unknown;
        handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
      },
    ): void;
  }

  export const CONFIG_DIR_NAME: string;
  export function getAgentDir(): string;
  export function getSettingsPath(): string;
}
