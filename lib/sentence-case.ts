// Status words are stored lowercase ("published", "draft", "merged") because
// they are data. On screen every label is sentence case (docs/DESIGN-LANGUAGE.md
// section 7), so chips that print one of them go through this.
export function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
