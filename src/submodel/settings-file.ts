/**
 * Settings file persistence: read + validate the user settings document, fingerprint it,
 * and write an updated document atomically (same-directory temp file, private permissions,
 * rename over the original, preserving an existing file's permission mode).
 */
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import type { AgentPolicy } from "./types.ts";
import { isPlainObject } from "./types.ts";

/** Minimal fs surface so failure modes (rename errors, modes) are injectable in tests. */
export interface FsLike {
  existsSync(path: string): boolean;
  readFileSync(path: string): Buffer;
  statSync(path: string): { mode: number };
  writeFileSync(path: string, data: string | Buffer, options?: { flag?: string; mode?: number }): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
}

export const ABSENT_FINGERPRINT = "absent";

export class SettingsError extends Error {}

export interface SettingsSnapshot {
  /** Parsed settings document. Absent or empty files yield {}. */
  doc: Record<string, unknown>;
  /** true when the settings file existed on disk when loaded. */
  existed: boolean;
  /** Content fingerprint used to detect concurrent changes between open and save. */
  fingerprint: string;
}

export interface LoadedSettings extends SettingsSnapshot {
  /** Managed policy extracted from the document (managed fields only). */
  defaultModel?: string;
  agents: Record<string, AgentPolicy>;
}

function fingerprintOf(raw: Buffer | null): string {
  if (raw === null) return ABSENT_FINGERPRINT;
  return createHash("sha256").update(raw).digest("hex");
}

function fail(path: string, detail: string): never {
  throw new SettingsError(`Invalid settings in ${path}: ${detail}`);
}

function validateDocument(path: string, doc: unknown): void {
  if (!isPlainObject(doc)) fail(path, "expected a JSON object at the root");

  const subagents = doc["subagents"];
  if (subagents !== undefined && !isPlainObject(subagents)) {
    fail(path, '"subagents" must be an object');
  }
  if (!isPlainObject(subagents)) return;

  const defaultModel = subagents["defaultModel"];
  if (defaultModel !== undefined && typeof defaultModel !== "string") {
    fail(path, '"subagents.defaultModel" must be a string');
  }

  const overrides = subagents["agentOverrides"];
  if (overrides !== undefined && !isPlainObject(overrides)) {
    fail(path, '"subagents.agentOverrides" must be an object');
  }
  if (!isPlainObject(overrides)) return;

  for (const [name, entry] of Object.entries(overrides)) {
    if (!isPlainObject(entry)) fail(path, `"subagents.agentOverrides.${name}" must be an object`);
    const model = entry["model"];
    if (model !== undefined && typeof model !== "string") {
      fail(path, `"subagents.agentOverrides.${name}.model" must be a string`);
    }
    const thinking = entry["thinking"];
    if (thinking !== undefined && typeof thinking !== "string" && thinking !== false) {
      fail(path, `"subagents.agentOverrides.${name}.thinking" must be a string or false`);
    }
    const fallbacks = entry["fallbackModels"];
    if (fallbacks !== undefined && fallbacks !== false) {
      if (!Array.isArray(fallbacks) || !fallbacks.every((m) => typeof m === "string")) {
        fail(path, `"subagents.agentOverrides.${name}.fallbackModels" must be an array of strings or false`);
      }
    }
  }
}

function extractAgentPolicy(entry: Record<string, unknown>): AgentPolicy {
  const policy: AgentPolicy = {};
  if (typeof entry["model"] === "string") policy.model = entry["model"];
  if (typeof entry["thinking"] === "string" || entry["thinking"] === false) {
    policy.thinking = entry["thinking"];
  }
  if (Array.isArray(entry["fallbackModels"])) {
    policy.fallbackModels = [...(entry["fallbackModels"] as string[])];
  } else if (entry["fallbackModels"] === false) {
    policy.fallbackModels = false;
  }
  return policy;
}

export function extractManagedPolicy(doc: Record<string, unknown>): {
  defaultModel?: string;
  agents: Record<string, AgentPolicy>;
} {
  const agents: Record<string, AgentPolicy> = {};
  const subagents = doc["subagents"];
  if (isPlainObject(subagents)) {
    const overrides = subagents["agentOverrides"];
    if (isPlainObject(overrides)) {
      for (const [name, entry] of Object.entries(overrides)) {
        if (isPlainObject(entry)) agents[name] = extractAgentPolicy(entry);
      }
    }
  }
  const result: { defaultModel?: string; agents: Record<string, AgentPolicy> } = { agents };
  if (isPlainObject(subagents) && typeof subagents["defaultModel"] === "string") {
    result.defaultModel = subagents["defaultModel"];
  }
  return result;
}

/**
 * Read and validate the settings file. Missing files load as an empty document; malformed
 * content or incompatible shapes throw SettingsError so editing never guesses.
 */
interface ValidatedDocument {
  existed: boolean;
  fingerprint: string;
  doc: Record<string, unknown>;
}

/** Read and validate the on-disk document, shared by open and pre-save re-reads. */
function readValidatedDocument(fs: FsLike, path: string): ValidatedDocument {
  if (!fs.existsSync(path)) {
    return { existed: false, fingerprint: ABSENT_FINGERPRINT, doc: {} };
  }
  const raw = fs.readFileSync(path);
  if (raw.length === 0) {
    return { existed: true, fingerprint: fingerprintOf(raw), doc: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new SettingsError(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  validateDocument(path, parsed);
  return { existed: true, fingerprint: fingerprintOf(raw), doc: parsed as Record<string, unknown> };
}

export function readSettingsFile(fs: FsLike, path: string): LoadedSettings {
  const snapshot = readValidatedDocument(fs, path);
  const managed = extractManagedPolicy(snapshot.doc);
  const loaded: LoadedSettings = {
    doc: snapshot.doc,
    existed: snapshot.existed,
    fingerprint: snapshot.fingerprint,
    agents: managed.agents,
  };
  if (managed.defaultModel !== undefined) loaded.defaultModel = managed.defaultModel;
  return loaded;
}

/** Re-read the current on-disk content and validate it (used before every save). */export function rereadSnapshot(fs: FsLike, path: string): SettingsSnapshot {
  const snapshot = readValidatedDocument(fs, path);
  return { doc: snapshot.doc, existed: snapshot.existed, fingerprint: snapshot.fingerprint };
}

/**
 * Write the updated document atomically: serialize with two-space indent, write a temp
 * file in the same directory with private permissions (preserving the existing file's
 * mode when one exists), then rename over the target. Cleans up the temp file on failure.
 */
export function writeSettingsFile(
  fs: FsLike,
  path: string,
  doc: Record<string, unknown>,
  existed: boolean,
): string {
  const data = JSON.stringify(doc, null, 2) + "\n";
  const dir = dirname(path);
  let mode = 0o600;
  if (existed && fs.existsSync(path)) {
    mode = fs.statSync(path).mode & 0o777;
  }
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
  try {
    fs.writeFileSync(tmp, data, { flag: "wx", mode });
    fs.renameSync(tmp, path);
  } catch (error) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      // best-effort cleanup; the original error is what matters
    }
    throw error;
  }
  // Report the fingerprint of what we just wrote so the caller can accept future saves
  // against it (our own write is not an external change).
  return fingerprintOf(Buffer.from(data, "utf8"));
}
