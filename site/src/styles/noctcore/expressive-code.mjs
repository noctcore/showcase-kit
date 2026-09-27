/* noctcore docs: Expressive Code settings for the Observatory preset.

   // ec.config.mjs
   import { defineEcConfig } from '@astrojs/starlight/expressive-code';
   import { noctcoreCodeConfig } from './src/styles/noctcore/expressive-code.mjs';

   export default defineEcConfig({
     ...noctcoreCodeConfig('observatory'),
     plugins: [],
   });

   What noctcoreCodeConfig sets, and why:
   - themes: a dark and a light theme built from the preset's --nc-code-ink and
     --nc-syn-* values. Starlight switches between them with its own theme
     picker, because one is type 'dark' and the other 'light'.
   - useStarlightUiThemeColors: true, so title bars, tabs and borders follow the
     preset through Starlight's --sl-* variables. Starlight turns this off by
     default once a site passes its own themes.
   - customizeTheme: puts the code area on the preset's --nc-code-bg. Starlight
     would otherwise use --sl-color-gray-6 in dark mode and -7 in light.
   - minSyntaxHighlightingColorContrast: 0. By default Expressive Code nudges
     token colours toward 5.5:1 against a fixed grey it uses for that sum, not
     against the real code background. These colours are checked against the
     real background instead: 4.5:1 or more, see contrast.md.
   Keep these values in step with presets/<name>.css when either changes. */
import { ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';

const SYNTAX = {
  "observatory": {
    "dark": {
      "bg": "#0f1526",
      "ink": "#d9deeb",
      "keyword": "#c1b8ff",
      "string": "#92e0e9",
      "number": "#f0c98f",
      "function": "#a6e6ee",
      "property": "#dfe4f0",
      "comment": "#8a93ad",
      "punct": "#97a0b8"
    },
    "light": {
      "bg": "#ffffff",
      "ink": "#1e2745",
      "keyword": "#4a36c4",
      "string": "#0a6873",
      "number": "#8a4b00",
      "function": "#0c4e58",
      "property": "#1e2745",
      "comment": "#5c6682",
      "punct": "#58617c"
    }
  }
};

/* TextMate scopes per token role, for the TypeScript, JavaScript, shell and
   JSON grammars the docs use. */
const SCOPES = [
  ['comment', ['comment', 'punctuation.definition.comment'], 'italic'],
  ['keyword', ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.control', 'constant.language', 'variable.language']],
  ['string', ['string', 'string.template', 'punctuation.definition.string', 'punctuation.definition.template-expression']],
  ['number', ['constant.numeric', 'constant.other']],
  ['function', ['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'entity.name.type', 'support.type', 'support.class', 'entity.name.class', 'entity.name.command']],
  ['property', ['variable.other.property', 'meta.object-literal.key', 'support.type.property-name', 'entity.other.attribute-name']],
  ['punct', ['punctuation', 'meta.brace', 'keyword.operator']],
];

function theme(preset, type) {
  const c = SYNTAX[preset][type];
  return new ExpressiveCodeTheme({
    name: `noctcore-${preset}-${type}`,
    type,
    colors: { 'editor.background': c.bg, 'editor.foreground': c.ink },
    tokenColors: SCOPES.map(([key, scope, fontStyle]) => ({
      scope,
      settings: fontStyle ? { foreground: c[key], fontStyle } : { foreground: c[key] },
    })),
  });
}

/** The dark and light themes for one preset. */
export function noctcoreCodeThemes(preset = 'observatory') {
  if (!SYNTAX[preset]) throw new Error(`Unknown noctcore preset "${preset}". Use one of: ${Object.keys(SYNTAX).join(', ')}.`);
  return [theme(preset, 'dark'), theme(preset, 'light')];
}

/** Everything ec.config.mjs needs for one preset; spread it and add the site's plugins. */
export function noctcoreCodeConfig(preset = 'observatory') {
  return {
    themes: noctcoreCodeThemes(preset),
    useStarlightUiThemeColors: true,
    minSyntaxHighlightingColorContrast: 0,
    customizeTheme(theme) {
      theme.styleOverrides.frames = {
        ...theme.styleOverrides.frames,
        editorBackground: 'var(--nc-code-bg)',
        terminalBackground: 'var(--nc-code-bg)',
        editorActiveTabBackground: 'var(--nc-code-bg)',
      };
      return theme;
    },
  };
}
