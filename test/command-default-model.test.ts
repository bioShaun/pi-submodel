/** Ticket 02: fuzzy-searching, previewing, and safely saving the default subagent model. */
import assert from "node:assert/strict";
import { chmodSync, statSync } from "node:fs";
import { afterEach, it } from "node:test";
import { startSubmodel } from "./helpers/drive.ts";
import type { Session } from "./helpers/drive.ts";

const SETTINGS = JSON.stringify(
  {
    theme: "test-theme",
    defaultModel: "parent/session-model",
    enabledModels: ["a/b", "c/d"],
    subagents: {
      defaultModel: "tcuni/gpt-5.6-luna",
      defaultThinking: "medium",
      modelScope: { enforce: false },
      agentOverrides: { oracle: { thinking: "high" } },
    },
  },
  null,
  2,
) + "\n";

const sessions: Session[] = [];
async function start(options: Parameters<typeof startSubmodel>[0]): Promise<Session> {
  const session = await startSubmodel(options);
  sessions.push(session);
  return session;
}

function parseSettings(session: Session): Record<string, unknown> {
  const raw = session.readSettings();
  assert.ok(raw !== null, "settings file should exist");
  return JSON.parse(raw) as Record<string, unknown>;
}

afterEach(() => {
  for (const session of sessions) session.cleanup();
  sessions.length = 0;
});

it("supports fuzzy search over provider-qualified models for the default entry", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  session.type("sol");
  const text = session.text();
  assert.ok(text.includes("tcuni/gpt-5.6-sol"), "matching model shown");
  assert.ok(!text.includes("tcuni/gpt-5.6-luna"), "non-matching model filtered out");
  session.press("enter");

  assert.ok(session.text().includes("Default model: tcuni/gpt-5.6-sol"), "draft shows the new selection");
  assert.ok(session.text().includes("unsaved changes"), "dirty state visible");
  assert.equal(session.readSettings(), SETTINGS, "file untouched before save");
});

it("previews the resulting native settings before confirmation", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  session.type("sol");
  session.press("enter");
  session.press("s");

  const preview = session.text();
  assert.ok(preview.includes("Save preview"), "preview header shown");
  assert.ok(preview.includes('"defaultModel": "tcuni/gpt-5.6-sol"'), "new model in preview JSON");
  assert.ok(preview.includes('"defaultThinking": "medium"'), "unrelated subagents fields preserved in preview");
  session.press("escape");

  assert.equal(session.readSettings(), SETTINGS, "escape from preview cancels the save");
});

it("saving structurally merges and preserves all unrelated settings", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  session.type("sol");
  session.press("enter");
  session.press("s");
  session.press("enter");

  const doc = parseSettings(session);
  assert.equal(doc["theme"], "test-theme");
  assert.equal(doc["defaultModel"], "parent/session-model", "parent session model untouched");
  assert.deepEqual(doc["enabledModels"], ["a/b", "c/d"]);
  const subagents = doc["subagents"] as Record<string, unknown>;
  assert.equal(subagents["defaultModel"], "tcuni/gpt-5.6-sol");
  assert.equal(subagents["defaultThinking"], "medium");
  assert.deepEqual(subagents["modelScope"], { enforce: false });
  assert.deepEqual(subagents["agentOverrides"], { oracle: { thinking: "high" } });

  assert.ok(
    session.notifications.some(
      (n) => n.level === "info" && n.message.includes(session.settingsPath) && n.message.includes("/reload") && n.message.includes("/subagents-models"),
    ),
    "success notification with path and guidance",
  );

  session.press("escape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "saved");
});

it("canceling at the discard prompt leaves the file byte-for-byte unchanged", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  session.type("sol");
  session.press("enter");
  session.press("escape"); // back out of the field
  session.press("escape"); // close -> discard prompt
  assert.ok(session.text().includes("Discard unsaved changes?"), "discard confirmation shown");
  session.press("enter");

  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
  assert.equal(session.readSettings(), SETTINGS);
});

