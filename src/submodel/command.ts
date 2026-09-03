/**
 * The /submodel command seam: everything the command does, expressed against injected
 * dependencies (settings path, model registry snapshot, editor host, notifier). Tests
 * drive this with a temporary settings file, a fake registry, and a driveable editor;
 * src/index.ts wires the real Pi host in.
 */
import { createSubmodelEditor } from "./editor/submodel-editor.ts";
import type { SubmodelEditorComponent } from "./editor/submodel-editor.ts";
import { plainTheme } from "./editor/theme.ts";
import type { EditorTheme } from "./editor/theme.ts";
import { buildModelChoices } from "./model-catalog.ts";
import { isCompatiblePiSubagentsVersion } from "./pi-subagents.ts";
import { readSettingsFile, rereadSnapshot, writeSettingsFile, SettingsError } from "./settings-file.ts";
import type { FsLike, LoadedSettings } from "./settings-file.ts";
import { applyPolicy } from "./settings-draft.ts";
import type { Draft } from "./settings-draft.ts";
import type { EditorExit, ModelChoice, NotifyLevel, PersistResult, RegistryModel } from "./types.ts";

export interface SubmodelDeps {
  fs: FsLike;
  /** Absolute path of the user-level settings file to edit. */
  settingsPath: string;
  /** Installed pi-subagents version, or null when not detectable. */
  piSubagentsVersion: string | null;
  /** Models currently available in the host's (scoped) registry. */
  registry: RegistryModel[];
  theme?: EditorTheme;
  /** Host adapter that mounts the editor component and resolves on exit. */
  openEditor(component: SubmodelEditorComponent): Promise<EditorExit>;
  notify(message: string, level: NotifyLevel): void;
}

export function versionGateError(version: string | null): string | null {
  if (version === null) return null;
  if (!isCompatiblePiSubagentsVersion(version)) {
    return `pi-submodel targets nicobailon/pi-subagents 0.64.x, but version ${version} was detected. ` +
      "The settings schema may differ, so the editor was not opened. No settings were written.";
  }
  return null;
}

function collectConfiguredValues(loaded: LoadedSettings): string[] {
  const values: string[] = [];
  if (loaded.defaultModel !== undefined) values.push(loaded.defaultModel);
  for (const policy of Object.values(loaded.agents)) {
    if (policy.model !== undefined) values.push(policy.model);
    if (Array.isArray(policy.fallbackModels)) values.push(...policy.fallbackModels);
  }
  return values;
}

function createPersist(deps: SubmodelDeps, openedFingerprint: string): (draft: Draft) => PersistResult {
  // Tracks the on-disk state this editor session may legitimately overwrite: the file as
  // it was when the editor opened, updated to our own writes after each confirmed save.
  let expectedFingerprint = openedFingerprint;
  return (draft: Draft): PersistResult => {
    let snapshot;
    try {
      snapshot = rereadSnapshot(deps.fs, deps.settingsPath);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (snapshot.fingerprint !== expectedFingerprint) {
      return {
        ok: false,
        error: "Settings changed on disk since /submodel was opened — save refused to avoid overwriting them. " +
          "Close and reopen /submodel to load the new file.",
      };
    }
    const next = applyPolicy(snapshot.doc, draft);
    try {
      expectedFingerprint = writeSettingsFile(deps.fs, deps.settingsPath, next, snapshot.existed);
    } catch (error) {
      return { ok: false, error: `Failed to write ${deps.settingsPath}: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { ok: true };
  };
}

/**
 * Run the /submodel flow: gate on pi-subagents compatibility, load + validate settings,
 * build the model catalog, mount the editor, and report the outcome. Never writes unless
 * the user explicitly confirms a save inside the editor.
 */
export async function runSubmodel(deps: SubmodelDeps): Promise<void> {
  const gateError = versionGateError(deps.piSubagentsVersion);
  if (gateError !== null) {
    deps.notify(gateError, "error");
    return;
  }
  if (deps.piSubagentsVersion === null) {
    deps.notify("pi-subagents was not detected; settings will still be written in the native 0.64.x shape.", "warning");
  }

  let loaded: LoadedSettings;
  try {
    loaded = readSettingsFile(deps.fs, deps.settingsPath);
  } catch (error) {
    const detail = error instanceof SettingsError ? error.message : `Cannot read ${deps.settingsPath}: ${error instanceof Error ? error.message : String(error)}`;
    deps.notify(detail, "error");
    return;
  }

  const catalog: ModelChoice[] = buildModelChoices(deps.registry, collectConfiguredValues(loaded));
  const editor = createSubmodelEditor({
    loaded,
    catalog,
    settingsPath: deps.settingsPath,
    theme: deps.theme ?? plainTheme,
    persist: createPersist(deps, loaded.fingerprint),
    notify: deps.notify,
  });

  // The editor reports a confirmed save synchronously via deps.notify; the exit action
  // only distinguishes how the editor was closed.
  await deps.openEditor(editor);
}
