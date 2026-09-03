/** ANSI-aware width helpers: rendered lines must never exceed the given columns. */

const ANSI_TOKEN = /\x1b\[[0-9;]*[A-Za-z]/g;

/** Split a string into ANSI escape tokens and visible characters. */
function tokenize(line: string): Array<{ ansi: boolean; text: string }> {
  const tokens: Array<{ ansi: boolean; text: string }> = [];
  let last = 0;
  for (const match of line.matchAll(ANSI_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ ansi: false, text: line.slice(last, index) });
    tokens.push({ ansi: true, text: match[0] });
    last = index + match[0].length;
  }
  if (last < line.length) tokens.push({ ansi: false, text: line.slice(last) });
  return tokens;
}

export function visibleWidth(line: string): number {
  let width = 0;
  for (const token of tokenize(line)) {
    if (!token.ansi) width += [...token.text].length;
  }
  return width;
}

/** Truncate to at most `width` visible columns, preserving escape sequences before the cut. */
export function truncateAnsi(line: string, width: number): string {
  if (visibleWidth(line) <= width) return line;
  let out = "";
  let used = 0;
  for (const token of tokenize(line)) {
    if (token.ansi) {
      out += token.text;
      continue;
    }
    for (const ch of token.text) {
      if (used >= width) return out;
      out += ch;
      used += 1;
    }
  }
  return out;
}

/** Pad with spaces to exactly `width` visible columns. */
export function padEndAnsi(line: string, width: number): string {
  const missing = width - visibleWidth(line);
  return missing <= 0 ? truncateAnsi(line, width) : line + " ".repeat(missing);
}
