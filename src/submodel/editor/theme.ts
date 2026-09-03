/** Theme adapter: the editor renders through this so tests use a plain identity theme. */

export type ThemeColorName = "accent" | "muted" | "success" | "error" | "warning";

export interface EditorTheme {
  fg(color: ThemeColorName, text: string): string;
  bold(text: string): string;
}

export const plainTheme: EditorTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};
