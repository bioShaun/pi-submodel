/** Narrow persistence tests for the settings file: atomic-write failure modes, validation
 * errors, and fingerprint behavior that cannot be triggered reliably through the command seam. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { basename, dirname, join } from "node:path";
import {
  ABSENT_FINGERPRINT,
  readSettingsFile,
  rereadSnapshot,
  SettingsError,
  writeSettingsFile,
} from "../src/submodel/settings-file.ts";
import type { FsLike } from "../src/submodel/settings-file.ts";

const TARGET = "/home/test/.pi/settings.json";
const DIR = dirname(TARGET);
const BASENAME = basename(TARGET);

const DOC = {
  theme: "dark",
  subagents: {
    defaultModel: "prov/main",
    agentOverrides: {
      scout: { model: "prov/scout-a" },
    },
  },
};
const SERIALIZED = JSON.stringify(DOC, null, 2) + "\n";

interface WriteRecord {
  path: string;
  data: string;
  flag?: string;
  mode?: number;
}

/** In-memory FsLike: writeFileSync records data/flag/mode and honors "wx"; renameSync can be made to fail. */
function makeFakeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const modes = new Map<string, number>();
  const written: WriteRecord[] = [];
  const unlinked: string[] = [];
  let failRenames = false;
  const fs: FsLike = {
    existsSync: (path) => files.has(path),
    readFileSync: (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`);
      return Buffer.from(content, "utf8");
    },
    statSync: (path) => ({ mode: modes.get(path) ?? 0o600 }),
    writeFileSync: (path, data, options) => {
      if (options?.flag === "wx" && files.has(path)) {
        throw new Error(`EEXIST: file already exists: ${path}`);
      }
      const text = typeof data === "string" ? data : data.toString("utf8");
      written.push({ path, data: text, flag: options?.flag, mode: options?.mode });
      files.set(path, text);
      if (options?.mode !== undefined) modes.set(path, options.mode);
    },
    renameSync: (from, to) => {
      if (failRenames) throw new Error(`EACCES: rename failed: ${from} -> ${to}`);
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT: no such file: ${from}`);
      files.delete(from);
      files.set(to, content);
      const mode = modes.get(from);
      if (mode !== undefined) {
        modes.delete(from);
        modes.set(to, mode);
      }
    },
    unlinkSync: (path) => {
      unlinked.push(path);
      files.delete(path);
    },
  };
  return {
    fs,
    written,
    modes,
    unlinked,
    failRenames: () => {
      failRenames = true;
    },
    listing: () => [...files.keys()].sort(),
    temps: () =>
      [...files.keys()]
        .filter((p) => basename(p).startsWith(".") && basename(p).endsWith(".tmp"))
        .sort(),
  };
}

function assertSettingsError(run: () => unknown, expected: RegExp): void {
  assert.throws(
    run,
    (error: unknown) => error instanceof SettingsError && expected.test(error.message),
    `expected a SettingsError matching ${String(expected)}`,
  );
}

it("writeSettingsFile serializes the document over the target, writes new files private, and leaves no temp files behind", () => {
  const fake = makeFakeFs();
  writeSettingsFile(fake.fs, TARGET, DOC, false);

  const record = fake.written[0];
  assert.ok(record, "the temp file write is recorded");
  assert.equal(fake.written.length, 1, "exactly one write happens: the temp file");
  assert.ok(
    record.path.startsWith(DIR + "/") &&
      basename(record.path).startsWith(".") &&
      basename(record.path).endsWith(".tmp"),
    "the write goes to a temp file in the same directory",
  );
  assert.equal(record.data, SERIALIZED, "the serialized document is written");
  assert.equal(record.flag, "wx", "the temp file is created exclusively");
  assert.equal(record.mode, 0o600, "new files are written private");

  assert.deepEqual(fake.listing(), [TARGET], "only the target remains after the rename");
  assert.equal(fake.fs.readFileSync(TARGET).toString("utf8"), SERIALIZED);
});

it("writeSettingsFile preserves an existing file's mode when overwriting", () => {
  const fake = makeFakeFs({ [TARGET]: '{\n  "old": true\n}\n' });
  fake.modes.set(TARGET, 0o640);

  writeSettingsFile(fake.fs, TARGET, DOC, true);

  const record = fake.written[0];
  assert.ok(record, "the temp file write is recorded");
  assert.equal(record.mode, 0o640, "the existing file's mode is reused for the temp write");
  assert.equal(fake.fs.readFileSync(TARGET).toString("utf8"), SERIALIZED, "the content is replaced");
  assert.deepEqual(fake.listing(), [TARGET], "no temp files remain");
});

