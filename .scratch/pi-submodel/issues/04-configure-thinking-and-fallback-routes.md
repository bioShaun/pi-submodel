# 04: Configure thinking and fallback routes

**What to build:** Complete the focused per-agent policy editor with thinking-level selection and an ordered fallback route. The operator can add, remove, and reorder fallback models using keyboard controls, then save and reopen the exact native `pi-subagents` policy.

**Blocked by:** 03: Save per-agent primary models.

**Status:** resolved

- [x] Each agent exposes a thinking selector with Default, off, minimal, low, medium, high, xhigh, and max choices supported by the active model.
- [x] Selecting Default removes only the selected agent's thinking override.
- [x] The operator can add a model to the end of the fallback route.
- [x] The operator can delete a selected fallback.
- [x] `J` and `K` move a selected fallback down and up while preserving all other entries.
- [x] The editor prevents duplicate fallback entries.
- [x] The editor prevents an explicitly selected primary model from appearing in its own fallback route.
- [x] Existing unavailable fallback models are retained and can be reordered, replaced, or removed.
- [x] Saving persists fallback order exactly in the native fallback-model array.
- [x] An empty fallback route removes only the selected agent's fallback-model field.
- [x] Resetting a role removes model, thinking, and fallback fields managed by the editor while preserving unowned fields.
- [x] Save preview expresses fallback resolution as an ordered route and as the resulting native settings.
- [x] Saving and reopening reproduces the same primary, thinking, and fallback policy.
- [x] The command-level test seam covers add, remove, reorder, duplicate rejection, primary self-reference rejection, Default thinking, empty fallback cleanup, reset, and reopening.

## Comments

- Covered by `test/command-thinking-fallbacks.test.ts` (14 tests): Default + seven levels, Default removes only `thinking`, add/delete/reorder (a/d/J/K), duplicate and primary-in-route rejections, empty route removes the field, unavailable fallbacks retained/removable, reset removes all managed fields, save preview shows the ordered route, save + reopen round-trip.
- Fixes found by these tests: the fallback-add selector no longer offers Inherit; j/k now move the fallback highlight so entries past the first can be selected; r (reset) also works from the navigator; multi-save sessions no longer refuse their own second save.
