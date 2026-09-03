# pi-submodel

English | [简体中文](README.zh-CN.md)

A Pi extension that registers `/submodel`: a keyboard-first, two-pane TUI for editing the native `pi-subagents` model policy in your user-level settings file (`~/.pi/agent/settings.json`) — the default subagent model, each agent's primary model, thinking level, and ordered fallback route. No JSON hand-editing, and the parent session model is never touched.

## Compatibility

- Targets `nicobailon/pi-subagents` **0.64.x** exclusively. Any other detected version is refused with a clear error and nothing is written. If pi-subagents is not detected, the editor still opens and writes the native 0.64.x shape (with a warning).
- Pi extension API verified against Pi 0.84.4 (`@earendil-works/pi-coding-agent`).
- Requires Node >= 22.

## Install

After the package is published to npm:

```
pi install npm:pi-submodel
```

Or from a local checkout:

```
pi install /absolute/path/to/pi-submodel
```

Then run `/reload` (or restart Pi). The `/submodel` command appears.

## Usage

Run `/submodel`. Two panes:

- **Left — navigator.** The `default` entry, the six pi-subagents 0.64 builtins (`scout`, `researcher`, `worker`, `reviewer`, `oracle`, `delegate`), plus any names already configured under `agentOverrides`.
- **Right — editor.** Focused editor for the selected entry. The `default` entry has one field (default model); agents have primary model, thinking, and an ordered fallback route.

The shape it writes is the native pi-subagents contract:

```json
{
  "subagents": {
    "defaultModel": "provider/default-model",
    "agentOverrides": {
      "worker": {
        "model": "provider/primary-model",
        "thinking": "high",
        "fallbackModels": [
          "provider/first-fallback",
          "provider/second-fallback"
        ]
      }
    }
  }
}
```

Fallback order is persisted exactly as shown; pi-subagents tries them in order on retryable provider/model failures.

## Keyboard controls

| Context | Key | Action |
| --- | --- | --- |
| Navigator | Up / Down | select entry |
| Navigator | Enter | focus the editor for the entry |
| Navigator | r | reset the selected role (removes only managed fields) |
| Navigator | s | open save preview |
| Navigator | Esc | close the editor (asks before discarding unsaved changes) |
| Editor | Up / Down | move between fields |
| Editor | Enter | open the selector for the field |
| Editor | a | add a fallback |
| Editor | j / k | highlight the next / previous fallback |
| Editor | d | delete the highlighted fallback |
| Editor | J | move the fallback down |
| Editor | K | move the fallback up |
| Editor | r | reset the selected role (removes only managed fields) |
| Editor | s | open save preview |
| Editor | Esc | back out to the navigator |
| Selector | typing | fuzzy-filter the list |
| Selector | Up / Down | choose |
| Selector | Enter | select |
| Selector | Esc | cancel |
| Save preview | Up / Down / PageUp / PageDown | scroll |
| Save preview | Enter | save |
| Save preview | Esc | cancel |
| Discard prompt | Enter | discard changes |
| Discard prompt | Esc | keep editing |

Ctrl+C acts as Esc in every context; Backspace edits the selector's search query.

## What it edits (and what it preserves)

The editor owns only these fields:

- `subagents.defaultModel`
- `subagents.agentOverrides.<name>.model`
- `subagents.agentOverrides.<name>.thinking`
- `subagents.agentOverrides.<name>.fallbackModels`

Every other top-level setting, every other `subagents` field, and every other field in a per-agent override is preserved verbatim on save.

Inherit semantics:

- **Inherit** for the default model removes `subagents.defaultModel`, so pi-subagents uses its normal resolution.
- **Inherit** for an agent's primary model removes only that agent's `model`; thinking and fallbacks are untouched.
- **Default** thinking removes only `agentOverrides.<name>.thinking`.
- An emptied fallback list removes `agentOverrides.<name>.fallbackModels`.
- When removing managed fields leaves an override object empty, the entry is removed, along with any parent objects the cleanup empties.

Thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, plus **Default** (removes the override). An existing explicit `"thinking": false` is preserved as-is; likewise an explicit `"fallbackModels": false` is preserved verbatim (removable via Reset).

## Safety

- All edits are held in an in-memory draft until you explicitly save; canceling leaves the file byte-for-byte unchanged.
- Saving shows a preview of the resulting `subagents` JSON before you confirm.
- The write is atomic: a temp file in the same directory, then a rename. New files are created private (0600); an existing file's permission mode is preserved.
- If the settings file changed on disk since `/submodel` was opened (another Pi instance, a manual edit), the save is refused via a content fingerprint. Reopen the editor to pick up the new file.
- Malformed JSON or incompatible field shapes block the editor with a clear error instead of guessing at a repair.
- Configured models that are not in the current registry are kept and marked `(unavailable)` — never silently discarded.
- Duplicate fallbacks, and a primary model placed in its own fallback route, are rejected.

## After saving

1. Run `/reload` so the running Pi picks up the new settings.
2. Verify the live mapping with `/subagents-models` (and `/subagents-models <agent>` for a single role).

## Not supported

- Project-level `.pi/settings.json` editing
- Per-session model overrides
- Runtime request interception or forced overrides
- Changing the parent session model
- Editing prompts, tools, skills, context inheritance, acceptance policy, or disabled state
- Provider-scoped `agentOverridesByProvider`
- `modelScope`, `defaultProvider`, `defaultThinking`, `maxThinking`, `disableThinking`
- Provider, credential, or registry management
- Probing models with live paid requests
- Fallback execution itself — pi-subagents handles retry eligibility and execution
- `tintinweb/pi-subagents`
- Preserving JSON comments (the file is rewritten as plain JSON)
- Auto-reload after save

## Development

```
npm install
npm test          # node --test
npm run typecheck
```

Architecture: `src/index.ts` is a thin Pi adapter; the actual behavior lives behind a testable command seam in `src/submodel/command.ts`, exercised by tests with a temporary settings file, a fake model registry, and a driveable editor component.

## License

MIT — see [LICENSE](LICENSE).
