/** Cuts one block out of a gallery config, for the page to show. Pure, so the site tests import it. */

/**
 * The lines of `code` from `key: {` (or `[`) to its closing bracket at the
 * same indent, dedented. The excerpt is cut from the real file, so it cannot
 * drift from the config the script ran.
 */
export function configSection(code: string, key: string): string {
  const lines = code.split('\n');
  const start = lines.findIndex(line => new RegExp(`^\\s*${key}: [[{]$`).test(line));
  if (start === -1) throw new Error(`gallery: no "${key}:" block in the config`);
  const indent = /^\s*/.exec(lines[start] ?? '')?.[0] ?? '';
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^${indent}[\\]}],?$`).test(line));
  if (end === -1) throw new Error(`gallery: the "${key}:" block in the config never closes`);
  return lines
    .slice(start, end + 1)
    .map(line => line.slice(indent.length))
    .join('\n');
}
