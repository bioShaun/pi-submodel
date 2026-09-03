# pi-submodel TUI model configuration

Status: ready-for-agent

## Problem Statement

Users of `nicobailon/pi-subagents` can configure a default child model and per-agent model policies in Pi settings, but must currently edit JSON by hand. This is slow, error-prone, and makes ordered fallback models especially awkward to maintain. Existing projects such as `pi-subagent-models` solve a different problem: they intercept launches and force one model globally or for a session, rather than editing the native `pi-subagents` configuration.

The user needs a keyboard-first TUI inside Pi that manages the native user-level `subagents` settings in `~/.pi/agent/settings.json`. It must configure a default model and each named agent's primary model, thinking level, and ordered fallback models without changing the parent session model or overwriting unrelated settings.

## Solution

Provide a standalone Pi extension named `pi-submodel`. It registers `/submodel`, which opens a focused two-pane TUI based on prototype variant B.

The left pane lists supported and already-configured agents. The right pane edits one selected agent at a time. It exposes the primary model, thinking level, and ordered fallback chain. A separate default-model entry controls `subagents.defaultModel`.

Model choices come from Pi's current model registry and support fuzzy search. Existing configured models that are not currently available remain visible and are identified as unavailable, so opening and saving the editor does not silently destroy valid configuration for another environment.

The editor works on an in-memory draft. It writes only after explicit confirmation, preserves unrelated settings, and uses an atomic replacement. The completed write targets the native `pi-subagents` schema, so future child launches use normal `pi-subagents` model resolution without request interception.

## User Stories

1. As a Pi operator, I want to open model configuration with `/submodel`, so that I do not need to edit JSON manually.
2. As a keyboard-focused user, I want to complete the workflow without a mouse, so that configuration feels native to Pi's TUI.
3. As a Pi operator, I want to see one agent at a time, so that the screen remains usable in a narrow terminal.
4. As a Pi operator, I want to move quickly between agents, so that reviewing all model assignments is efficient.
5. As a Pi operator, I want the currently selected agent to be visually clear, so that I do not edit the wrong role.
6. As a Pi operator, I want to configure the default subagent model, so that unpinned agents use a deliberate model.
7. As a Pi operator, I want to restore the default model to inheritance, so that `pi-subagents` can fall back to its normal resolution.
8. As a Pi operator, I want to assign a primary model to an individual agent, so that each role can use an appropriate capability and cost tier.
9. As a Pi operator, I want an agent's primary model to inherit when no override is needed, so that configuration stays minimal.
10. As a Pi operator, I want to configure an agent's thinking level, so that reasoning effort matches the role.
11. As a Pi operator, I want to restore thinking to its native default, so that `pi-subagents` retains control when no override is needed.
12. As a Pi operator, I want to add fallback models to an agent, so that retryable provider or model failures can recover.
13. As a Pi operator, I want fallback models to have an explicit order, so that recovery follows my preferred route.
14. As a Pi operator, I want to move a fallback model up or down, so that I can change priority without rebuilding the list.
15. As a Pi operator, I want to remove one fallback model, so that stale or expensive choices leave the route.
16. As a Pi operator, I want duplicate fallback models prevented, so that the same model is not retried redundantly.
17. As a Pi operator, I want the explicit primary model excluded from its own fallback list, so that failover cannot loop back to the failed primary.
18. As a Pi operator, I want available models loaded from my active Pi registry, so that the selector reflects models I can actually use.
19. As a Pi operator, I want fuzzy model search, so that large provider catalogs remain manageable.
20. As a Pi operator, I want provider-qualified model names displayed, so that similarly named models are unambiguous.
21. As a Pi operator, I want unavailable configured models shown rather than discarded, so that temporary authentication or registry differences do not corrupt my settings.
22. As a Pi operator, I want to preview the effective JSON changes before saving, so that I can verify the intended native schema.
23. As a Pi operator, I want all edits held in memory until I save, so that exploratory changes have no side effects.
24. As a Pi operator, I want Escape to back out of a field or cancel the editor, so that accidental changes are easy to abandon.
25. As a Pi operator, I want cancellation to leave the settings file byte-for-byte unchanged, so that opening the UI is safe.
26. As a Pi operator, I want an explicit save confirmation, so that persistent configuration changes are intentional.
27. As a Pi operator, I want unrelated top-level Pi settings preserved, so that this focused extension does not damage the rest of my setup.
28. As a Pi operator, I want unrelated fields inside `subagents` preserved, so that model editing does not alter tools, limits, watchdog, or orchestration settings.
29. As a Pi operator, I want unrelated fields in an agent override preserved, so that changing its model does not erase tools, skills, prompts, or context settings.
30. As a Pi operator, I want reset-role to remove only model-policy fields managed by this editor, so that other role customizations remain intact.
31. As a Pi operator, I want empty override objects removed, so that the resulting settings remain clean.
32. As a Pi operator, I want the settings update to be atomic, so that interruption cannot leave malformed JSON.
33. As a Pi operator, I want concurrent file changes detected before save, so that the editor does not overwrite another Pi instance or manual edit.
34. As a Pi operator, I want malformed settings to block editing with a clear error, so that the extension never guesses how to repair valuable configuration.
35. As a Pi operator, I want a successful save notification, so that I know where the configuration was written.
36. As a Pi operator, I want guidance to run `/reload` after saving, so that I know when the live `pi-subagents` mapping may still be stale.
37. As a Pi operator, I want guidance to inspect `/subagents-models`, so that I can verify the effective mapping after reload.
38. As a Pi operator, I want the parent Pi session model left unchanged, so that child routing does not disrupt my current conversation.
39. As a user of current `nicobailon/pi-subagents`, I want the extension to use its native settings contract, so that all normal launch paths share the same model policy.
40. As a maintainer, I want unsupported `pi-subagents` versions reported clearly, so that schema incompatibility does not fail silently.

