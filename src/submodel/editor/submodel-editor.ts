/**
 * The /submodel editor component: a two-pane, keyboard-driven TUI (variant B).
 *
 * Left pane navigates the default entry and named agents; right pane edits the selected
 * entry's managed policy (primary model, thinking, ordered fallback route). All edits
 * mutate an in-memory draft; saving goes through preview + explicit confirmation and the
 * injected persist() function (which owns fingerprints, merges, and the atomic write).
 *
 * The component is framework-free (render/handleInput/invalidate) so tests can drive it
 * directly with synthetic keys and read its rendered lines.
 */
import { parseKey } from "../keys.ts";
import { BUILTIN_AGENTS, RELOAD_GUIDANCE, THINKING_LEVELS } from "../pi-subagents.ts";
import { fuzzyFilter } from "../model-catalog.ts";
import { cloneDraft, isDraftDirty, previewSubagents } from "../settings-draft.ts";
import type { Draft } from "../settings-draft.ts";
import type { LoadedSettings } from "../settings-file.ts";
import type { AgentPolicy, EditorExit, ModelChoice, NotifyLevel, PersistResult } from "../types.ts";
import { padEndAnsi, truncateAnsi, visibleWidth } from "./render-utils.ts";
import type { EditorTheme } from "./theme.ts";

export const INHERIT = "__inherit__";
export const DEFAULT_THINKING = "__default__";

type EntryKind = "default" | "agent";

export interface SubmodelEditorDeps {
  loaded: LoadedSettings;
  catalog: ModelChoice[];
  settingsPath: string;
  theme: EditorTheme;
  persist(draft: Draft): PersistResult;
  /** Host notifier, called synchronously the moment a confirmed save succeeds. */
  notify(message: string, level: NotifyLevel): void;
}

export interface SubmodelEditorComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  setExitHandler(handler: (exit: EditorExit) => void): void;
}

type Mode = "navigate" | "field" | "selector" | "preview" | "discard";

type SelectorKind = "default-model" | "agent-model" | "thinking" | "fallback-add";

interface SelectorItem {
  key: string;
  label: string;
  note?: string;
}

interface SelectorState {
  kind: SelectorKind;
  agent: string | null;
  query: string;
  cursor: number;
  notice?: string;
}

interface Banner {
  level: "success" | "error";
  lines: string[];
}

const NAV_WIDTH_MIN = 26;
const MIN_SIDE_BY_SIDE = 64;
const SELECTOR_MAX_VISIBLE = 8;

