import { describe, expect, test } from 'bun:test';

import { escapeXml, xmlProblems } from './xml';

test('escapeXml escapes the five XML specials and drops forbidden control characters', () => {
  expect(escapeXml(`<a href="x">&'</a>\u0001\t\n`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;\t\n');
});

describe('xmlProblems', () => {
  test('accepts a well-formed document', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="urn:x" a='1'>\n  <!-- c -->\n  <e>&lt;b&gt; &amp; &#60; &#x3C;</e>\n  <l href="a?b=1&amp;c=2"/>\n  <d><![CDATA[<raw & text>]]></d>\n</feed>\n`;
    expect(xmlProblems(xml)).toEqual([]);
  });

  const bad: [string, string, RegExp][] = [
    ['a raw < in text', '<a>1 < 2</a>', /does not start a tag/],
    ['a bare &', '<a>you & me</a>', /"&" that does not start/],
    ['an unknown entity', '<a>&nbsp;</a>', /"&" that does not start/],
    ['a crossed close tag', '<a><b></a></b>', /<\/a> closes <b>/],
    ['an unclosed element', '<a><b></b>', /<a> is never closed/],
    ['an unquoted attribute', '<a x=1></a>', /malformed attribute/],
    ['a < in an attribute', '<a x="<"></a>', /malformed attribute/],
    ['a repeated attribute', '<a x="1" x="2"></a>', /repeats the attribute x/],
    ['text outside the root', '<a></a>tail', /text outside the root/],
    ['two roots', '<a></a><b></b>', /a second root element <b>/],
    ['no root', '<?xml version="1.0"?>\n', /no root element/],
  ];
  for (const [name, xml, problem] of bad) {
    test(`rejects ${name}`, () => {
      const problems = xmlProblems(xml);
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(problem);
    });
  }
});
