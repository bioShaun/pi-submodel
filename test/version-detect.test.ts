/** src/index.ts should now only wire the host into the seam. */
import assert from "node:assert/strict";
import { it } from "node:test";
import { detectPiSubagentsVersion } from "../src/submodel/version-detect.ts";
import type { DetectFs } from "../src/submodel/version-detect.ts";

function fakeFs(files: Record<string, string>, dirs: string[] = []): DetectFs {
  return {
    existsSync: (path) => path in files || dirs.includes(path),
    readFileSync: (path) => {
      const content = files[path as string];
      if (content === undefined) throw new Error("ENOENT");
      return { toString: () => content };
    },
    readdirSync: (path) => dirs.filter((dir) => dir === path).flatMap(() => Object.keys(files).filter((f) => f.startsWith(path as string + "/")).map((f) => f.slice((path as string).length + 1).split("/")[0]!)),
    statSync: (path) => ({ isDirectory: () => dirs.includes(path as string) }),
  };
}

it("finds pi-subagents in the agent package directory", () => {
  const fs = fakeFs({ "/agent/npm/node_modules/pi-subagents/package.json": JSON.stringify({ name: "pi-subagents", version: "0.64.0" }) });
  assert.equal(detectPiSubagentsVersion(fs, "/agent"), "0.64.0");
});

it("finds pi-subagents under an extensions subdirectory", () => {
  const files = { "/agent/extensions/x/package.json": JSON.stringify({ name: "pi-subagents", version: "0.64.3" }) };
  const fs = fakeFs(files, ["/agent/extensions", "/agent/extensions/x"]);
  assert.equal(detectPiSubagentsVersion(fs, "/agent"), "0.64.3");
});

it("ignores other packages and returns null when absent", () => {
  const fs = fakeFs({ "/agent/npm/node_modules/other/package.json": JSON.stringify({ name: "other", version: "1.0.0" }) });
  assert.equal(detectPiSubagentsVersion(fs, "/agent"), null);
});

it("survives unreadable manifests", () => {
  const fs = fakeFs({ "/agent/npm/node_modules/pi-subagents/package.json": "{ broken" });
  assert.equal(detectPiSubagentsVersion(fs, "/agent"), null);
});