export function createSubmodelEditor(deps: SubmodelEditorDeps): SubmodelEditorComponent {
  const { theme, catalog, loaded } = deps;

  const agentNames: string[] = [];
  for (const builtin of BUILTIN_AGENTS) {
    if (!agentNames.includes(builtin)) agentNames.push(builtin);
  }
  for (const name of Object.keys(loaded.agents).sort()) {
    if (!agentNames.includes(name)) agentNames.push(name);
  }
  const entries: EntryKind[] = ["default", ...agentNames.map(() => "agent" as const)];

  let draft: Draft = { agents: {} };
  if (loaded.defaultModel !== undefined) draft.defaultModel = loaded.defaultModel;
  for (const [name, policy] of Object.entries(loaded.agents)) {
    const copy: AgentPolicy = {};
    if (policy.model !== undefined) copy.model = policy.model;
    if (policy.thinking !== undefined) copy.thinking = policy.thinking;
    if (policy.fallbackModels !== undefined) {
      copy.fallbackModels = policy.fallbackModels === false ? false : [...policy.fallbackModels];
    }
    draft.agents[name] = copy;
  }
  let baseline: Draft = cloneDraft(draft);

  let mode: Mode = "navigate";
  let selectedIndex = 0;
  let fieldIndex = 0;
  let fallbackCursor = 0;
  let selector: SelectorState | null = null;
  let banner: Banner | null = null;
  let previewOffset = 0;
  let savedOnce = false;
  let exited = false;
  let exitHandler: ((exit: EditorExit) => void) | null = null;
  let cache: { width: number; lines: string[] } | null = null;

  function bump(): void {
    cache = null;
  }

  function exit(result: EditorExit): void {
    if (exited) return;
    exited = true;
    exitHandler?.(result);
  }

  /** Close the editor; the action is "saved" when any confirmed save happened. */
  function exitNow(): void {
    exit({ action: savedOnce ? "saved" : "cancelled" });
  }

  function entryName(index: number): string | null {
    if (index === 0) return null;
    return agentNames[index - 1] ?? null;
  }

  function policyFor(name: string | null): AgentPolicy | null {
    return name === null ? null : draft.agents[name] ?? {};
  }

  function fieldCount(name: string | null): number {
    return name === null ? 1 : 3;
  }

  function setPolicy(name: string, policy: AgentPolicy): void {
    draft.agents[name] = policy;
  }

  function fallbacksOf(name: string): string[] {
    const policy = policyFor(name);
    if (!policy || !Array.isArray(policy.fallbackModels)) return [];
    return policy.fallbackModels;
  }

  function availableValues(): Set<string> {
    return new Set(catalog.filter((choice) => choice.available).map((choice) => choice.value));
  }

  function isUnavailable(value: string): boolean {
    return !availableValues().has(value);
  }

  function changedEntries(): Set<string> {
    const changed = new Set<string>();
    if ((draft.defaultModel ?? undefined) !== (baseline.defaultModel ?? undefined)) changed.add("default");
    for (const name of agentNames) {
      if (policyKeyOf(draft.agents[name]) !== policyKeyOf(baseline.agents[name])) changed.add(name);
    }
    return changed;
  }

  function isDirty(): boolean {
    return isDraftDirty(draft, baseline);
  }

  function policyKeyOf(policy: AgentPolicy | undefined): string {
    return JSON.stringify([
      policy?.model ?? null,
      policy?.thinking ?? null,
      policy?.fallbackModels === false ? false : policy?.fallbackModels ?? null,
    ]);
  }

  function openSelector(kind: SelectorKind, agent: string | null): void {
    const state: SelectorState = { kind, agent, query: "", cursor: 0 };
    const items = selectorItems(state);
    const currentValue = currentSelectorValue(state);
    const index = items.findIndex((item) => item.key === currentValue);
    state.cursor = index === -1 ? 0 : index;
    selector = state;
    mode = "selector";
    bump();
  }

  function currentSelectorValue(state: SelectorState): string | undefined {
    if (state.kind === "default-model") return draft.defaultModel ?? INHERIT;
    if (state.kind === "agent-model") return state.agent ? policyFor(state.agent)?.model ?? INHERIT : INHERIT;
    if (state.kind === "thinking") {
      const thinking = state.agent ? policyFor(state.agent)?.thinking : undefined;
      // `false` (explicit opt-out) has no selector entry; land on the first item instead.
      return thinking === false ? undefined : thinking ?? DEFAULT_THINKING;
    }
    return undefined;
  }

  function selectorItems(state: SelectorState): SelectorItem[] {
    if (state.kind === "thinking") {
      return [
        { key: DEFAULT_THINKING, label: "Default", note: "remove the thinking override" },
        ...THINKING_LEVELS.map((level) => ({ key: level, label: level })),
      ];
    }
    const items: SelectorItem[] = [];
    // Inherit is only meaningful where a model is being assigned, never when appending
    // to a fallback route (an "inherit" entry there would be nonsense).
    if (state.kind === "default-model" || state.kind === "agent-model") {
      items.push({ key: INHERIT, label: "Inherit", note: state.kind === "agent-model" ? "remove this agent's model override" : "remove the default model" });
    }
    for (const choice of catalog) {
      items.push({
        key: choice.value,
        label: choice.value,
        note: choice.available ? undefined : "unavailable",
      });
    }
    return items;
  }

  function filteredSelectorItems(state: SelectorState): SelectorItem[] {
    const items = selectorItems(state);
    const special = items.filter((item) => item.key === INHERIT || item.key === DEFAULT_THINKING);
    const choices: ModelChoice[] = items
      .filter((item) => item.key !== INHERIT && item.key !== DEFAULT_THINKING)
      .map((item) => ({ value: item.key, provider: "", id: item.key, available: true }));
    const filtered = fuzzyFilter(choices, state.query).map((choice) => {
      const original = items.find((item) => item.key === choice.value);
      return { key: choice.value, label: choice.value, note: original?.note };
    });
    if (state.query === "") return [...special, ...filtered];
    return filtered;
  }

  function applySelectorSelection(state: SelectorState, item: SelectorItem): void {
    const notice = applySelectorValue(state, item.key);
    if (notice !== undefined) {
      state.notice = notice;
      bump();
      return;
    }
    selector = null;
    mode = "field";
    bump();
  }

  /** Returns a rejection notice, or undefined when applied to the draft. */
  function applySelectorValue(state: SelectorState, key: string): string | undefined {
    if (state.kind === "default-model") {
      draft.defaultModel = key === INHERIT ? undefined : key;
      return undefined;
    }
    if (state.kind === "agent-model") {
      if (!state.agent) return undefined;
      const policy = policyFor(state.agent) ?? {};
      if (key !== INHERIT) {
        const route = Array.isArray(policy.fallbackModels) ? policy.fallbackModels : [];
        if (route.includes(key)) {
          return "already in this agent's fallback route — remove it there first";
        }
      }
      if (key === INHERIT) delete policy.model;
      else policy.model = key;
      setPolicy(state.agent, policy);
      return undefined;
    }
    if (state.kind === "thinking") {
      if (!state.agent) return undefined;
      const policy = policyFor(state.agent) ?? {};
      if (key === DEFAULT_THINKING) delete policy.thinking;
      else policy.thinking = key;
      setPolicy(state.agent, policy);
      return undefined;
    }
    // fallback-add
    if (!state.agent) return undefined;
    const policy = policyFor(state.agent) ?? {};
    if (policy.model === key) {
      return "the primary model cannot appear in its own fallback route";
    }
    const route = Array.isArray(policy.fallbackModels) ? [...policy.fallbackModels] : [];
    if (route.includes(key)) {
      return "already in the fallback route";
    }
    route.push(key);
    policy.fallbackModels = route;
    setPolicy(state.agent, policy);
    fallbackCursor = route.length - 1;
    return undefined;
  }

  function openPreview(): void {
    mode = "preview";
    previewOffset = 0;
    bump();
  }

  function confirmSave(): void {
    const result = deps.persist(cloneDraft(draft));
    if (result.ok) {
      savedOnce = true;
      baseline = cloneDraft(draft);
      banner = {
        level: "success",
        lines: [`Saved to ${deps.settingsPath}`, `Run /reload, then /subagents-models to verify the live mapping.`],
      };
      deps.notify(`Saved subagent model policy to ${deps.settingsPath} — ${RELOAD_GUIDANCE}.`, "info");
    } else {
      banner = { level: "error", lines: [result.error] };
    }
    mode = "navigate";
    bump();
  }

  function resetSelectedRole(): void {
    const name = entryName(selectedIndex);
    if (name === null) {
      delete draft.defaultModel;
    } else {
      draft.agents[name] = {};
    }
    bump();
  }

  function deleteFallbackAtCursor(): void {
    const name = entryName(selectedIndex);
    if (name === null) return;
    const policy = policyFor(name);
    const route = Array.isArray(policy?.fallbackModels) ? policy!.fallbackModels as string[] : null;
    if (!route || route.length === 0) return;
    route.splice(fallbackCursor, 1);
    if (route.length === 0) {
      policy!.fallbackModels = [];
    } else {
      policy!.fallbackModels = route;
    }
    if (fallbackCursor >= route.length) fallbackCursor = Math.max(0, route.length - 1);
    bump();
  }

  function moveFallback(delta: number): void {
    const name = entryName(selectedIndex);
    if (name === null) return;
    const route = fallbacksOf(name);
    const target = fallbackCursor + delta;
    if (route.length === 0 || target < 0 || target >= route.length) return;
    [route[fallbackCursor], route[target]] = [route[target]!, route[fallbackCursor]!];
    policyFor(name)!.fallbackModels = route;
    fallbackCursor = target;
    bump();
  }

  /** Move the route highlight without reordering (j/k while on the fallback field). */
  function moveRouteCursor(delta: number): void {
    const name = entryName(selectedIndex);
    if (name === null) return;
    const route = fallbacksOf(name);
    const target = fallbackCursor + delta;
    if (route.length === 0 || target < 0 || target >= route.length) return;
    fallbackCursor = target;
    bump();
  }

  function handleNavigateKey(key: string): void {
    if (key === "up") {
      selectedIndex = Math.max(0, selectedIndex - 1);
    } else if (key === "down") {
      selectedIndex = Math.min(entries.length - 1, selectedIndex + 1);
    } else if (key === "enter") {
      mode = "field";
      fieldIndex = 0;
      fallbackCursor = 0;
    } else if (key === "s") {
      openPreview();
      return;
    } else if (key === "escape" || key === "ctrl+c") {
      if (isDirty()) {
        mode = "discard";
        bump();
      } else {
        exitNow();
      }
    } else if (key === "r") {
      resetSelectedRole();
      return;
    } else {
      return;
    }
    bump();
  }

  function handleFieldKey(key: string): void {
    const name = entryName(selectedIndex);
    if (key === "up") {
      fieldIndex = Math.max(0, fieldIndex - 1);
    } else if (key === "down") {
      fieldIndex = Math.min(fieldCount(name) - 1, fieldIndex + 1);
    } else if (key === "enter") {
      if (name === null) {
        openSelector("default-model", null);
      } else if (fieldIndex === 0) {
        openSelector("agent-model", name);
      } else if (fieldIndex === 1) {
        openSelector("thinking", name);
      } else {
        openSelector("fallback-add", name);
      }
      return;
    } else if (key === "a" && name !== null) {
      openSelector("fallback-add", name);
      return;
    } else if (key === "d" && name !== null) {
      deleteFallbackAtCursor();
      return;
    } else if (key === "J" && name !== null) {
      moveFallback(1);
      return;
    } else if (key === "K" && name !== null) {
      moveFallback(-1);
      return;
    } else if ((key === "j" || key === "k") && name !== null && fieldIndex === 2) {
      moveRouteCursor(key === "j" ? 1 : -1);
      return;
    } else if (key === "r") {
      resetSelectedRole();
      return;
    } else if (key === "s") {
      openPreview();
      return;
    } else if (key === "escape" || key === "ctrl+c") {
      mode = "navigate";
    } else {
      return;
    }
    bump();
  }

  function handleSelectorKey(key: string): void {
    const state = selector;
    if (!state) return;
    if (key === "escape" || key === "ctrl+c") {
      selector = null;
      mode = "field";
    } else if (key === "up") {
      state.cursor = Math.max(0, state.cursor - 1);
    } else if (key === "down") {
      const count = filteredSelectorItems(state).length;
      state.cursor = Math.min(Math.max(0, count - 1), state.cursor + 1);
    } else if (key === "enter") {
      const items = filteredSelectorItems(state);
      const item = items[state.cursor];
      if (item) applySelectorSelection(state, item);
      return;
    } else if (key === "backspace") {
      state.query = state.query.slice(0, -1);
      state.cursor = 0;
    } else if (key.length >= 1 && isPrintableKey(key)) {
      state.query += key;
      state.cursor = 0;
    } else {
      return;
    }
    bump();
  }

  function isPrintableKey(key: string): boolean {
    if (["up", "down", "left", "right", "enter", "escape", "tab", "backspace", "delete", "home", "end", "pageup", "pagedown"].includes(key)) {
      return false;
    }
    return !key.startsWith("ctrl+");
  }

  function handlePreviewKey(key: string): void {
    if (key === "enter") {
      confirmSave();
      return;
    }
    if (key === "escape" || key === "ctrl+c") {
      mode = "navigate";
    } else if (key === "up") {
      previewOffset = Math.max(0, previewOffset - 1);
    } else if (key === "down") {
      previewOffset += 1;
    } else if (key === "pageup") {
      previewOffset = Math.max(0, previewOffset - 10);
    } else if (key === "pagedown") {
      previewOffset += 10;
    } else {
      return;
    }
    bump();
  }

  function handleDiscardKey(key: string): void {
    if (key === "enter") {
      exitNow();
      return;
    }
    if (key === "escape" || key === "ctrl+c") {
      mode = "navigate";
      bump();
    }
  }

  function handleInput(data: string): void {
    if (exited) return;
    const key = parseKey(data);
    if (key === undefined) return;
    switch (mode) {
      case "navigate":
        handleNavigateKey(key);
        break;
      case "field":
        handleFieldKey(key);
        break;
      case "selector":
        handleSelectorKey(key);
        break;
      case "preview":
        handlePreviewKey(key);
        break;
      case "discard":
        handleDiscardKey(key);
        break;
    }
  }

  // ---------- rendering ----------

  function markAvailable(value: string | undefined): string {
    if (value === undefined) return "";
    return isUnavailable(value) ? " (unavailable)" : "";
  }

  function renderNavigator(width: number, changed: Set<string>): string[] {
    const lines: string[] = [theme.bold(truncateAnsi("Agents", width))];
    for (let index = 0; index < entries.length; index += 1) {
      const name = entryName(index);
      const selected = index === selectedIndex;
      const label = name ?? "default";
      const marker = changed.has(label) ? " *" : "";
      let summary: string;
      if (name === null) {
        summary = draft.defaultModel ?? "inherit";
      } else {
        const policy = policyFor(name);
        const parts: string[] = [policy?.model ?? "inherit"];
        if (policy?.thinking !== undefined) parts.push(policy.thinking === false ? "thinking off" : `thinking ${policy.thinking}`);
        const route = Array.isArray(policy?.fallbackModels) ? policy.fallbackModels : [];
        if (route.length > 0) parts.push(`${route.length} fallback${route.length === 1 ? "" : "s"}`);
        summary = parts.join(" · ");
      }
      const prefix = selected ? "→ " : "  ";
      const line = `${prefix}${label}${marker}  ${summary}`;
      const styled = selected ? theme.fg("accent", line) : theme.fg("muted", line);
      lines.push(truncateAnsi(styled, width));
    }
    return lines;
  }

  function fieldPrefix(focused: boolean): string {
    return focused ? "> " : "  ";
  }

  function renderEditorPane(width: number): string[] {
    const name = entryName(selectedIndex);
    const lines: string[] = [];
    const title = name === null ? "Default subagent model" : `Agent: ${name}`;
    lines.push(theme.bold(truncateAnsi(title, width)));
    const focused = mode === "field";

    if (name === null) {
      const value = draft.defaultModel;
      const shown = value === undefined ? "(inherit)" : `${value}${markAvailable(value)}`;
      lines.push(truncateAnsi(`${fieldPrefix(focused && fieldIndex === 0)}Default model: ${shown}`, width));
      lines.push(truncateAnsi(theme.fg("muted", "  Applies to every agent without its own model."), width));
      return lines;
    }

    const policy = policyFor(name) ?? {};
    const primary = policy.model === undefined ? "(inherit)" : `${policy.model}${markAvailable(policy.model)}`;
    lines.push(truncateAnsi(`${fieldPrefix(focused && fieldIndex === 0)}Primary model: ${primary}`, width));

    const thinking = policy.thinking === undefined ? "(default)" : policy.thinking === false ? "off (explicit)" : policy.thinking;
    lines.push(truncateAnsi(`${fieldPrefix(focused && fieldIndex === 1)}Thinking: ${thinking}`, width));

    lines.push(truncateAnsi(`${fieldPrefix(focused && fieldIndex === 2)}Fallback route:`, width));
    const route = Array.isArray(policy.fallbackModels) ? policy.fallbackModels : [];
    if (route.length === 0) {
      lines.push(truncateAnsi(theme.fg("muted", "    (none)"), width));
    } else {
      for (let index = 0; index < route.length; index += 1) {
        const value = route[index] ?? "";
        const cursorMark = focused && fieldIndex === 2 && index === fallbackCursor ? ">" : " ";
        const suffix = markAvailable(value);
        lines.push(truncateAnsi(`   ${cursorMark} ${index + 1}. ${value}${suffix}`, width));
      }
    }
    if (focused && fieldIndex === 2) {
      lines.push(truncateAnsi(theme.fg("muted", "    a add · j/k select · d delete · J/K move"), width));
    }
    return lines;
  }

  function renderSelector(width: number): string[] {
    const state = selector;
    if (!state) return [];
    const titles: Record<SelectorKind, string> = {
      "default-model": "Select default model",
      "agent-model": state.agent ? `Select primary model — ${state.agent}` : "Select primary model",
      thinking: state.agent ? `Select thinking — ${state.agent}` : "Select thinking",
      "fallback-add": state.agent ? `Add fallback — ${state.agent}` : "Add fallback",
    };
    const lines: string[] = [theme.bold(truncateAnsi(titles[state.kind], width))];
    lines.push(truncateAnsi(`Search: ${state.query}▌`, width));

    const items = filteredSelectorItems(state);
    const windowStart = Math.max(0, Math.min(state.cursor - SELECTOR_MAX_VISIBLE + 1, items.length - SELECTOR_MAX_VISIBLE));
    const window = items.slice(windowStart, windowStart + SELECTOR_MAX_VISIBLE);
    if (items.length === 0) {
      lines.push(truncateAnsi(theme.fg("muted", "  no matching models"), width));
    }
    for (let index = 0; index < window.length; index += 1) {
      const item = window[index];
      if (!item) continue;
      const actualIndex = windowStart + index;
      const selected = actualIndex === state.cursor;
      const prefix = selected ? "→ " : "  ";
      const note = item.note ? ` (${item.note})` : "";
      const line = `${prefix}${item.label}${note}`;
      lines.push(truncateAnsi(selected ? theme.fg("accent", line) : line, width));
    }
    if (state.notice !== undefined) {
      lines.push(truncateAnsi(theme.fg("error", `✗ ${state.notice}`), width));
    }
    return lines;
  }

  function renderPreview(width: number): string[] {
    const lines: string[] = [theme.bold(truncateAnsi("Save preview — resulting subagents settings", width))];

    const defaultRoute = draft.defaultModel ?? "(inherit)";
    lines.push(truncateAnsi(`default: ${defaultRoute}`, width));
    for (const name of agentNames) {
      const policy = policyFor(name);
      if (!policy) continue;
      const primary = policy.model ?? "(inherit)";
      const route = Array.isArray(policy.fallbackModels) ? policy.fallbackModels : [];
      const thinking = policy.thinking === undefined ? "" : policy.thinking === false ? " · thinking off" : ` · thinking ${policy.thinking}`;
      const routeText = route.length > 0 ? ` → ${route.join(" → ")}` : "";
      lines.push(truncateAnsi(`${name}: ${primary}${routeText}${thinking}`, width));
    }

    lines.push("");
    const json = JSON.stringify(previewSubagents(loaded.doc, draft), null, 2);
    const jsonLines = json.split("\n");
    const visible = jsonLines.slice(previewOffset);
    for (const line of visible) {
      lines.push(truncateAnsi(line, width));
    }
    return lines;
  }

  function renderHints(width: number): string[] {
    let hints: string;
    switch (mode) {
      case "navigate":
        hints = "↑/↓ select · Enter edit · r reset · s save/preview · Esc close";
        break;
      case "field":
        hints = "↑/↓ field · Enter change · a add · d delete · J/K move · r reset · s save · Esc back";
        break;
      case "selector":
        hints = "type to filter · ↑/↓ choose · Enter select · Esc cancel";
        break;
      case "preview":
        hints = "↑/↓ scroll · Enter save · Esc cancel";
        break;
      case "discard":
        hints = "Enter discard changes · Esc keep editing";
        break;
    }
    return [truncateAnsi(theme.fg("muted", hints), width)];
  }

  function renderDiscard(width: number): string[] {
    return [
      truncateAnsi(theme.fg("warning", theme.bold("Discard unsaved changes?")), width),
      truncateAnsi("Enter discard · Esc keep editing", width),
    ];
  }

  function renderBanner(width: number): string[] {
    if (!banner) return [];
    const color = banner.level === "success" ? "success" : "error";
    const mark = banner.level === "success" ? "✓" : "✗";
    return banner.lines.map((line) => truncateAnsi(theme.fg(color, `${mark} ${line}`), width));
  }

  function render(width: number): string[] {
    if (cache && cache.width === width) return cache.lines;
    const changed = changedEntries();
    const lines: string[] = [];

    const state = savedOnce && !isDirty() ? "saved" : isDirty() ? "unsaved changes" : "no changes";
    lines.push(truncateAnsi(theme.bold(`pi-submodel — subagent model policy (${state})`), width));
    lines.push(truncateAnsi(theme.fg("muted", deps.settingsPath), width));
    for (const line of renderBanner(width)) lines.push(line);
    lines.push("");

    if (mode === "preview") {
      lines.push(...renderPreview(width));
    } else if (mode === "selector") {
      lines.push(...renderSelector(width));
    } else if (mode === "discard") {
      lines.push(...renderDiscard(width));
    } else {
      const navLines = renderNavigator(4096, changed); // untruncated for measurement
      const wanted = navLines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
      // Grow past the minimum so provider-qualified model names stay unambiguous,
      // but never take more than roughly half the screen from the editor pane.
      const navWidth = Math.max(NAV_WIDTH_MIN, Math.min(wanted, Math.floor((width - 4) / 2)));
      const edWidth = Math.max(20, width - navWidth - 2);
      const edLines = renderEditorPane(edWidth);
      if (width >= MIN_SIDE_BY_SIDE) {
        const height = Math.max(navLines.length, edLines.length);
        for (let index = 0; index < height; index += 1) {
          const left = padEndAnsi(truncateAnsi(navLines[index] ?? "", navWidth), navWidth);
          const right = edLines[index] ?? "";
          lines.push(truncateAnsi(`${left}  ${right}`, width));
        }
      } else {
        lines.push(...navLines.map((line) => truncateAnsi(line, width)));
        lines.push("");
        lines.push(...edLines);
      }
    }

    lines.push("");
    lines.push(...renderHints(width));

    cache = { width, lines };
    return lines;
  }

  return {
    render,
    handleInput,
    invalidate: bump,
    setExitHandler(handler: (exit: EditorExit) => void): void {
      exitHandler = handler;
    },
  };
}
