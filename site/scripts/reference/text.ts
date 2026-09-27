/**
 * JSDoc text to renderable blocks, for the Reference*.astro components. Pure
 * and dependency free, so the site bundle stays small.
 */

export interface TextPart {
  text: string;
  code: boolean;
}

export type TextBlock = { kind: 'p'; parts: TextPart[] } | { kind: 'ul'; items: TextPart[][] };

/** Split on backticks: `a \`b\` c` -> text, code, text. */
export function inline(text: string): TextPart[] {
  return text
    .split('`')
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((part) => part.text !== '');
}

/** Paragraphs and `- ` lists, as normalizeDoc leaves them. */
export function blocks(text: string): TextBlock[] {
  const out: TextBlock[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const lines = paragraph.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    const intro = lines.filter((line) => !/^[-*] /.test(line));
    const items = lines.filter((line) => /^[-*] /.test(line));
    if (intro.length > 0) out.push({ kind: 'p', parts: inline(intro.join(' ')) });
    if (items.length > 0) out.push({ kind: 'ul', items: items.map((item) => inline(item.slice(2))) });
  }
  return out;
}
