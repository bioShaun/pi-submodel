/** Ticket 03: assigning, inheriting, and resetting per-agent primary models safely. */
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
        worker: { model: "tcuni/gpt-5.6-luna", tools: ["read", "bash"] },
        oracle: { model: "tcuni/gpt-5.6-sol" },
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

function parseSettings(session: Session): Record<string, unknown> {
  const raw = session.readSettings();
  assert.ok(raw !== null, "settings file should exist");
  return JSON.parse(raw) as Record<string, unknown>;
}

function overrides(session: Session): Record<string, Record<string, unknown>> {
  const subagents = parseSettings(session)["subagents"] as Record<string, unknown>;
  return (subagents["agentOverrides"] ?? {}) as Record<string, Record<string, unknown>>;
}

/** Navigate to an agent entry by name and focus its primary-model selector. */
function openPrimarySelector(session: Session, name: string): void {
  const order = ["scout", "researcher", "worker", "reviewer", "oracle", "delegate"];
  const index = order.indexOf(name) + 1; // +1 for the default entry
  assert.ok(index > 0, `test navigates a builtin agent, got ${name}`);
  for (let i = 0; i < index; i += 1) session.press("down");
  session.press("enter"); // focus fields
  session.press("enter"); // open the primary-model selector
}

afterEach(() => {
  for (const session of sessions) session.cleanup();
  sessions.length = 0;
});

it("lists configured agents beyond the builtins and shows their assignments", async () => {
  const settings = JSON.stringify(
    { subagents: { agentOverrides: { worker: { model: "tcuni/gpt-5.6-luna" }, "my-scout": { model: "tcuni/gpt-5.6-sol" } } } },
    null,
    2,
  ) + "\n";
  const session = await start({ settings });
  const text = session.text();
  assert.ok(text.includes("worker"), "builtin listed");
  assert.ok(text.includes("my-scout"), "configured non-builtin agent listed");
  assert.ok(text.includes("tcuni/gpt-5.6-luna"), "current assignment visible");
  session.press("escape");
  await session.awaitExit();
});

it("assigns a primary model to an agent and saves only after confirmation", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "worker");
  session.type("sol");
  session.press("enter"); // pick tcuni/gpt-5.6-sol

  assert.ok(session.text().includes("Primary model: tcuni/gpt-5.6-sol"), "draft shows the new model");
  assert.equal(session.readSettings(), SETTINGS, "file untouched before save");

  session.press("s");
  session.press("enter"); // confirm
  const worker = overrides(session)["worker"] ?? {};
  assert.equal(worker["model"], "tcuni/gpt-5.6-sol");
  assert.deepEqual(worker["tools"], ["read", "bash"], "unowned override field preserved");
  assert.equal(parseSettings(session)["defaultModel"], "parent/session-model", "parent session model untouched");
  assert.equal((parseSettings(session)["subagents"] as Record<string, unknown>)["defaultThinking"], "medium");

  session.press("escape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "saved");
});

it("keeps other agents' overrides untouched when editing one agent", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "worker");
  session.type("sol");
  session.press("enter");
  session.press("s");
  session.press("enter");

  const map = overrides(session);
  assert.deepEqual(map["oracle"], { model: "tcuni/gpt-5.6-sol" }, "other agent unchanged");
});

it("Inherit removes only the selected agent's model override", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "worker");
  session.press("up"); // from the current model onto Inherit
  session.press("enter");

  assert.ok(session.text().includes("Primary model: (inherit)"), "draft shows inherit");

  session.press("s");
  session.press("enter");
  const worker = overrides(session)["worker"] ?? {};
  assert.ok(!("model" in worker), "model removed");
  assert.deepEqual(worker["tools"], ["read", "bash"], "unowned fields kept");
  const oracle = overrides(session)["oracle"] ?? {};
  assert.equal(oracle["model"], "tcuni/gpt-5.6-sol", "other agents untouched");
});

it("removes an emptied override entry and empty parents during cleanup", async () => {
  const settings = JSON.stringify({ subagents: { agentOverrides: { worker: { model: "tcuni/gpt-5.6-luna" } } } }, null, 2) + "\n";
  const session = await start({ settings });
  openPrimarySelector(session, "worker");
  session.press("up");
  session.press("enter");
  session.press("s");
  session.press("enter");

  assert.deepEqual(parseSettings(session), {}, "empty override, agentOverrides, and subagents removed");
});

it("assigns models to two different agents in one session", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "scout");
  session.type("sol");
  session.press("enter");
  session.press("escape"); // field -> navigator (scout stays selected)
  session.press("down", "down"); // scout -> worker
  session.press("enter");
  session.press("enter");
  session.type("qwen");
  session.press("enter");

  session.press("s");
  session.press("enter");
  const map = overrides(session);
  assert.equal((map["scout"] ?? {})["model"], "tcuni/gpt-5.6-sol");
  assert.equal((map["worker"] ?? {})["model"], "qwen-local/qwen3.8-27b");
  assert.deepEqual((map["worker"] ?? {})["tools"], ["read", "bash"]);
});

it("reset removes the managed model but keeps unowned fields", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "worker");
  session.press("escape"); // back to field mode
  session.press("r"); // reset the selected role

  session.press("s");
  session.press("enter");
  const worker = overrides(session)["worker"] ?? {};
  assert.ok(!("model" in worker), "managed model removed");
  assert.deepEqual(worker["tools"], ["read", "bash"], "unowned fields survive reset");
});

it("keeps an unavailable configured primary unless explicitly replaced", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "worker");
  assert.ok(session.text().includes("gone-provider/gone-model") === false, "not offered unless configured");

  const stale = SETTINGS.replace("tcuni/gpt-5.6-luna", "gone-provider/gone-model");
  const session2 = await start({ settings: stale });
  openPrimarySelector(session2, "worker");
  assert.ok(session2.text().includes("gone-provider/gone-model"), "unavailable value offered");
  assert.ok(session2.text().includes("(unavailable)"), "marked unavailable");
  session2.press("enter"); // keep it
  session2.press("s");
  session2.press("enter");
  assert.equal((overrides(session2)["worker"] ?? {})["model"], "gone-provider/gone-model");

  session2.press("escape");
  await session2.awaitExit();
});

it("saving and reopening shows the same primary model", async () => {
  const session = await start({ settings: SETTINGS });
  openPrimarySelector(session, "worker");
  session.type("sol");
  session.press("enter");
  session.press("s");
  session.press("enter");
  session.press("escape");
  await session.awaitExit();

  const saved = session.readSettings();
  assert.ok(saved !== null);
  const reopened = await start({ settings: saved });
  assert.ok(reopened.text().includes("tcuni/gpt-5.6-sol"), "saved model visible after reopening");
  reopened.press("escape");
  await reopened.awaitExit();
});
