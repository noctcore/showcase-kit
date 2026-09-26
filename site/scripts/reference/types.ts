/**
 * The shapes of the generated reference data in src/generated/reference-*.json.
 * scripts/gen/reference.ts writes them; the Reference*.astro components read
 * them. Nothing in these files is typed by hand.
 */

/** The two families of config: web (url and cdp targets) and tty. */
export type ConfigMode = 'web' | 'tty';

/** A default as the source states it: a literal value (checked against resolveConfig) or prose. */
export type ConfigDefault = { kind: 'literal'; text: string } | { kind: 'prose'; text: string };

export interface ConfigRow {
  key: string;
  /** Dotted path from the config root, arrays as `[]`: `outputs.portfolio.size`, `clips[].fps`. */
  path: string;
  /** The type as written in the source. */
  type: string;
  /** What a local type alias in `type` stands for, when `type` is just that alias (or an array of it). */
  typeExpanded?: string;
  required: boolean;
  description: string;
  default?: ConfigDefault;
  /** The modes whose validator accepts this key. */
  modes: ConfigMode[];
  /** Fragment of the heading over the table(s) that document this key's own fields or forms. */
  link?: string;
}

export interface ConfigForm {
  /** The form's type as written. */
  type: string;
  description: string;
  /** The keys of an object form (`?` marks an optional one); `null` for a non-object form. */
  fields: { key: string; required: boolean; description: string; default?: ConfigDefault }[] | null;
}

export interface ConfigTable {
  /** Unique id, used by `<ReferenceConfigTable id>`. */
  id: string;
  /** Dotted path of the key the table documents; `''` for the top level. */
  path: string;
  /** True when the key holds an array of these objects (`shots`, `clips`, `clips[].steps`). */
  array: boolean;
  /** Set when one path has several tables, one per target mode: `url mode`. */
  variant?: string;
  /** The contract section (h2 id) the table belongs under. */
  section: string;
  /** The h3 the table sits under, or undefined when it sits right under its section's h2. */
  heading?: string;
  /** The fragment of the heading the table sits under. */
  anchor: string;
  /** The modes this table is reached from. */
  modes: ConfigMode[];
  /** JSDoc of the interface or type alias, if it has one. */
  description?: string;
  kind: 'fields' | 'forms';
  rows: ConfigRow[];
  forms: ConfigForm[];
}

/** A key the validator refuses in one mode with a message of its own, instead of "unknown key". */
export interface ModeError {
  path: string;
  /** The fixture the key was tried in: `url`, `cdp` or `tty`. */
  in: string;
  message: string;
}

export interface PathTemplate {
  path: string;
  modes: ConfigMode[];
  /** Tokens the validator accepts. Empty when the value is not checked as a path template. */
  allowed: string[];
  /** Tokens the validator requires with one language. */
  required: string[];
  /** Tokens it requires once there is more than one language. */
  requiredMultiLang: string[];
  /** Endings it accepts; empty when any ending is fine. */
  extensions: string[];
  /** The tokens the key's JSDoc names. */
  docTokens: string[];
  /** False when the validator does not check tokens here (the tokens are filled later). */
  validated: boolean;
}

export interface ConfigReference {
  tables: ConfigTable[];
  modeErrors: ModeError[];
  templates: PathTemplate[];
}

export interface CliOption {
  /** Long name without dashes: `config`. */
  name: string;
  short?: string;
  /** Placeholder from the help text: `<file>`. */
  arg?: string;
  type: 'string' | 'boolean';
  description: string;
  /** Commands that read the option; `global` options apply before any command runs. */
  commands: string[];
  global: boolean;
  /** Prints something and exits before any command runs (`--help`, `--version`). */
  exits: boolean;
}

export interface CliCommand {
  name: string;
  summary: string;
  usage: string;
  /** Options the command reads, global ones included. */
  options: string[];
  /** Whether the command loads a config file. */
  loadsConfig: boolean;
}

export interface CliReference {
  usage: string;
  /** The line after the options in `--help`. */
  note: string;
  commands: CliCommand[];
  options: CliOption[];
}

export type ApiGroup = 'config' | 'pipeline' | 'outputs' | 'terminal' | 'encoding' | 'errors' | 'types';

export interface ApiExport {
  name: string;
  kind: 'function' | 'const' | 'class' | 'interface' | 'type';
  /** True for a value you can import at runtime; false for a type-only export. */
  runtime: boolean;
  group: ApiGroup;
  /** Source file, relative to the repo root. */
  source: string;
  summary: string;
  signature: string;
}

export interface ApiReference {
  exports: ApiExport[];
}
