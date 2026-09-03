# 05: Verify compatibility and package the release

**What to build:** Turn the completed model editor into a release-ready package with an explicit Pi API baseline and verified compatibility with `nicobailon/pi-subagents` 0.64.x. A clean installation must open the TUI, persist a representative policy, and explain how to reload and verify the live mapping.

**Blocked by:** 04: Configure thinking and fallback routes.

**Status:** resolved

- [x] Package metadata declares the Pi extension entry point and the Pi API compatibility range verified during implementation.
- [x] Documentation states that the first release targets `nicobailon/pi-subagents` 0.64.x.
- [x] Documentation explains installation, `/submodel`, keyboard controls, native settings ownership, Inherit, thinking, fallback ordering, `/reload`, and `/subagents-models`.
- [x] Documentation states that project settings, session overrides, `tintinweb/pi-subagents`, provider management, and runtime request interception are unsupported.
- [x] A compatibility fixture representative of `pi-subagents` 0.64.x passes the command-level configuration flow.
- [x] A real Pi TUI smoke check verifies opening the command, selecting a primary model, adding a fallback, saving, reloading, and observing the native live mapping.
- [x] The smoke check confirms the parent session model does not change.
- [x] Type checking and the full automated test suite pass.
- [x] The package dry-run contains only release files and excludes the throwaway prototype, scratch issues, local state, credentials, and development artifacts.
- [x] A clean local package installation exposes `/submodel` without requiring source checkout paths.
- [x] Unsupported or incompatible environments fail with a clear message instead of silently writing settings.

## Comments

- Package metadata: `package.json` declares the Pi extension entry point and pins `@earendil-works/pi-coding-agent` peer `>=0.84.4 <1` (optional peer so hosts resolve it themselves).
- Compatibility fixture: `test/compat-fixture.test.ts` drives a representative pi-subagents 0.64 settings document (managed + documented unowned fields) through the full flow; all unowned settings survive byte-for-byte semantically.
- Real Pi TUI smoke (sandboxed `PI_CODING_AGENT_DIR`, Pi 0.84.4, real `nicobailon/pi-subagents` 0.64.0): `pi install` + `pi list` register the extension; `/submodel` opens the two-pane editor with the fixture policy; worker primary-model selector works (unavailable configured value retained and marked); save writes the file and shows "Saved to … / Run /reload, then /subagents-models" notifications; native `/subagents-models` renders the live mapping; the parent session model is never touched.
- Clean package installation: `npm pack` tarball unpacked and installed via `pi install <dir>` exposes `/submodel` with no source checkout path. Note: `pi install <file>.tgz` records the raw tarball path and Pi cannot load it — install from the unpacked directory or `npm:` after publishing.
- Compatibility bug found and fixed by the smoke: Pi 0.84.4 does not re-export `getSettingsPath` through its package entry; the adapter now falls back to `join(getAgentDir(), "settings.json")`.
- `npm pack --dry-run`: 16 files, only src/, README, LICENSE, CONTEXT.md, package.json — prototype, .scratch, and dev artifacts excluded. Typecheck clean; full suite 64/64 passing.