it("writeSettingsFile propagates rename failures, unlinks the temp file, and leaves the original content untouched", () => {
  const original = '{\n  "old": true\n}\n';
  const fake = makeFakeFs({ [TARGET]: original });
  fake.modes.set(TARGET, 0o640);
  fake.failRenames();

  assert.throws(() => writeSettingsFile(fake.fs, TARGET, DOC, true), /EACCES/);

  assert.equal(fake.written.length, 1, "the temp write happened before the rename");
  const removed = fake.unlinked[0];
  assert.ok(removed, "the temp entry was unlinked during cleanup");
  assert.ok(
    basename(removed).startsWith(".") && basename(removed).endsWith(".tmp"),
    "the unlinked entry is the temp file",
  );
  assert.deepEqual(fake.temps(), [], "no temp entries remain");
  assert.deepEqual(fake.listing(), [TARGET], "the directory holds only the original target");
  assert.equal(fake.fs.readFileSync(TARGET).toString("utf8"), original, "the original content is untouched");
});

it("writeSettingsFile propagates write failures from the wx collision, cleans up the temp entry, and leaves the original untouched", () => {
  const original = '{\n  "old": true\n}\n';
  const fake = makeFakeFs({ [TARGET]: original });
  fake.modes.set(TARGET, 0o640);

  // The temp name embeds process.pid and a Math.random() suffix; pin the random source so
  // the exact temp path can be pre-seeded and the "wx" write collides with it.
  const pinnedRandom = 0.5;
  const tempPath = join(DIR, `.${BASENAME}.${process.pid}.${pinnedRandom.toString(36).slice(2, 10)}.tmp`);
  fake.fs.writeFileSync(tempPath, "stale temp entry");

  const realRandom = Math.random;
  Math.random = () => pinnedRandom;
  try {
    assert.throws(() => writeSettingsFile(fake.fs, TARGET, DOC, true), /EEXIST/);
  } finally {
    Math.random = realRandom;
  }

  assert.ok(fake.unlinked.includes(tempPath), "the colliding temp entry was unlinked during cleanup");
  assert.deepEqual(fake.temps(), [], "no temp entries remain");
  assert.deepEqual(fake.listing(), [TARGET]);
  assert.equal(fake.fs.readFileSync(TARGET).toString("utf8"), original, "the original content is untouched");
});

it("readSettingsFile loads an absent file as an empty document with the absent fingerprint", () => {
  const fake = makeFakeFs();
  assert.deepEqual(readSettingsFile(fake.fs, TARGET), {
    doc: {},
    existed: false,
    fingerprint: ABSENT_FINGERPRINT,
    agents: {},
  });
});

it("readSettingsFile loads an empty file as an existing empty document", () => {
  const fake = makeFakeFs({ [TARGET]: "" });
  const loaded = readSettingsFile(fake.fs, TARGET);
  assert.equal(loaded.existed, true);
  assert.deepEqual(loaded.doc, {});
  assert.deepEqual(loaded.agents, {});
  assert.notEqual(loaded.fingerprint, ABSENT_FINGERPRINT, "an empty file still has a content fingerprint");
});

it("readSettingsFile rejects malformed JSON", () => {
  const fake = makeFakeFs({ [TARGET]: "{ definitely not json" });
  assertSettingsError(() => readSettingsFile(fake.fs, TARGET), /Invalid JSON/);
});

it("readSettingsFile rejects a non-object root", () => {
  const fake = makeFakeFs({ [TARGET]: "[1, 2, 3]\n" });
  assertSettingsError(() => readSettingsFile(fake.fs, TARGET), /expected a JSON object/);
});

it("readSettingsFile rejects a non-object subagents section", () => {
  const fake = makeFakeFs({ [TARGET]: JSON.stringify({ subagents: "yes" }) });
  assertSettingsError(() => readSettingsFile(fake.fs, TARGET), /"subagents" must be an object/);
});

