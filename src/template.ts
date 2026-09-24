import { ShowcaseError } from './errors.js';

const TOKEN = /\{(\w+)\}/g;

/** The `{token}` names a template uses. */
export function templateTokens(template: string): string[] {
  return [...template.matchAll(TOKEN)].map(match => match[1] ?? '');
}

/** Replace every `{token}`. Unknown tokens throw rather than leaking braces into file names. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(TOKEN, (whole, token: string) => {
    const value = values[token];
    if (value === undefined) {
      throw new ShowcaseError(`Unknown token ${whole} in "${template}"`);
    }
    return value;
  });
}
