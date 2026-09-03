/**
 * Model choices: available registry models plus retained unavailable configured values,
 * with a lightweight fuzzy filter for the selector (substring beats subsequence).
 */
import type { ModelChoice, RegistryModel } from "./types.ts";

export function qualifiedName(model: RegistryModel): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Build selectable choices from the registry. Configured values that are not in the
 * registry are appended as unavailable choices so existing settings stay visible.
 * Duplicates (same qualified name) are removed, registry entries first.
 */
export function buildModelChoices(registry: RegistryModel[], configuredValues: string[]): ModelChoice[] {
  const choices: ModelChoice[] = [];
  const seen = new Set<string>();
  for (const model of registry) {
    const value = qualifiedName(model);
    if (seen.has(value)) continue;
    seen.add(value);
    choices.push({ value, provider: model.provider, id: model.id, available: true });
  }
  for (const value of configuredValues) {
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    const slash = value.indexOf("/");
    const provider = slash === -1 ? "" : value.slice(0, slash);
    const id = slash === -1 ? value : value.slice(slash + 1);
    choices.push({ value, provider, id, available: false });
  }
  return choices;
}

/** Greedy subsequence check (case handled by the caller). */
function isSubsequence(haystack: string, needle: string): boolean {
  let hi = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi);
    if (found === -1) return false;
    hi = found + 1;
  }
  return true;
}

/**
 * Filter choices for a query. Empty query returns everything. Ranking: exact substring
 * match first (earlier position wins), then subsequence matches, then alphabetical.
 * Non-matching choices are dropped entirely.
 */
export function fuzzyFilter(choices: ModelChoice[], query: string): ModelChoice[] {
  const q = query.toLowerCase();
  if (q === "") return [...choices];
  const scored: Array<{ choice: ModelChoice; score: number }> = [];
  for (const choice of choices) {
    const value = choice.value.toLowerCase();
    const index = value.indexOf(q);
    if (index !== -1) {
      scored.push({ choice, score: 1000 - index });
      continue;
    }
    if (isSubsequence(value, q)) {
      scored.push({ choice, score: 500 });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.choice.value.localeCompare(b.choice.value));
  return scored.map((entry) => entry.choice);
}