it("readSettingsFile rejects agentOverrides entries that are not objects", () => {
  const fake = makeFakeFs({ [TARGET]: JSON.stringify({ subagents: { agentOverrides: { worker: "nope" } } }) });
  assertSettingsError(() => readSettingsFile(fake.fs, TARGET), /agentOverrides\.worker" must be an object/);
});

it("readSettingsFile rejects bad managed field types and names the offending path", () => {
  const cases = [
    { doc: { subagents: { agentOverrides: { worker: { model: 42 } } } }, expected: /agentOverrides\.worker\.model/ },
    {
      doc: { subagents: { agentOverrides: { worker: { thinking: 3 } } } },
      expected: /agentOverrides\.worker\.thinking/,
    },
    {
      doc: { subagents: { agentOverrides: { worker: { fallbackModels: "nope" } } } },
      expected: /agentOverrides\.worker\.fallbackModels/,
    },
    {
      doc: { subagents: { agentOverrides: { worker: { fallbackModels: ["a", 2] } } } },
      expected: /agentOverrides\.worker\.fallbackModels/,
    },
  ];
  for (const { doc, expected } of cases) {
    const fake = makeFakeFs({ [TARGET]: JSON.stringify(doc) + "\n" });
    assertSettingsError(() => readSettingsFile(fake.fs, TARGET), expected);
  }
});

it("readSettingsFile extracts the managed policy from a valid document, preserving false sentinels", () => {
  const doc = {
    theme: "dark",
    subagents: {
      defaultModel: "prov/main",
      agentOverrides: {
        scout: { model: "prov/scout-a", thinking: "low", fallbackModels: ["prov/f1", "prov/f2"] },
        worker: { fallbackModels: false },
        reviewer: { thinking: false },
      },
    },
  };
  const fake = makeFakeFs({ [TARGET]: JSON.stringify(doc, null, 2) + "\n" });
  const loaded = readSettingsFile(fake.fs, TARGET);
  assert.equal(loaded.existed, true);
  assert.equal(loaded.defaultModel, "prov/main");
  assert.deepEqual(loaded.agents["scout"], {
    model: "prov/scout-a",
    thinking: "low",
    fallbackModels: ["prov/f1", "prov/f2"],
  });
  assert.equal(loaded.agents["worker"]?.fallbackModels, false, "fallbackModels: false round-trips as false");
  assert.equal(loaded.agents["reviewer"]?.thinking, false, "thinking: false round-trips as false");
  assert.deepEqual(
    Object.keys(loaded.agents).sort(),
    ["reviewer", "scout", "worker"],
    "only managed agents are extracted",
  );
});

it("a document written through writeSettingsFile round-trips with its managed policy intact", () => {
  const doc = {
    subagents: {
      defaultModel: "prov/main",
      agentOverrides: {
        worker: { fallbackModels: false },
        reviewer: { thinking: false },
      },
    },
  };
  const fake = makeFakeFs();
  writeSettingsFile(fake.fs, TARGET, doc, false);
  const loaded = readSettingsFile(fake.fs, TARGET);
  assert.deepEqual(loaded.doc, doc);
  assert.equal(loaded.defaultModel, "prov/main");
  assert.equal(loaded.agents["worker"]?.fallbackModels, false);
  assert.equal(loaded.agents["reviewer"]?.thinking, false);
});

it("rereadSnapshot reflects the current on-disk content and a changed fingerprint", () => {
  const fake = makeFakeFs({
    [TARGET]: JSON.stringify({ subagents: { defaultModel: "prov/one" } }, null, 2) + "\n",
  });
  const before = rereadSnapshot(fake.fs, TARGET);
  assert.deepEqual(before.doc, { subagents: { defaultModel: "prov/one" } });
  assert.equal(before.existed, true);

  writeSettingsFile(fake.fs, TARGET, { theme: "changed" }, true);
  const after = rereadSnapshot(fake.fs, TARGET);
  assert.deepEqual(after.doc, { theme: "changed" });
  assert.notEqual(after.fingerprint, before.fingerprint, "the fingerprint tracks the new content");
});

it("rereadSnapshot reports an absent file with the absent fingerprint", () => {
  const fake = makeFakeFs();
  const snapshot = rereadSnapshot(fake.fs, TARGET);
  assert.equal(snapshot.existed, false);
  assert.deepEqual(snapshot.doc, {});
  assert.equal(snapshot.fingerprint, ABSENT_FINGERPRINT);
});

it("rereadSnapshot rejects malformed JSON on disk", () => {
  const fake = makeFakeFs({ [TARGET]: "{ definitely not json" });
  assertSettingsError(() => rereadSnapshot(fake.fs, TARGET), /Invalid JSON/);
});

it("fingerprints are stable for identical content and differ across contents", () => {
  const fake = makeFakeFs({ [TARGET]: SERIALIZED });
  const first = readSettingsFile(fake.fs, TARGET);
  const second = readSettingsFile(fake.fs, TARGET);
  assert.equal(first.fingerprint, second.fingerprint, "the same content read twice yields one fingerprint");

  writeSettingsFile(fake.fs, TARGET, { theme: "dark" }, true);
  const changed = readSettingsFile(fake.fs, TARGET);
  assert.notEqual(changed.fingerprint, first.fingerprint, "changed content yields a new fingerprint");
});

it("an absent file's fingerprint differs from any content fingerprint", () => {
  const fake = makeFakeFs();
  const absent = readSettingsFile(fake.fs, TARGET);
  assert.equal(absent.fingerprint, ABSENT_FINGERPRINT);

  fake.fs.writeFileSync(TARGET, '{"theme":"dark"}');
  const present = readSettingsFile(fake.fs, TARGET);
  assert.notEqual(present.fingerprint, ABSENT_FINGERPRINT);
  assert.notEqual(absent.fingerprint, present.fingerprint);
});
