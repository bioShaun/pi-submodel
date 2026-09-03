/**
 * Locate an installed pi-subagents and report its version, or null when not found.
 *
 * The search mirrors where the Pi package manager puts packages: the agent package
 * directory (npm/node_modules) first, then any directory under agentDir/extensions.
 * The fs operations are injectable so the walk is unit-testable.
 */

import { join } from "node:path";

export interface DetectFs {
  existsSync(path: string): boolean;
  readFileSync(path: string): { toString(): string };
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
}

export function detectPiSubagentsVersion(fs: DetectFs, agentDir: string): string | null {
  const candidates: string[] = [join(agentDir, "npm", "node_modules", "pi-subagents", "package.json")];
  const extensionsDir = join(agentDir, "extensions");
  try {
    if (fs.existsSync(extensionsDir)) {
      for (const name of fs.readdirSync(extensionsDir)) {
        const entry = join(extensionsDir, name);
        try {
          if (fs.statSync(entry).isDirectory()) candidates.push(join(entry, "package.json"));
        } catch {
          // unreadable entry — skip it
        }
      }
    }
  } catch {
    // unreadable extensions dir — fall through
  }
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const manifest = JSON.parse(fs.readFileSync(candidate).toString()) as { name?: string; version?: string };
      if (manifest.name === "pi-subagents" && typeof manifest.version === "string") {
        return manifest.version;
      }
    } catch {
      // unreadable manifest — try the next candidate
    }
  }
  return null;
}
