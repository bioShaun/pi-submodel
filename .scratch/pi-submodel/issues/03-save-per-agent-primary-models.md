# 03: Save per-agent primary models

**What to build:** Extend the focused editor so the operator can assign or inherit a primary model for any listed agent. Saving uses the native per-agent override schema, preserves every setting the editor does not own, and removes only the selected agent's managed model value when inheritance is restored.

**Blocked by:** 02: Save the default subagent model safely.

**Status:** resolved

- [x] Each listed agent exposes a primary-model selector populated from the active Pi model registry.
- [x] Selecting a provider-qualified model updates the selected agent's native model override only after explicit save confirmation.
- [x] Selecting Inherit removes only the selected agent's primary-model override.
- [x] Other fields in the selected agent override, including tools, skills, prompts, and context settings, remain unchanged.
- [x] Other agents' overrides and unrelated `subagents` settings remain unchanged.
- [x] If removing the model leaves the selected override empty, that override is removed.
- [x] If cleanup leaves parent objects empty, only those empty objects are removed.
- [x] Existing unavailable primary models can be preserved, replaced, or removed explicitly.
- [x] Resetting the selected role removes its managed primary-model field without deleting unowned fields.
- [x] Saving and reopening `/submodel` displays the same primary-model configuration.
- [x] The parent Pi session model remains unchanged throughout the flow.
- [x] The command-level test seam covers two different agents, inheritance, reset, cleanup, reopening, and unrelated-field preservation.

## Comments

- Covered by `test/command-agent-model.test.ts` (9 tests): assignment only after save confirmation, Inherit removes only `model`, empty-entry + empty-parent cleanup, multi-agent sessions, reset keeps unowned fields, unavailable configured primaries kept until replaced, save + reopen round-trip, parent session model untouched.
- UI fix found by these tests: the navigator column now grows to fit provider-qualified names so they stay unambiguous.
