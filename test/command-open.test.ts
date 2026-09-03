/** Ticket 01: opening, navigating, and closing the read-only editor never writes. */
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { startSubmodel } from "./helpers/drive.ts";
import type { Session } from "./helpers/drive.ts";

const SETTINGS = JSON.stringify(
  {
    theme: "test-theme",
    defaultModel: "parent/session-model",
    subagents: {
      defaultModel: "tcuni/gpt-5.6-luna",
      agentOverrides: {
        planner: { model: "gone-provider/gone-model" },
      },
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

afterEach(() => {
  for (const session of sessions) session.cleanup();
  sessions.length = 0;
});

it("opens the navigator with the default entry, builtins, and configured extras", async () => {
  const session = await start({ settings: SETTINGS });
  assert.ok(session.opened);
  const text = session.text();
  for (const expected of ["default", "scout", "researcher", "worker", "reviewer", "oracle", "delegate", "planner"]) {
    assert.ok(text.includes(expected), `navigator should include ${expected}`);
  }
});

it("shows current assignments and marks unavailable configured models", async () => {
  const session = await start({ settings: SETTINGS });
  assert.ok(session.text().includes("tcuni/gpt-5.6-luna"), "default model shown");

  // navigator order: default, scout, researcher, worker, reviewer, oracle, delegate, planner
  for (let i = 0; i < 7; i += 1) session.press("down");
  const text = session.text();
  assert.ok(text.includes("Agent: planner"), "focused agent shown");
  assert.ok(text.includes("gone-provider/gone-model"), "configured model shown");
  assert.ok(text.includes("(unavailable)"), "unavailable marker shown");
});

it("Enter focuses the editor and Escape backs out, then closes", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter");
  assert.ok(
    session.text().includes("> Primary model:") || session.text().includes("> Default model:"),
    "field focus marker shown",
  );

  session.press("escape");
  assert.ok(!session.text().includes("> Default model:"), "back in navigator mode");

  session.press("escape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
});

it("opening, navigating, and closing leaves the settings file byte-for-byte unchanged", async () => {
  const session = await start({ settings: SETTINGS });
  const bytes = session.readSettings();
  session.press("down", "down", "enter", "escape", "up", "escape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
  assert.equal(session.readSettings(), bytes);
});

it("Kitty protocol arrows navigate the navigator entries", async () => {
  const session = await start({ settings: SETTINGS });
  const initialSelected = session.lines().find((line) => line.includes("→ "));
  assert.ok(initialSelected, "default entry is initially selected");

  session.press("kittyDown");
  const afterDown = session.lines().find((line) => line.includes("→ "));
  assert.ok(afterDown, "kitty down selects an entry");
  assert.notEqual(afterDown, initialSelected, "kitty down moves to another navigator entry");

  session.press("kittyUp");
  assert.equal(
    session.lines().find((line) => line.includes("→ ")),
    initialSelected,
    "kitty up returns to the original navigator entry",
  );
});

it("Kitty Ctrl+C closes the selector without typing into its query", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("enter", "enter");
  assert.ok(session.text().includes("Search: ▌"), "selector is open with an empty query");

  session.press("kittyCtrlC");
  let text = session.text();
  assert.ok(!text.includes("Search:"), "selector closed — ctrl+c never landed in the query");
  assert.ok(text.includes("> Default model:"), "back in field mode");

  // The simplified and event-typed Kitty ctrl+c encodings must behave identically.
  for (const key of ["kittyCtrlCEvent", "kittyCtrlCSimplified"] as const) {
    session.press("enter");
    assert.ok(session.text().includes("Search: ▌"), "selector reopened");
    session.press(key);
    text = session.text();
    assert.ok(!text.includes("Search:"), `${key} closed the selector instead of typing`);
    assert.ok(text.includes("> Default model:"), `${key} returned to field mode`);
  }

  // The editor is still alive: kitty Esc walks back to the navigator, kitty ctrl+c closes it.
  session.press("kittyEscape");
  session.press("kittyCtrlCSimplified");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
  assert.equal(session.readSettings(), SETTINGS, "no settings written");
});

it("a clean navigator exits with Kitty Esc", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("kittyEscape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
  assert.equal(session.readSettings(), SETTINGS, "closing without edits writes nothing");
});

it("a clean navigator exits with Kitty Ctrl+C in its simplified encoding", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("kittyCtrlCSimplified");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "cancelled");
  assert.equal(session.readSettings(), SETTINGS, "closing without edits writes nothing");
});

it("refuses to open for an incompatible pi-subagents version and reports it clearly", async () => {
  const session = await start({ settings: SETTINGS, version: "0.63.2" });
  assert.equal(session.opened, false);
  assert.ok(
    session.notifications.some((n) => n.level === "error" && n.message.includes("0.64")),
    "error names the supported 0.64.x target",
  );
  assert.equal(session.readSettings(), SETTINGS, "no settings written");
});

it("reports an undetected pi-subagents version but still opens", async () => {
  const session = await start({ settings: SETTINGS, version: null });
  assert.ok(session.opened);
  assert.ok(
    session.notifications.some((n) => n.level === "warning" && n.message.includes("pi-subagents")),
    "warning about undetected pi-subagents",
  );
});

it("blocks editing when settings are malformed and writes nothing", async () => {
  const broken = "{ definitely not json";
  const session = await start({ settings: broken });
  assert.equal(session.opened, false);
  assert.ok(
    session.notifications.some((n) => n.level === "error" && n.message.includes(session.settingsPath)),
    "clear error naming the settings file",
  );
  assert.equal(session.readSettings(), broken, "file untouched");
});

it("blocks editing when the settings root is not an object", async () => {
  const session = await start({ settings: "[1, 2, 3]\n" });
  assert.equal(session.opened, false);
  assert.ok(session.notifications.some((n) => n.level === "error"));
  assert.equal(session.readSettings(), "[1, 2, 3]\n");
});

it("blocks editing when agentOverrides entries are not objects", async () => {
  const content = JSON.stringify({ subagents: { agentOverrides: { worker: "not-an-object" } } }, null, 2) + "\n";
  const session = await start({ settings: content });
  assert.equal(session.opened, false);
  assert.ok(
    session.notifications.some((n) => n.level === "error" && n.message.includes("agentOverrides.worker")),
    "error names the incompatible shape",
  );
});
