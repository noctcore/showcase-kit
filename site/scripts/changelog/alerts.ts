/**
 * GitHub alerts inside changelog entries. An entry that needs action from a
 * user carries a blockquote whose first line is an alert marker:
 *
 *   > [!WARNING]
 *   > Configs that repeat the base path must drop it.
 *
 * GitHub renders it as a callout in CHANGELOG.md; the site renders it as the
 * matching Starlight aside, and the feed as a labelled blockquote. See
 * .changeset/README.md for the convention.
 */

export type AlertType = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

/** Each GitHub alert, the Starlight aside it becomes and its label. */
export const ALERTS: Readonly<Record<AlertType, { aside: 'note' | 'tip' | 'caution' | 'danger'; label: string }>> = {
  NOTE: { aside: 'note', label: 'Note' },
  TIP: { aside: 'tip', label: 'Tip' },
  IMPORTANT: { aside: 'note', label: 'Important' },
  WARNING: { aside: 'caution', label: 'Warning' },
  CAUTION: { aside: 'danger', label: 'Caution' },
};

export interface Alert {
  type: AlertType;
  /** The alert's content, without the `>` markers. */
  lines: string[];
}

const MARKER = /^>[ \t]*\[!([A-Za-z]+)\](.*)$/;

function isAlertType(value: string): value is AlertType {
  return Object.hasOwn(ALERTS, value);
}

/**
 * Replace every alert in a Markdown body with what `render` returns for it.
 * An unknown type (`[!DANGER]`) or text after the marker throws: GitHub would
 * show either as a plain quote, so the site must not guess.
 */
export function replaceAlerts(body: string, render: (alert: Alert) => string[], where: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  /** The fence that opened the code block we are in, if any. */
  let fence: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]!)?.[1];
    if (opener && (!fence || (opener[0] === fence[0] && opener.length >= fence.length))) {
      fence = fence ? undefined : opener;
    }
    // Only the first line of a blockquote can be an alert marker.
    const startsQuote = i === 0 || !lines[i - 1]!.startsWith('>');
    const marker = fence || !startsQuote ? null : MARKER.exec(lines[i]!);
    if (!marker) {
      out.push(lines[i]!);
      continue;
    }
    const type = marker[1]!.toUpperCase();
    if (!isAlertType(type)) {
      throw new Error(
        `${where}: unknown alert type [!${marker[1]!}]; use one of ${Object.keys(ALERTS)
          .map((t) => `[!${t}]`)
          .join(', ')}`,
      );
    }
    if (marker[2]!.trim() !== '') {
      throw new Error(`${where}: text after [!${marker[1]!}]; put the alert's text on the next line, after "> "`);
    }
    const content: string[] = [];
    while (i + 1 < lines.length && lines[i + 1]!.startsWith('>')) {
      i++;
      content.push(lines[i]!.replace(/^> ?/, ''));
    }
    if (content.every((line) => line.trim() === '')) throw new Error(`${where}: [!${type}] has no text`);
    out.push(...render({ type, lines: content }));
  }
  return out.join('\n');
}

/** A Starlight aside: `:::caution[Warning]` ... `:::`. */
export function toAside(alert: Alert): string[] {
  const { aside, label } = ALERTS[alert.type];
  return [`:::${aside}[${label}]`, ...alert.lines, ':::'];
}

/** A blockquote that opens with the alert's label in bold, for the feed. */
export function toLabelledQuote(alert: Alert): string[] {
  return [`> **${ALERTS[alert.type].label}**`, '>', ...alert.lines.map((line) => (line === '' ? '>' : `> ${line}`))];
}
