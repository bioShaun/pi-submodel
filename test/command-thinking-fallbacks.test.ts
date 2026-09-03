/** Ticket 04: thinking-level selection and the ordered fallback route. */
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { startSubmodel } from "./helpers/drive.ts";
import type { Session } from "./helpers/drive.ts";

const SETTINGS = JSON.stringify(
  {
    defaultModel: "parent/session-model",
    subagents: {
      defaultThinking: "medium",
      agentOverrides: {
        worker: {
          model: "tcuni/gpt-5.6-luna",
          thinking: "low",
          skills: ["review"],
          fallbackModels: ["tcuni/gpt-5.6-sol", "qwen-local/qwen3.8-27b"],
        },
      },
    },
  },
  null,
  2,
) + "\n";

const FOUR_MODELS = [
  { provider: "tcuni", id: "gpt-5.6-luna" },
  { provider: "tcuni", id: "gpt-5.6-sol" },
  { provider: "qwen-local", id: "qwen3.8-27b" },
  { provider: "tcuni", id: "gpt-5.6-nova" },
];

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

function workerOverride(session: Session): Record<string, unknown> {
  const subagents = parseSettings(session)["subagents"] as Record<string, unknown>;
  const overrides = subagents["agentOverrides"] as Record<string, Record<string, unknown>>;
  return overrides["worker"] ?? {};
}

/** Focus the worker entry and move to a field (0=primary, 1=thinking, 2=fallback route).
 *  Leaves the editor in field mode with the selector NOT open. */
function focusWorkerField(session: Session, field: 0 | 1 | 2): void {
  session.press("down", "down", "down"); // default -> scout -> researcher -> worker
  session.press("enter"); // focus fields
  for (let i = 0; i < field; i += 1) session.press("down");
}

afterEach(() => {
  for (const session of sessions) session.cleanup();
  sessions.length = 0;
});

it("offers Default plus every native thinking level", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 1);
  session.press("enter"); // open the thinking selector
  const text = session.text();
  assert.ok(text.includes("Select thinking — worker"), "thinking selector open");
  for (const level of ["Default", "off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    assert.ok(text.includes(level), `level offered: ${level}`);
  }
  session.press("escape", "escape", "escape"); // selector -> field -> navigate -> close
  await session.awaitExit();
});

it("saves a chosen thinking level for the agent", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 1);
  session.press("enter");
  session.press("down", "down"); // low -> medium -> high
  session.press("enter");

  session.press("s");
  session.press("enter");
  const worker = workerOverride(session);
  assert.equal(worker["thinking"], "high");
  assert.equal(worker["model"], "tcuni/gpt-5.6-luna", "primary untouched");
  assert.deepEqual(worker["skills"], ["review"], "unowned fields untouched");

  session.press("escape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "saved");
});

it("Default thinking removes only the thinking override", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 1);
  session.press("enter");
  session.press("up", "up", "up"); // low -> minimal -> off -> Default
  session.press("enter");

  session.press("s");
  session.press("enter");
  const worker = workerOverride(session);
  assert.ok(!("thinking" in worker), "thinking removed");
  assert.equal(worker["model"], "tcuni/gpt-5.6-luna");
  assert.deepEqual(worker["skills"], ["review"]);
  assert.equal(
    (parseSettings(session)["subagents"] as Record<string, unknown>)["defaultThinking"],
    "medium",
    "unrelated subagents thinking kept",
  );

  session.press("escape");
  await session.awaitExit();
});

it("adds a fallback model to the end of the route", async () => {
  const session = await start({ settings: SETTINGS, models: FOUR_MODELS });
  focusWorkerField(session, 2);
  session.press("a"); // open the add-fallback selector
  session.type("nova");
  session.press("enter");

  assert.ok(session.text().includes("3. tcuni/gpt-5.6-nova"), "appended to the end");
  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session)["fallbackModels"], [
    "tcuni/gpt-5.6-sol",
    "qwen-local/qwen3.8-27b",
    "tcuni/gpt-5.6-nova",
  ]);

  session.press("escape");
  await session.awaitExit();
});

it("rejects a duplicate fallback entry", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 2);
  session.press("a");
  session.type("sol");
  session.press("enter"); // duplicate of an existing route entry

  assert.ok(session.text().includes("already in the fallback route"), "rejection surfaced");
  assert.ok(session.text().includes("Add fallback"), "selector stays open");

  session.press("escape"); // abandon the add
  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session)["fallbackModels"], ["tcuni/gpt-5.6-sol", "qwen-local/qwen3.8-27b"]);

  session.press("escape");
  await session.awaitExit();
});

it("rejects the primary model in its own fallback route", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 2);
  session.press("a");
  session.type("luna"); // the primary
  session.press("enter");

  assert.ok(session.text().includes("primary model cannot appear in its own fallback route"), "rejection surfaced");
  session.press("escape"); // abandon the add
  session.press("escape", "escape"); // nothing applied: field -> navigate -> close
  await session.awaitExit();
});

