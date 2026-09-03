# 02: Save the default subagent model safely

**What to build:** Extend the `/submodel` flow so the operator can fuzzy-search for a default child model, preview the native settings change, explicitly confirm it, and save it safely. Selecting Inherit removes the native default model. Cancellation, malformed input, or a concurrent settings edit must never overwrite the source.

**Blocked by:** 01: Open the read-only model configuration TUI.

**Status:** resolved

- [x] The default entry supports fuzzy search across available provider-qualified models.
- [x] Selecting a model updates only the in-memory draft until save is confirmed.
- [x] Selecting Inherit removes `subagents.defaultModel` from the draft.
- [x] The operator can preview the resulting native settings before confirmation.
- [x] Canceling either the editor or save confirmation leaves the source byte-for-byte unchanged.
- [x] Saving structurally merges the default model while preserving all unrelated top-level and `subagents` settings.
- [x] Empty objects created by removing the default model are cleaned up without touching unrelated content.
- [x] Invalid JSON, a non-object root, or an incompatible `subagents` shape produces a clear error and no write.
- [x] A source change between opening and saving is detected; the save is refused instead of overwriting it.
- [x] A confirmed save uses same-directory temporary output and atomic replacement.
- [x] A new settings source is private, and replacing an existing source preserves its permission mode.
- [x] Success identifies the saved scope and advises `/reload` followed by `/subagents-models`.
- [x] The command-level test seam covers save, Inherit, cancel, malformed input, unrelated-field preservation, and concurrent-change refusal.

## Comments

- Implemented: `src/submodel/settings-draft.ts`, `src/submodel/settings-file.ts`, `src/submodel/command.ts`; covered by `test/command-default-model.test.ts`, `test/settings-*.test.ts`.
- Save previews the resulting `subagents` JSON, requires Enter, writes atomically (0600 for new files, mode preserved), notifies with path + /reload guidance at confirm time, refuses when the fingerprint changed on disk, and structurally merges (all unrelated settings preserved). Fixed during review: the success notification now fires at save confirmation (not editor exit), and saving no longer marks the editor's own write as an external change.
