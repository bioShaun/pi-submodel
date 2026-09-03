/**
 * The editable draft and the structural merge that turns a draft into the next on-disk
 * document. The merge writes only managed fields and preserves every unowned field at
 * top level, inside `subagents`, and inside each agent override. Cleanup removes override
 * entries and parent objects that the operation leaves empty.
 */
import { MANAGED_AGENT_FIELDS } from "./pi-subagents.ts";
import type { AgentPolicy } from "./types.ts";
import { isPlainObject } from "./types.ts";

export interface Draft {
  /** `undefined` = Inherit: no `subagents.defaultModel` field. */
  defaultModel?: string;
  /** Managed policy per agent touched or loaded from disk. Absent policy fields inherit. */
  agents: Record<string, AgentPolicy>;
}

export function cloneManagedPolicy(policy: AgentPolicy): AgentPolicy {
  const copy: AgentPolicy = {};
  if (policy.model !== undefined) copy.model = policy.model;
  if (policy.thinking !== undefined) copy.thinking = policy.thinking;
  if (policy.fallbackModels !== undefined) {
    copy.fallbackModels = policy.fallbackModels === false ? false : [...policy.fallbackModels];
  }
  return copy;
}

export function cloneDraft(draft: Draft): Draft {
  const agents: Record<string, AgentPolicy> = {};
  for (const [name, policy] of Object.entries(draft.agents)) {
    agents[name] = cloneManagedPolicy(policy);
  }
  const clone: Draft = { agents };
  if (draft.defaultModel !== undefined) clone.defaultModel = draft.defaultModel;
  return clone;
}

/** Policy serialized for dirty comparison (managed fields only). */
export function policyKey(policy: AgentPolicy | undefined): string {
  return JSON.stringify([
    policy?.model ?? null,
    policy?.thinking ?? null,
    policy?.fallbackModels === false ? false : policy?.fallbackModels ?? null,
  ]);
}

/** true when any managed field differs from the policy the editor loaded. */
export function isDraftDirty(draft: Draft, loaded: { defaultModel?: string; agents: Record<string, AgentPolicy> }): boolean {
  if ((draft.defaultModel ?? undefined) !== (loaded.defaultModel ?? undefined)) return true;
  const names = new Set([...Object.keys(draft.agents), ...Object.keys(loaded.agents)]);
  for (const name of names) {
    if (policyKey(draft.agents[name] ?? {}) !== policyKey(loaded.agents[name] ?? {})) return true;
  }
  return false;
}

function isManagedField(field: string): boolean {
  return (MANAGED_AGENT_FIELDS as readonly string[]).includes(field);
}

function splitUnowned(entry: Record<string, unknown>): Record<string, unknown> {
  const unowned: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(entry)) {
    if (!isManagedField(field)) unowned[field] = value;
  }
  return unowned;
}

/**
 * Apply the draft's managed fields onto `doc` (cloned) and return the next document.
 * Agents not in the draft keep their on-disk overrides; managed fields absent from the
 * draft are removed (Inherit / Default / empty route), while unowned fields survive.
 */
export function applyPolicy(doc: Record<string, unknown>, draft: Draft): Record<string, unknown> {
  const next: Record<string, unknown> = { ...doc };

  const source = isPlainObject(next["subagents"]) ? (next["subagents"] as Record<string, unknown>) : {};
  const sub: Record<string, unknown> = { ...source };

  if (draft.defaultModel !== undefined) {
    sub["defaultModel"] = draft.defaultModel;
  } else {
    delete sub["defaultModel"];
  }

  const overridesSource = isPlainObject(sub["agentOverrides"]) ? (sub["agentOverrides"] as Record<string, unknown>) : {};
  const overrides: Record<string, unknown> = { ...overridesSource };

  const names = new Set([...Object.keys(draft.agents), ...Object.keys(overridesSource)]);
  for (const name of names) {
    const policy = draft.agents[name];
    const onDisk = overridesSource[name];
    const unowned = isPlainObject(onDisk) ? splitUnowned(onDisk) : {};

    const entry: Record<string, unknown> = { ...unowned };
    if (policy?.model !== undefined) entry["model"] = policy.model;
    if (policy?.thinking !== undefined) entry["thinking"] = policy.thinking;
    if (policy?.fallbackModels !== undefined && policy.fallbackModels !== false && policy.fallbackModels.length > 0) {
      entry["fallbackModels"] = [...policy.fallbackModels];
    }

    if (Object.keys(entry).length > 0) {
      overrides[name] = entry;
    } else {
      delete overrides[name];
    }
  }

  if (Object.keys(overrides).length > 0) {
    sub["agentOverrides"] = overrides;
  } else {
    delete sub["agentOverrides"];
  }

  if (Object.keys(sub).length > 0) {
    next["subagents"] = sub;
  } else {
    delete next["subagents"];
  }

  return next;
}

/** The resulting `subagents` object after applying the draft (for the save preview). */
export function previewSubagents(doc: Record<string, unknown>, draft: Draft): Record<string, unknown> {
  const merged = applyPolicy(doc, draft);
  const subagents = merged["subagents"];
  return isPlainObject(subagents) ? subagents : {};
}