## Implementation Decisions

- The package and extension name is `pi-submodel`.
- The primary command is `/submodel`.
- The first release manages only user-level native `pi-subagents` settings.
- The UI uses prototype variant B: a left-side agent navigator and a focused editor for the selected agent.
- The focused editor contains primary model, thinking level, ordered fallback models, reset, cancel, preview, and save controls.
- The fallback chain borrows the ordered-route language from prototype variant C while retaining variant B's compact layout.
- Initial named-agent navigation includes the `pi-subagents` 0.64 builtins: `scout`, `researcher`, `worker`, `reviewer`, `oracle`, and `delegate`. Existing names already present in `agentOverrides` are also included.
- The default-model item is distinct from named agents because it maps to a different settings field and has no fallback list.
- The prototype established this decision-rich native settings shape:

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

- `Inherit` for the default model removes `subagents.defaultModel`.
- `Inherit` for an agent primary model removes only `agentOverrides.<name>.model`. It does not implicitly remove thinking or fallback settings.
- `Default` for thinking removes only `agentOverrides.<name>.thinking`.
- An empty fallback list removes `agentOverrides.<name>.fallbackModels`.
- Resetting an agent removes the managed `model`, `thinking`, and `fallbackModels` fields while preserving all other fields in that override.
- If removing managed fields leaves an override object empty, the override entry is removed. Empty parent objects created by the operation are also removed.
- Fallback order is persisted exactly as shown.
- A fallback model cannot duplicate another fallback or equal an explicitly selected primary model.
- Models are represented in provider-qualified `provider/model` form when chosen from the registry.
- Model choices are sourced from the current Pi model registry. The selector should respect Pi's scoped model list when the host exposes one.
- A configured model absent from the current registry is represented as an unavailable retained value. The user may preserve, replace, or remove it.
- The extension edits settings rather than intercepting tool calls or delegation events.
- The extension never changes the parent session model.
- The editor loads the settings file once into an in-memory draft. Navigation and field edits mutate only that draft.
- Save requires explicit user confirmation.
- Save reparses or fingerprints the on-disk source and refuses to overwrite it if it changed after the draft was opened. The user must reopen the editor to merge against the new source.
- Save performs a structural merge. It preserves every top-level, `subagents`, and agent-override field not owned by this editor.
- The write uses a temporary file in the same directory followed by an atomic rename.
- The temporary file uses private permissions. Replacement preserves the existing settings file's permission mode when one exists.
- Invalid JSON, a non-object root, or incompatible object shapes produce a clear error and no write.
- The extension does not create a second model-state file and does not maintain a parallel source of truth.
- After save, the UI states that new settings may require `/reload` and recommends `/subagents-models` for verification.
- The extension targets `nicobailon/pi-subagents` 0.64.x and its documented native fields: `defaultModel`, `agentOverrides.<name>.model`, `agentOverrides.<name>.thinking`, and `agentOverrides.<name>.fallbackModels`.
- The extension does not claim compatibility with `pi-subagents` 0.40.0 merely because `Yivas/pi-subagent-models` targeted it. Their persistence and runtime strategies differ.
- Integration with `pi-subagents` must use documented settings and public contracts only. It must not import private internal modules.
- Pi compatibility is declared against the API version used during implementation and verified against the current Pi extension and TUI APIs before release.
- Key bindings follow native TUI expectations: Up/Down moves selection, Enter edits or confirms, Escape backs out or cancels, `a` adds a fallback, `J`/`K` reorders a fallback, `d` deletes one, `r` resets the selected role, and `s` opens save confirmation. Field controls must not trigger global shortcuts while actively editing.

