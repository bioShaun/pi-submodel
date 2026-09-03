/**
 * Constants and compatibility rules for the native pi-subagents settings contract
 * (nicobailon/pi-subagents 0.64.x, documented in its docs/models.md).
 */

/** pi-subagents 0.64 builtin agent names, in navigator order. */
export const BUILTIN_AGENTS = ["scout", "researcher", "worker", "reviewer", "oracle", "delegate"] as const;

/** Thinking levels supported by the native contract, least to most thinking. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Guidance shown (in the editor and via the host notifier) after a confirmed save. */
export const RELOAD_GUIDANCE = "run /reload, then /subagents-models to verify the live mapping";

/** The only subagents fields this editor owns. Everything else is preserved on save. */
export const MANAGED_AGENT_FIELDS = ["model", "thinking", "fallbackModels"] as const;

/** The release targets 0.64.x exclusively; other versions are reported, not guessed at. */
export function isCompatiblePiSubagentsVersion(version: string | null): boolean {
  if (version === null) return true;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major === 0 && minor === 64;
}
