# Context: pi-submodel

A Pi extension (`/submodel`) that gives `pi-subagents` operators a keyboard-first TUI for
editing the native user-level subagent model policy in `~/.pi/agent/settings.json`.

## Domain vocabulary

- **Model policy** — the model-routing fields this editor owns inside Pi settings:
  `subagents.defaultModel`, and per named agent `subagents.agentOverrides.<name>.model`
  (primary), `.thinking`, and `.fallbackModels` (ordered route). Everything else in the
  settings file is **unowned** and must be preserved verbatim on save.
- **Draft** — the in-memory copy of the managed policy. All edits mutate only the draft;
  the settings file is written only after an explicit save confirmation.
- **Inherit** — the state of having no override: `defaultModel` absent (falls through to
  `pi-subagents`' normal resolution) or an agent primary absent. Restoring Inherit removes
  only the managed field it applies to.
- **Default (thinking)** — no `thinking` field; `pi-subagents` retains control.
- **Route** — an agent's ordered `fallbackModels` list. Order is persisted exactly as shown.
  Entries must not duplicate each other or the explicitly selected primary.
- **Unavailable value** — a configured model string absent from the current Pi model
  registry. It is retained and marked, never silently discarded, so settings stay valid for
  other environments.
- **Structural merge** — the save algorithm: re-reads the on-disk document, refuses if it
  changed since the editor opened (fingerprint), then writes only the managed fields back,
  preserving every unowned top-level, `subagents`, and agent-override field. Empty override
  objects and empty parent objects created by the operation are removed.
- **Command seam** — `runSubmodel()`, the testable boundary where a temporary settings file,
  a fake model registry, and a driveable editor component stand in for the real Pi host.

## Native contract

Targets `nicobailon/pi-subagents` 0.64.x settings, documented in its `docs/models.md`.
Thinking levels: `off minimal low medium high xhigh max` (plus native `false`, preserved but
not emitted by this editor). Verification command after save: `/reload` then
`/subagents-models`.

## Testing

Tests assert external behavior at the command seam: rendered lines, navigation outcomes,
notifications, and final file content — not internal helper calls. Narrow writer tests exist
only for failure modes unreachable through the seam (rename failure, permission modes).