## Testing Decisions

- The primary test seam is the `/submodel` command handler exercised with a temporary settings file, a fake Pi model registry, and a driveable TUI adapter.
- Tests assert external behavior: rendered choices, navigation outcomes, notifications, and final file content. They do not assert private helper calls or component structure.
- The high-level seam covers loading existing settings, editing a default model, editing one named agent, adding and reordering fallbacks, changing thinking, previewing, saving, and reopening the saved state.
- The high-level seam verifies that cancellation leaves the original file byte-for-byte unchanged.
- The high-level seam verifies that unrelated top-level settings, unrelated `subagents` settings, and unrelated fields in the selected agent override survive a save.
- The high-level seam verifies the semantics of Inherit, Default thinking, empty fallbacks, and reset-role cleanup.
- The high-level seam verifies unavailable configured models remain present unless the user explicitly replaces or removes them.
- The high-level seam verifies duplicate fallbacks and a primary-as-fallback choice are rejected in the UI.
- The high-level seam verifies malformed JSON and incompatible shapes produce an error without a write.
- The high-level seam verifies an external file change between open and save is detected and not overwritten.
- The high-level seam verifies a successful save produces valid native `pi-subagents` settings and the reload/verification guidance.
- Narrow file-writer tests are added only for failure behavior that cannot be triggered reliably through the command seam, such as rename failure or permission preservation.
- There is no existing production code in this repository to provide local test prior art. TUI selector behavior may follow the public searchable-selector approach demonstrated by `Yivas/pi-subagent-models`, while persistence assertions follow the documented `nicobailon/pi-subagents` settings schema.
- Compatibility validation includes a fixture representative of `pi-subagents` 0.64.x settings and a smoke check in a real Pi TUI before release.

## Out of Scope

- Project-level `.pi/settings.json` editing.
- Per-session model overrides.
- Runtime request interception or forced overrides.
- Changing the parent Pi session model.
- Editing agent prompts, tools, skills, context inheritance, acceptance policy, or disabled state.
- Editing provider-scoped `agentOverridesByProvider`.
- Editing `modelScope`, default provider, default thinking, maximum thinking, or thinking-disable policy.
- Managing model credentials, providers, authentication, or Pi's model registry.
- Probing models with live paid requests.
- Implementing fallback execution; `pi-subagents` remains responsible for retry eligibility and execution.
- Reproducing FleetView, run monitoring, workflows, schedules, or other `pi-subagents` functionality.
- Full custom-agent discovery across every project, package, and scan directory in the first release.
- Automatically reloading Pi after a save.
- Supporting `tintinweb/pi-subagents` in the first release.
- Preserving comments or non-JSON syntax in the settings file.
- Shipping the throwaway browser prototype as production UI.

## Further Notes

- The selected design is prototype variant B because it remains usable in narrow terminals and gives ordered fallback editing enough room. Variant A is too width-sensitive for a primary TUI, while variant C is better as a mental model for failover than as the main editor.
- `pi-subagents` fallback models are ordered and are used for retryable provider/model failures. Ordinary task failure and the outer run deadline are not fallback triggers.
- The effective `pi-subagents` precedence remains unchanged: per-run model, provider-scoped role override, ordinary per-agent model override, agent frontmatter model, default subagent model, then parent session model.
- `Yivas/pi-subagent-models` is useful selector prior art but is not the implementation base. It stores separate state and patches launch requests to force one model across children.
- The repository is `bioShaun/pi-submodel`.
