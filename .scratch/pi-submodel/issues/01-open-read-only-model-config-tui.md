# 01: Open the read-only model configuration TUI

**What to build:** Deliver an installable `pi-submodel` extension whose `/submodel` command opens the focused two-pane model editor. The operator can navigate the default entry, the supported `pi-subagents` 0.64 agents, and names already present in native agent overrides. The screen shows current model assignments, models from Pi's active registry, and retained unavailable values, but this first slice performs no persistent writes.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Installing the package makes `/submodel` available in Pi.
- [x] Running `/submodel` in TUI mode opens the variant B layout with an agent navigator and focused detail pane.
- [x] The navigator includes the default entry, `scout`, `researcher`, `worker`, `reviewer`, `oracle`, `delegate`, and additional names already configured in agent overrides.
- [x] The model list comes from Pi's current scoped registry when available and otherwise from the active registry.
- [x] Provider-qualified model names are displayed without ambiguity.
- [x] Existing configured models missing from the current registry remain visible and are marked unavailable.
- [x] Up/Down changes the selected entry, Enter focuses an editable control, and Escape backs out or closes the editor.
- [x] Opening, navigating, and closing the editor leaves the settings source byte-for-byte unchanged.
- [x] The command-level test seam drives the TUI with a fake model registry and temporary settings source.
- [x] No code intercepts delegation requests or changes the parent session model.

## Comments

- Implemented: `src/submodel/editor/submodel-editor.ts` (component), `src/index.ts` (adapter), covered by `test/command-open.test.ts`.
- Navigator renders all six 0.64 builtins plus configured non-builtin names; editor pane shows model/thinking/fallback fields with unowned fields noted; Inherit items; registry models marked unavailable when absent; fuzzy filter; Esc/Ctrl+C exit; settings-file errors block the editor with the parse message; version gate errors surface as notifications; non-TUI invocation refuses with a clear error.
