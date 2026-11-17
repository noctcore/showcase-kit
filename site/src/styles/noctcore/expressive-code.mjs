/* noctcore docs: Expressive Code settings for the Blueprint preset.

   // ec.config.mjs
   import { defineEcConfig } from '@astrojs/starlight/expressive-code';
   import { noctcoreCodeConfig } from './src/styles/noctcore/expressive-code.mjs';

   export default defineEcConfig({
     ...noctcoreCodeConfig('blueprint'),
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
   - styleOverrides: the code in JetBrains Mono and the frame titles in DM Mono,
     hairline borders, no shadow, and a plain tab bar: the file name sits on
     the code background over a soft rule, without Starlight's top indicator.
   - minSyntaxHighlightingColorContrast: 0. By default Expressive Code nudges
     token colours toward 5.5:1 against a fixed grey it uses for that sum, not
     against the real code background. These colours are checked against the
     real background instead: 4.5:1 or more, see contrast.md.
   Keep these values in step with presets/<name>.css when either changes. */
import { ExpressiveCodeTheme } from '@astrojs/starlight/expressive-code';

const SYNTAX = {
  "blueprint": {
    "dark": {
      "bg": "#101924",
      "ink": "#c4cfda",
      "keyword": "#aac8e2",
      "string": "#f0f3f6",
      "number": "#e3ecf5",
      "function": "#d3e3f1",
      "property": "#c4cfda",
      "comment": "#8a9aab",
      "punct": "#95a5b5"
    },
    "light": {
      "bg": "#ecebe6",
      "ink": "#3d4a58",
      "keyword": "#355e87",
      "string": "#17212d",
      "number": "#202b39",
      "function": "#234567",
      "property": "#3d4a58",
      "comment": "#5f6b77",
      "punct": "#596773"
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
export function noctcoreCodeThemes(preset = 'blueprint') {
  if (!SYNTAX[preset]) throw new Error(`Unknown noctcore preset "${preset}". Use one of: ${Object.keys(SYNTAX).join(', ')}.`);
  return [theme(preset, 'dark'), theme(preset, 'light')];
}

/** Everything ec.config.mjs needs for one preset; spread it and add the site's plugins. */
export function noctcoreCodeConfig(preset = 'blueprint') {
  return {
    themes: noctcoreCodeThemes(preset),
    useStarlightUiThemeColors: true,
    minSyntaxHighlightingColorContrast: 0,
    styleOverrides: {
      codeFontFamily: 'var(--nc-font-mono)',
      uiFontFamily: 'var(--nc-font-label)',
      codeFontSize: '0.84rem',
      codeLineHeight: '1.75',
      borderColor: 'var(--nc-line)',
      borderRadius: 'var(--nc-radius)',
      frames: {
        frameBoxShadowCssValue: 'none',
        editorTabBarBackground: 'var(--nc-code-bg)',
        editorTabBarBorderBottomColor: 'var(--nc-line-soft)',
        editorActiveTabForeground: 'var(--nc-muted)',
        editorActiveTabIndicatorTopColor: 'transparent',
        editorActiveTabIndicatorBottomColor: 'transparent',
        editorActiveTabBorderColor: 'transparent',
        terminalTitlebarBackground: 'var(--nc-code-bg)',
        terminalTitlebarForeground: 'var(--nc-muted)',
        terminalTitlebarBorderBottomColor: 'var(--nc-line-soft)',
        terminalTitlebarDotsOpacity: '0.35',
        inlineButtonBorder: 'var(--nc-line)',
        tooltipSuccessBackground: 'var(--nc-accent)',
        tooltipSuccessForeground: 'var(--nc-on-link)',
      },
    },
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