it("selecting Inherit removes subagents.defaultModel and cleans up empty objects", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  session.press("up"); // cursor moves from current model onto Inherit
  session.press("enter");
  session.press("s");
  session.press("enter");

  const subagents = parseSettings(session)["subagents"] as Record<string, unknown>;
  assert.ok(!("defaultModel" in subagents), "defaultModel removed");
  assert.equal(subagents["defaultThinking"], "medium", "unrelated subagents field kept");
});

it("removes the whole empty subagents object when nothing else remains", async () => {
  const only = JSON.stringify({ subagents: { defaultModel: "tcuni/gpt-5.6-luna" } }, null, 2) + "\n";
  const session = await start({ settings: only });
  session.press("enter", "enter");
  session.press("up");
  session.press("enter");
  session.press("s");
  session.press("enter");

  const doc = parseSettings(session);
  assert.ok(!("subagents" in doc), "empty subagents object removed");
  assert.deepEqual(doc, {}, "nothing else touched");
});

it("keeps unavailable configured models selectable instead of discarding them", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter");
  const text = session.text();
  assert.ok(text.includes("(unavailable)") === false, "no unavailable models configured here");
  session.press("escape", "escape");
  await session.awaitExit();
});

it("shows and keeps an unavailable configured default model", async () => {
  const stale = JSON.stringify({ subagents: { defaultModel: "gone-provider/gone-model" } }, null, 2) + "\n";
  const session = await start({ settings: stale });
  session.press("enter");
  assert.ok(session.text().includes("gone-provider/gone-model"), "unavailable value offered");
  assert.ok(session.text().includes("(unavailable)"), "marked unavailable");
  session.press("enter"); // keep it
  session.press("s");
  session.press("enter");
  assert.equal(session.readSettings(), stale.replace("gone-provider/gone-model", "gone-provider/gone-model"), "value preserved");
  const doc = parseSettings(session);
  assert.equal((doc["subagents"] as Record<string, unknown>)["defaultModel"], "gone-provider/gone-model");
});

it("refuses the save when the file changed on disk after opening", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  session.type("sol");
  session.press("enter");

  const external = SETTINGS.replace('"theme": "test-theme"', '"theme": "edited-elsewhere"');
  session.writeSettingsExternally(external);

  session.press("s");
  session.press("enter"); // confirm save -> refused

  assert.ok(session.text().includes("refused"), "refusal surfaced in the editor");
  assert.equal(session.readSettings(), external, "external edit not overwritten");

  session.press("escape"); // navigate -> discard prompt (draft still dirty)
  session.press("enter"); // discard and close
  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
});

it("refuses the save when the file was replaced with invalid JSON after opening", async () => {
  const session = await start({ settings: SETTINGS });
  session.writeSettingsExternally("{ broken");
  session.press("s");
  session.press("enter");

  assert.ok(session.text().includes("Invalid JSON"), "parse error surfaced");
  assert.equal(session.readSettings(), "{ broken", "broken file not overwritten");

  session.press("escape"); // not dirty (nothing applied), closes directly
  await session.awaitExit();
});

it("creates a new settings file with private permissions", async () => {
  const session = await start({ settings: null });
  session.press("enter", "enter");
  session.type("sol");
  session.press("enter");
  session.press("s");
  session.press("enter");

  assert.ok(session.settingsExists(), "file created");
  const mode = statSync(session.settingsPath).mode & 0o777;
  assert.equal(mode.toString(8), "600", "new file is private");

  const doc = parseSettings(session);
  assert.equal((doc["subagents"] as Record<string, unknown>)["defaultModel"], "tcuni/gpt-5.6-sol");

  session.press("escape"); // saved: not dirty, closes directly
  const exit = await session.awaitExit();
  assert.equal(exit.action, "saved");
});

it("preserves the existing file's permission mode on replacement", async () => {
  const session = await start({ settings: SETTINGS });
  chmodSync(session.settingsPath, 0o640);
  session.press("enter", "enter");
  session.type("sol");
  session.press("enter");
  session.press("s");
  session.press("enter");

  const mode = statSync(session.settingsPath).mode & 0o777;
  assert.equal(mode.toString(8), "640", "permission mode preserved");

  session.press("escape");
  await session.awaitExit();
});
