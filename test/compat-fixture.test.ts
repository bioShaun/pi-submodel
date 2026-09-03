/**
 * Ticket 05: a settings fixture representative of a real pi-subagents 0.64.x installation
 * (managed fields alongside the documented unowned ones) must survive a full /submodel
 * configuration flow: edit default + agent policy, save, reopen, and verify nothing
 * unowned changed.
 */
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { startSubmodel } from "./helpers/drive.ts";
import type { Session } from "./helpers/drive.ts";

/** Representative user settings: pi 0.84 top-level fields + pi-subagents 0.64 policy. */
const FIXTURE = JSON.stringify(
  {
    theme: "dark",
    defaultModel: "parent/session-model",
    enabledModels: ["tcuni/gpt-5.6-luna", "tcuni/gpt-5.6-sol", "qwen-local/qwen3.8-27b"],
    packages: ["pi-subagents"],
    subagents: {
      defaultModel: "tcuni/gpt-5.6-sol",
      defaultThinking: "medium",
      modelScope: { enforce: false },
      maxRuns: 8,
      agentOverrides: {
        worker: {
          model: "tcuni/gpt-5.6-luna",
          thinking: "low",
          fallbackModels: ["qwen-local/qwen3.8-27b"],
          tools: ["read", "bash"],
          skills: ["tdd"],
          context: "fork",
        },
        oracle: {
          thinking: "xhigh",
          acceptance: { level: "checked" },
        },
      },
    },
  },
  null,
  2,
) + "\n";

const MODELS = [
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

function doc(session: Session): Record<string, unknown> {
  return JSON.parse(session.readSettings()!) as Record<string, unknown>;
}

afterEach(() => {
  for (const session of sessions) session.cleanup();
  sessions.length = 0;
});

it("a representative pi-subagents 0.64 settings fixture passes the full flow", async () => {
  const session = await start({ settings: FIXTURE, models: MODELS });
  assert.ok(session.opened, "editor opens for the 0.64-shaped fixture");

  // Change the default model.
  session.press("enter", "enter");
  session.type("luna");
  session.press("enter");

  // Give scout a full policy: primary + thinking + a second fallback.
  session.press("escape"); // field -> navigator
  session.press("down"); // default -> scout
  session.press("enter"); // fields
  session.press("enter"); // primary selector
  session.type("nova");
  session.press("enter"); // tcuni/gpt-5.6-nova
  session.press("down", "enter"); // thinking field -> selector
  session.press("down", "down", "down", "down", "down", "down"); // Default -> xhigh
  session.press("enter");
  session.press("a"); // add fallback selector
  session.type("27b");
  session.press("enter");

  session.press("s");
  const preview = session.text();
  assert.ok(preview.includes("scout: tcuni/gpt-5.6-nova"), "preview shows scout primary");
  session.press("enter"); // confirm save

  const saved = doc(session);
  const subagents = saved["subagents"] as Record<string, unknown>;
  assert.equal(subagents["defaultModel"], "tcuni/gpt-5.6-luna");
  assert.equal(subagents["defaultThinking"], "medium", "unowned subagents field preserved");
  assert.deepEqual(subagents["modelScope"], { enforce: false });
  assert.equal(subagents["maxRuns"], 8);

  const overrides = subagents["agentOverrides"] as Record<string, Record<string, unknown>>;
  assert.deepEqual(overrides["scout"], {
    model: "tcuni/gpt-5.6-nova",
    thinking: "xhigh",
    fallbackModels: ["qwen-local/qwen3.8-27b"],
  }, "scout got the new primary, thinking, and route");
  const worker = overrides["worker"] as Record<string, unknown>;
  assert.equal(worker["model"], "tcuni/gpt-5.6-luna", "worker untouched");
  assert.deepEqual(worker["tools"], ["read", "bash"]);
  assert.deepEqual(worker["skills"], ["tdd"]);
  assert.equal(worker["context"], "fork");
  const oracle = overrides["oracle"] as Record<string, unknown>;
  assert.equal(oracle["thinking"], "xhigh", "oracle untouched");
  assert.deepEqual(oracle["acceptance"], { level: "checked" });

  assert.equal(saved["theme"], "dark");
  assert.equal(saved["defaultModel"], "parent/session-model", "parent session model untouched");
  assert.deepEqual(saved["enabledModels"], ["tcuni/gpt-5.6-luna", "tcuni/gpt-5.6-sol", "qwen-local/qwen3.8-27b"]);
  assert.deepEqual(saved["packages"], ["pi-subagents"]);

  // Reopen the saved file: the editor must come up clean and show the persisted policy.
  const savedText = session.readSettings()!;
  session.press("escape");
  const exit = await session.awaitExit();
  assert.equal(exit.action, "saved");

  const reopened = await start({ settings: savedText });
  assert.ok(reopened.text().includes("no changes"), "reopened editor is clean");
  reopened.press("escape");
  await reopened.awaitExit();
});

it("the same fixture is refused when the file changes underneath the editor", async () => {
  const session = await start({ settings: FIXTURE });
  session.press("enter", "enter");
  session.type("luna");
  session.press("enter");

  session.writeSettingsExternally(FIXTURE.replace('"maxRuns": 8', '"maxRuns": 9'));

  session.press("s");
  session.press("enter");
  assert.ok(session.text().includes("refused"), "concurrent change surfaced");
  assert.ok(session.readSettings()!.includes('"maxRuns": 9'), "external edit not overwritten");

  session.press("escape"); // navigate -> discard prompt
  session.press("enter"); // discard and close
  await session.awaitExit();
});
