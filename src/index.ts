/**
 * pi-submodel — Pi extension entry point.
 *
 * Registers /submodel, which opens a focused two-pane TUI for editing the native
 * pi-subagents model policy in the user-level settings file. This adapter only wires the
 * Pi host into the testable command seam (src/submodel/command.ts); all behavior lives there.
 */
import { getAgentDir, getSettingsPath } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { runSubmodel } from "./submodel/command.ts";
import { detectPiSubagentsVersion } from "./submodel/version-detect.ts";
import type { EditorTheme } from "./submodel/editor/theme.ts";
import type { EditorExit } from "./submodel/types.ts";

/**
 * Resolve the user-level settings.json path. Older Pi releases (0.84.x) do not re-export
 * getSettingsPath through the package entry, so fall back to join(getAgentDir(), ...).
 */
function resolveSettingsPath(): string {
  if (typeof getSettingsPath === "function") return getSettingsPath();
  return join(getAgentDir(), "settings.json");
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("submodel", {
    description: "Edit the pi-subagents model policy (default model, per-agent primary, thinking, fallbacks)",
    handler: async (_args, ctx) => {
      try {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("/submodel requires interactive TUI mode.", "error");
          return;
        }
        const theme: EditorTheme = {
          fg: (color, text) => ctx.ui.theme.fg(color, text),
          bold: (text) => ctx.ui.theme.bold(text),
        };
        await runSubmodel({
          fs: nodeFs,
          settingsPath: resolveSettingsPath(),
          piSubagentsVersion: detectPiSubagentsVersion(nodeFs, getAgentDir()),
          registry:
            ctx.scopedModels.length > 0
              ? ctx.scopedModels.map((scoped) => ({ provider: scoped.model.provider, id: scoped.model.id }))
              : ctx.modelRegistry.getAvailable().map((model) => ({ provider: model.provider, id: model.id })),
          theme,
          openEditor: (component) =>
            ctx.ui.custom<EditorExit>(
              (_tui, _theme, _keybindings, done) => {
                component.setExitHandler(done);
                return component;
              },
              { overlay: false },
            ).then((exit) => exit ?? { action: "cancelled" as const }),
          notify: (message, level) => ctx.ui.notify(message, level),
        });
      } catch (error) {
        ctx.ui.notify(`/submodel failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
