/**
 * Test harness for the /submodel command seam: a temporary settings file, a fake model
 * registry, and a driveable editor component standing in for the Pi TUI host.
 */
import * as realFs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSubmodel } from "../../src/submodel/command.ts";
import type { SubmodelEditorComponent } from "../../src/submodel/editor/submodel-editor.ts";
import type { EditorExit, RegistryModel } from "../../src/submodel/types.ts";

const KEY_BYTES: Record<string, string> = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  enter: "\r",
  escape: "\x1b",
  backspace: "\x7f",
  tab: "\t",
  ctrlC: "\x03",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  // Kitty keyboard protocol encodings of the same keys (event types, alternate key
  // codes, modifier fields), as terminals send them with flags 1|2 active.
  kittyUp: "\x1b[1;1:1A",
  kittyDown: "\x1b[1;1:1B",
  kittyEscape: "\x1b[27::27;1:1u",
  kittyCtrlC: "\x1b[99::99;5:1u",
  // Simplified (no alternate key code) Kitty Ctrl+C forms.
  kittyCtrlCSimplified: "\x1b[99;5u",
  kittyCtrlCEvent: "\x1b[99;5:1u",
};

export interface StartOptions {
  /** Initial settings file content; undefined/null means the file does not exist. */
  settings?: string | null;
  models?: RegistryModel[];
  /** Installed pi-subagents version reported to the command; default "0.64.0". */
  version?: string | null;
  /** Render width; default 100 (side-by-side panes). */
  width?: number;
}

export interface Session {
  /** false when the command refused to open the editor (version gate, bad settings). */
  readonly opened: boolean;
  press(...keys: string[]): void;
  type(text: string): void;
  lines(): string[];
  text(): string;
  awaitExit(): Promise<EditorExit>;
  readonly notifications: Array<{ message: string; level: string }>;
  readonly settingsPath: string;
  readonly tmpDir: string;
  readSettings(): string | null;
  settingsExists(): boolean;
  /** Simulate an external process rewriting the settings file while the editor is open. */
  writeSettingsExternally(content: string): void;
  cleanup(): void;
}

export const DEFAULT_TEST_MODELS: RegistryModel[] = [
  { provider: "tcuni", id: "gpt-5.6-luna" },
  { provider: "tcuni", id: "gpt-5.6-sol" },
  { provider: "qwen-local", id: "qwen3.8-27b" },
];

export async function startSubmodel(options: StartOptions = {}): Promise<Session> {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-submodel-test-"));
  const settingsPath = join(tmpDir, "settings.json");
  if (options.settings !== undefined && options.settings !== null) {
    realFs.writeFileSync(settingsPath, options.settings, "utf8");
  }

  let component: SubmodelEditorComponent | null = null;
  let exited = false;
  let resolveExit!: (exit: EditorExit) => void;
  const exitPromise = new Promise<EditorExit>((resolve) => {
    resolveExit = resolve;
  });
  const notifications: Array<{ message: string; level: string }> = [];
  const width = options.width ?? 100;

  const running = runSubmodel({
    fs: realFs,
    settingsPath,
    piSubagentsVersion: options.version === undefined ? "0.64.0" : options.version,
    registry: options.models ?? DEFAULT_TEST_MODELS,
    openEditor: (candidate) => {
      component = candidate;
      candidate.setExitHandler((exit) => {
        exited = true;
        resolveExit(exit);
      });
      return exitPromise;
    },
    notify: (message, level) => notifications.push({ message, level }),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const opened = component !== null;

  const session: Session = {
    opened,
    press(...keys: string[]): void {
      if (!component) throw new Error("editor is not open");
      for (const key of keys) {
        const raw = KEY_BYTES[key] ?? (key.length === 1 ? key : undefined);
        if (raw === undefined) throw new Error(`unsupported test key: ${key}`);
        component.handleInput(raw);
      }
    },
    type(text: string): void {
      if (!component) throw new Error("editor is not open");
      for (const char of text) component.handleInput(char);
    },
    lines(): string[] {
      if (!component) throw new Error("editor is not open");
      return component.render(width);
    },
    text(): string {
      if (!component) throw new Error("editor is not open");
      return component.render(width).join("\n");
    },
    awaitExit(): Promise<EditorExit> {
      if (!opened) return Promise.reject(new Error("editor never opened"));
      return exitPromise;
    },
    notifications,
    settingsPath,
    tmpDir,
    readSettings(): string | null {
      return realFs.existsSync(settingsPath) ? realFs.readFileSync(settingsPath, "utf8") : null;
    },
    settingsExists(): boolean {
      return realFs.existsSync(settingsPath);
    },
    writeSettingsExternally(content: string): void {
      realFs.writeFileSync(settingsPath, content, "utf8");
    },
    cleanup(): void {
      // Tests must not leave an editor suspended when an assertion fails before the
      // normal close sequence. Cycle through the modes with non-destructive keys, then
      // accept a discard prompt if the test made draft changes.
      for (let attempt = 0; !exited && attempt < 6; attempt += 1) {
        component?.handleInput("\x1b");
        component?.handleInput("\x03");
        component?.handleInput("\x1b");
        component?.handleInput("\r");
      }
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
  void running;
  return session;
}
