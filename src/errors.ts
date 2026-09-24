/** An error with a message meant for the person running the CLI: printed without a stack trace. */
export class ShowcaseError extends Error {
  override name = 'ShowcaseError';
}

export class ConfigError extends ShowcaseError {
  override name = 'ConfigError';

  constructor(
    readonly issues: string[],
    source?: string,
  ) {
    super(
      `Invalid showcase config${source ? ` (${source})` : ''}:\n${issues.map(issue => `  - ${issue}`).join('\n')}`,
    );
  }
}
