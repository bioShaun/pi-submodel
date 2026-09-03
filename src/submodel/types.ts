/** Domain types shared across the editor, persistence, and the command seam. */

/** A model as offered by a Pi model registry. Provider-qualified value = `${provider}/${id}`. */
export interface RegistryModel {
  provider: string;
  id: string;
}

/** A selectable model choice: registry entry or retained unavailable configured value. */
export interface ModelChoice {
  value: string;
  provider: string;
  id: string;
  /** false when this is a retained configured value absent from the current registry. */
  available: boolean;
}

/** The managed model-policy fields for one named agent (unowned fields never live here). */
export interface AgentPolicy {
  model?: string;
  thinking?: string | false;
  fallbackModels?: string[] | false;
}

export type NotifyLevel = "info" | "warning" | "error";

export interface EditorExit {
  action: "saved" | "cancelled";
}

/** Result of applying a confirmed save through the command seam. */
export type PersistResult = { ok: true } | { ok: false; error: string };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
