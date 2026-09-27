import { describe, expect, test } from 'bun:test';

import { ALERTS, replaceAlerts, toAside, toLabelledQuote, type AlertType } from './alerts';

const aside = (body: string) => replaceAlerts(body, toAside, 'test');

describe('replaceAlerts with toAside', () => {
  const expected: Record<AlertType, string> = {
    NOTE: ':::note[Note]',
    TIP: ':::tip[Tip]',
    IMPORTANT: ':::note[Important]',
    WARNING: ':::caution[Warning]',
    CAUTION: ':::danger[Caution]',
  };
  for (const type of Object.keys(ALERTS) as AlertType[]) {
    test(`[!${type}] becomes ${expected[type]}`, () => {
      expect(aside(`Text.\n\n> [!${type}]\n> Do this.\n> And \`that\`.\n\nAfter.`)).toBe(
        `Text.\n\n${expected[type]}\nDo this.\nAnd \`that\`.\n:::\n\nAfter.`,
      );
    });
  }

  test('the marker is case-insensitive, like on GitHub', () => {
    expect(aside('> [!warning]\n> x')).toBe(':::caution[Warning]\nx\n:::');
  });

  test('a blank quoted line inside the alert stays a paragraph break', () => {
    expect(aside('> [!NOTE]\n> one\n>\n> two')).toBe(':::note[Note]\none\n\ntwo\n:::');
  });

  test('an ordinary blockquote is left alone', () => {
    expect(aside('> just a quote\n> [!NOTE] not first')).toBe('> just a quote\n> [!NOTE] not first');
  });

  test('an alert inside a fenced code block is left alone', () => {
    const body = 'Write:\n\n```md\n> [!NOTE]\n> x\n```\n';
    expect(aside(body)).toBe(body);
  });

  test('an unknown alert type is reported, not dropped', () => {
    expect(() => aside('> [!DANGER]\n> x')).toThrow('test: unknown alert type [!DANGER]; use one of [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]');
  });

  test('text after the marker is reported (GitHub would not render it as an alert)', () => {
    expect(() => aside('> [!NOTE] inline\n> x')).toThrow(/text after \[!NOTE\]/);
  });

  test('an alert with no text is reported', () => {
    expect(() => aside('> [!NOTE]\n\nafter')).toThrow(/\[!NOTE\] has no text/);
  });
});

test('toLabelledQuote writes a blockquote that opens with the bold label', () => {
  expect(replaceAlerts('> [!CAUTION]\n> one\n>\n> two', toLabelledQuote, 'test')).toBe(
    '> **Caution**\n>\n> one\n>\n> two',
  );
});
