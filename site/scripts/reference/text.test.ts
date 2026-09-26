import { describe, expect, test } from 'bun:test';

import { parseLiteral } from './literal';
import { oneLine, normalizeDoc } from './source';
import { blocks, inline } from './text';
import { slug } from './config-types';

describe('JSDoc text', () => {
  test('inline code spans', () => {
    expect(inline('Tokens: `{lang}` and `{id}`.')).toEqual([
      { text: 'Tokens: ', code: false },
      { text: '{lang}', code: true },
      { text: ' and ', code: false },
      { text: '{id}', code: true },
      { text: '.', code: false },
    ]);
  });

  test('paragraphs and lists', () => {
    expect(blocks('How to reach a shot.\n\n- A string.\n- A function.')).toEqual([
      { kind: 'p', parts: [{ text: 'How to reach a shot.', code: false }] },
      { kind: 'ul', items: [[{ text: 'A string.', code: false }], [{ text: 'A function.', code: false }]] },
    ]);
  });

  test('normalizeDoc joins wrapped lines and keeps list items apart', () => {
    expect(normalizeDoc('One\ntwo.\n\n- a\n  b\n- c')).toBe('One two.\n\n- a b\n- c');
  });

  test('oneLine collapses printed types', () => {
    expect(oneLine('{\n    width: number;\n    height: number;\n}')).toBe('{ width: number; height: number }');
    expect(oneLine('[\n  number,\n  number\n]')).toBe('[number, number]');
  });

  test('slugs match the headings Starlight renders', () => {
    expect(slug('frame.background')).toBe('framebackground');
    expect(slug('clips[].steps')).toBe('clipssteps');
    expect(slug('target in url mode')).toBe('target-in-url-mode');
  });
});

describe('parseLiteral', () => {
  test('reads the literal forms defaults use', () => {
    expect(parseLiteral('120')).toBe(120);
    expect(parseLiteral('-360')).toBe(-360);
    expect(parseLiteral('1.32')).toBe(1.32);
    expect(parseLiteral("'q'")).toBe('q');
    expect(parseLiteral('true')).toBe(true);
    expect(parseLiteral("['webp', 'gif']")).toEqual(['webp', 'gif']);
    expect(parseLiteral('{ width: 1440, height: 900 }')).toEqual({ width: 1440, height: 900 });
  });

  test('refuses anything that is not a literal', () => {
    expect(() => parseLiteral('the config root')).toThrow();
    expect(() => parseLiteral('DEFAULT_RAW')).toThrow();
    expect(() => parseLiteral('1 + 1')).toThrow();
  });
});
