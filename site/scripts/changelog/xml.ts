/**
 * Just enough XML for the feed: escaping text, and a well-formedness check the
 * post-build check can run anywhere (xmllint is not on Windows).
 */

/** Escape text for an XML element or a double-quoted attribute, dropping characters XML 1.0 forbids. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const NAME = '[A-Za-z_][\\w.:-]*';
const REFERENCE = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);/y;
const ATTRIBUTE = new RegExp(`\\s+(${NAME})\\s*=\\s*("[^"<]*"|'[^'<]*')`, 'y');

/** Every `&` in `text` starts a reference XML defines. */
function badAmpersand(text: string): boolean {
  for (let i = text.indexOf('&'); i !== -1; i = text.indexOf('&', i + 1)) {
    REFERENCE.lastIndex = i;
    if (!REFERENCE.test(text)) return true;
  }
  return false;
}

/**
 * Problems that make `xml` not well-formed, empty when it is. Covers what a
 * generated feed can get wrong: unbalanced or crossed tags, unquoted or
 * repeated attributes, a raw `<` or `&`, text outside the root, a second root.
 * No DTDs (a feed has none).
 */
export function xmlProblems(xml: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  let roots = 0;
  let i = 0;
  const lineAt = (at: number) => xml.slice(0, at).split('\n').length;
  const problem = (at: number, message: string) => problems.push(`line ${String(lineAt(at))}: ${message}`);

  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end === -1) return ['line 1: the XML declaration is not closed'];
    i = end + 2;
  }

  while (i < xml.length && problems.length === 0) {
    const lt = xml.indexOf('<', i);
    const text = xml.slice(i, lt === -1 ? xml.length : lt);
    if (text.includes(']]>')) problem(i, '"]]>" in text');
    if (badAmpersand(text)) problem(i, 'an "&" that does not start an entity or character reference');
    if (stack.length === 0 && text.trim() !== '') problem(i, 'text outside the root element');
    if (lt === -1) break;
    i = lt;

    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      if (end === -1) problem(i, 'a comment that is not closed');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i);
      if (end === -1 || stack.length === 0) problem(i, 'a CDATA section outside an element or not closed');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i);
      if (end === -1) problem(i, 'a processing instruction that is not closed');
      i = end + 2;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      problem(i, 'a DTD or declaration (not supported here)');
      break;
    }

    const close = new RegExp(`</(${NAME})\\s*>`, 'y');
    close.lastIndex = i;
    const closing = close.exec(xml);
    if (closing) {
      const open = stack.pop();
      if (open !== closing[1]) problem(i, `</${closing[1]!}> closes ${open ? `<${open}>` : 'nothing'}`);
      i = close.lastIndex;
      continue;
    }

    const start = new RegExp(`<(${NAME})`, 'y');
    start.lastIndex = i;
    const opening = start.exec(xml);
    if (!opening) {
      problem(i, 'a "<" that does not start a tag');
      break;
    }
    const name = opening[1]!;
    let at = start.lastIndex;
    const seen = new Set<string>();
    for (;;) {
      ATTRIBUTE.lastIndex = at;
      const attribute = ATTRIBUTE.exec(xml);
      if (!attribute) break;
      if (seen.has(attribute[1]!)) problem(at, `<${name}> repeats the attribute ${attribute[1]!}`);
      seen.add(attribute[1]!);
      if (badAmpersand(attribute[2]!)) problem(at, `<${name} ${attribute[1]!}> has an "&" that is not a reference`);
      at = ATTRIBUTE.lastIndex;
    }
    const end = /\s*(\/?)>/y;
    end.lastIndex = at;
    const ending = end.exec(xml);
    if (!ending) {
      problem(at, `<${name}> has a malformed attribute or is not closed`);
      break;
    }
    if (stack.length === 0) roots++;
    if (roots > 1 && stack.length === 0) problem(i, `a second root element <${name}>`);
    if (ending[1] !== '/') stack.push(name);
    i = end.lastIndex;
  }

  if (problems.length === 0 && stack.length > 0) problems.push(`<${stack.at(-1)!}> is never closed`);
  if (problems.length === 0 && roots === 0) problems.push('no root element');
  return problems;
}