it("the add-fallback selector does not offer Inherit", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 2);
  session.press("a");
  const text = session.text();
  assert.ok(!text.includes("Inherit"), "Inherit is not a fallback candidate");
  session.press("escape", "escape", "escape");
  await session.awaitExit();
});

it("J moves a fallback down and K moves it up, preserving the other entries", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 2);
  session.press("J"); // move entry 1 down: [sol, qwen] -> [qwen, sol]

  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session)["fallbackModels"], ["qwen-local/qwen3.8-27b", "tcuni/gpt-5.6-sol"]);
  assert.deepEqual(workerOverride(session)["skills"], ["review"]);

  session.press("escape"); // saved: closes directly
  const exit = await session.awaitExit();
  assert.equal(exit.action, "saved");
});

it("K moves a fallback up from the middle of the route", async () => {
  const route = JSON.stringify(
    {
      subagents: {
        agentOverrides: {
          worker: {
            model: "tcuni/gpt-5.6-luna",
            fallbackModels: ["tcuni/gpt-5.6-sol", "qwen-local/qwen3.8-27b", "other/last"],
          },
        },
      },
    },
    null,
    2,
  ) + "\n";
  const session = await start({ settings: route });
  focusWorkerField(session, 2);
  session.press("j", "j"); // highlight entry 3 (other/last)
  session.press("K", "K"); // move it up twice

  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session)["fallbackModels"], ["other/last", "tcuni/gpt-5.6-sol", "qwen-local/qwen3.8-27b"]);

  session.press("escape");
  await session.awaitExit();
});

it("d deletes the highlighted fallback and an emptied route removes the field", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 2);
  session.press("d"); // delete entry 1
  assert.ok(session.text().includes("1. qwen-local/qwen3.8-27b"), "route renumbered after delete");

  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session)["fallbackModels"], ["qwen-local/qwen3.8-27b"]);

  session.press("enter", "down", "down"); // back into the route field
  session.press("d"); // delete the remaining entry
  session.press("s");
  session.press("enter");
  assert.ok(!("fallbackModels" in workerOverride(session)), "empty route removes the field");
  assert.equal(workerOverride(session)["model"], "tcuni/gpt-5.6-luna", "primary kept");

  session.press("escape");
  await session.awaitExit();
});

it("retains unavailable fallback models and can remove them explicitly", async () => {
  const stale = SETTINGS.replace('"tcuni/gpt-5.6-sol"', '"gone-provider/gone-model"');
  const session = await start({ settings: stale });
  focusWorkerField(session, 2);
  assert.ok(session.text().includes("gone-provider/gone-model (unavailable)"), "unavailable fallback marked");

  session.press("s");
  session.press("enter"); // save untouched: value retained
  assert.deepEqual(workerOverride(session)["fallbackModels"], ["gone-provider/gone-model", "qwen-local/qwen3.8-27b"]);

  session.press("enter", "down", "down"); // back into the route field
  session.press("d"); // remove it explicitly
  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session)["fallbackModels"], ["qwen-local/qwen3.8-27b"]);

  session.press("escape");
  await session.awaitExit();
});

it("reset removes model, thinking, and fallback fields but keeps unowned fields", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 2);
  session.press("escape"); // back to navigator (worker still selected)
  session.press("r");

  session.press("s");
  session.press("enter");
  assert.deepEqual(workerOverride(session), { skills: ["review"] }, "only unowned fields survive");
  session.press("escape");
  await session.awaitExit();
});

it("save preview expresses the ordered route and the resulting native settings", async () => {
  const session = await start({ settings: SETTINGS });
  session.press("s");
  const text = session.text();
  assert.ok(text.includes("worker: tcuni/gpt-5.6-luna → tcuni/gpt-5.6-sol → qwen-local/qwen3.8-27b · thinking low"), "route line");
  assert.ok(text.includes('"fallbackModels"'), "native JSON in preview");
  assert.ok(text.includes('"thinking": "low"'), "thinking in preview");
  session.press("escape", "escape"); // preview -> navigate -> close
  await session.awaitExit();
});

it("saving and reopening reproduces the full policy", async () => {
  const session = await start({ settings: SETTINGS });
  focusWorkerField(session, 1);
  session.press("enter");
  session.press("down", "down"); // thinking high
  session.press("enter");
  session.press("s");
  session.press("enter");
  session.press("escape");
  await session.awaitExit();

  const saved = session.readSettings();
  assert.ok(saved !== null);
  const reopened = await start({ settings: saved });
  reopened.press("down", "down", "down", "enter"); // open the worker editor pane
  const text = reopened.text();
  assert.ok(text.includes("Thinking: high"), "thinking visible after reopen");
  assert.ok(text.includes("1. tcuni/gpt-5.6-sol"), "route entry 1 visible after reopen");
  assert.ok(text.includes("2. qwen-local/qwen3.8-27b"), "route entry 2 visible after reopen");
  reopened.press("escape", "escape"); // field -> navigator -> close
  await reopened.awaitExit();
});
