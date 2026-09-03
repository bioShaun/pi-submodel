/**
 * Key handling for the editor component.
 *
 * parseKey maps raw terminal input to a key id: a named id ("up", "down", "enter",
 * "escape", "tab", "backspace", "delete", "ctrl+c", ...) or, for printable input, the
 * character itself. The editor's key logic is written against these ids, which keeps it
 * testable with synthetic input and independent of any single terminal encoding.
 */

const CSI_CODES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
};

const CSI_TILDE_CODES: Record<string, string> = {
  "1": "home",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
};

const CTRL_CODES: Record<number, string> = {
  3: "ctrl+c",
  9: "tab",
};

/** Parse raw terminal input into a key id, or undefined when unrecognized. */
export function parseKey(data: string): string | undefined {
  if (data.length === 0) return undefined;

  if (data === "\x1b") return "escape";
  if (data === "\r" || data === "\n") return "enter";
  if (data === "\x7f" || data === "\x08") return "backspace";

  // Kitty / CSI-u form: ESC [ <code> [; <modifiers> [: <event>]] u
  const csiU = /^\x1b\[(\d+)(?:;\d+(?::\d+)*)u$/.exec(data);
  if (csiU) {
    const code = Number(csiU[1]);
    if (code === 13 || code === 27) return code === 13 ? "enter" : "escape";
    if (code >= 32 && code < 127) return String.fromCharCode(code);
    return undefined;
  }

  if (data.startsWith("\x1b[")) {
    // CSI ~ finals (navigation/edit keys): ESC [ <param> ~
    const tilde = /^\x1b\[(\d+)~$/.exec(data);
    if (tilde && tilde[1] !== undefined) {
      return CSI_TILDE_CODES[tilde[1]];
    }
    // CSI letter finals (arrows/home/end), possibly with parameters: ESC [ 1 ; 5 A
    const letter = /^\x1b\[[0-9;]*([A-Za-z])$/.exec(data);
    if (letter && letter[1] !== undefined) {
      return CSI_CODES[letter[1]];
    }
    return undefined;
  }

  if (data === "\x1bO" || (data.startsWith("\x1bO") && data.length === 3)) {
    const final = data[2];
    return final !== undefined ? CSI_CODES[final] : undefined;
  }

  const ctrl = CTRL_CODES[data.charCodeAt(0)];
  if (data.length === 1 && ctrl) return ctrl;

  if (data.length === 1) {
    const code = data.charCodeAt(0);
    if (code >= 32) return data;
    return undefined;
  }

  // Multi-byte printable input (e.g. a decoded UTF-8 char arrives as one event).
  const firstCode = data.codePointAt(0);
  if ([...data].length === 1 && firstCode !== undefined && firstCode >= 32) {
    return data;
  }
  return undefined;
}
