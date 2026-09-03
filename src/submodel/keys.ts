/**
 * Key handling for the editor component.
 *
 * parseKey maps raw terminal input to a key id: a named id ("up", "down", "enter",
 * "escape", "tab", "backspace", "delete", "ctrl+c", ...) or, for printable input, the
 * character itself. The editor's key logic is written against these ids, which keeps it
 * testable with synthetic input and independent of any single terminal encoding.
 *
 * Parsing delegates to Pi TUI's authoritative key parser (@earendil-works/pi-tui), which
 * understands legacy CSI/SS3 sequences, CSI-u, and the full Kitty keyboard protocol
 * (event types, alternate keys, modifiers). The delegation is normalized back to the
 * editor's own key ids, plus a narrow fallback for legacy forms Pi's parser does not
 * emit ids for (ESC[1~/ESC[4~ home/end variants) and multi-byte printable characters.
 */
import { parseKey as parsePiKey } from "@earendil-works/pi-tui";

/** Editor key ids that differ from Pi TUI's ids. */
const ID_ALIASES: Record<string, string> = {
  pageUp: "pageup",
  pageDown: "pagedown",
  esc: "escape",
  space: " ",
};

/** Legacy CSI ~ finals Pi's parser does not map: ESC[1~ home, ESC[4~ end. */
const LEGACY_TILDE_CODES: Record<string, string> = {
  "1": "home",
  "4": "end",
};

function normalizeKey(key: string): string {
  return ID_ALIASES[key] ?? key;
}

/**
 * Fallback for legacy input Pi's parser leaves unparsed: the home/end tilde variants and
 * printable single code points (including multi-byte UTF-8 characters). Anything else
 * (unrecognized CSI sequences, control bytes) stays undefined, mirroring the previous
 * behavior for input the editor does not understand.
 */
function parseLegacy(data: string): string | undefined {
  const tilde = /^\x1b\[(\d+)~$/.exec(data);
  if (tilde && tilde[1] !== undefined) return LEGACY_TILDE_CODES[tilde[1]];
  if ([...data].length === 1) {
    const code = data.codePointAt(0);
    if (code !== undefined && code >= 32) return data;
  }
  return undefined;
}

/** Parse raw terminal input into a key id, or undefined when unrecognized. */
export function parseKey(data: string): string | undefined {
  const key = parsePiKey(data);
  if (key !== undefined) return normalizeKey(key);
  return parseLegacy(data);
}
