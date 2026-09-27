import type { ResolvedBackground, ResolvedFrame } from '../config/types.js';

/** Title bar height per style, in CSS pixels at scale 1. */
export const BAR_HEIGHT: Record<ResolvedFrame['style'], number> = {
  window: 40,
  minimal: 28,
  none: 0,
  browser: 44,
  windows: 32,
  terminal: 34,
};

const THEMES = {
  dark: {
    bar: '#1f2430',
    border: 'rgba(255,255,255,0.06)',
    title: 'rgba(255,255,255,0.62)',
    outline: 'rgba(255,255,255,0.10)',
    field: 'rgba(255,255,255,0.08)',
    windows: '#202020',
    terminal: '#16181d',
  },
  light: {
    bar: '#eceef2',
    border: 'rgba(0,0,0,0.08)',
    title: 'rgba(0,0,0,0.55)',
    outline: 'rgba(0,0,0,0.12)',
    field: '#ffffff',
    windows: '#f3f3f3',
    terminal: '#e7e9ee',
  },
} as const;

const SANS = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];

export interface FrameLayout {
  /** Canvas size in CSS pixels; the page viewport. */
  canvas: { width: number; height: number };
  /** Displayed screenshot size in CSS pixels. */
  image: { width: number; height: number };
  /** Multiplier for the chrome (bar, radius, lights, shadow), so a shrunken window keeps its proportions. */
  scale: number;
}

/** The natural size of a framed window around a screenshot shown at `image` CSS pixels. */
export function windowSize(frame: ResolvedFrame, image: { width: number; height: number }): { width: number; height: number } {
  return { width: image.width, height: image.height + BAR_HEIGHT[frame.style] };
}

/** README layout: the window at its natural size with `frame.padding` on every side. */
export function readmeLayout(frame: ResolvedFrame, image: { width: number; height: number }): FrameLayout {
  const window = windowSize(frame, image);
  return {
    canvas: { width: window.width + frame.padding * 2, height: window.height + frame.padding * 2 },
    image,
    scale: 1,
  };
}

/**
 * Fixed-canvas layout (portfolio): the window scaled to fit inside `canvas` minus `padding`, aspect kept.
 * Nothing is cropped; the background fills whatever the window does not.
 */
export function containLayout(
  frame: ResolvedFrame,
  image: { width: number; height: number },
  canvas: { width: number; height: number },
  padding: number,
): FrameLayout {
  const window = windowSize(frame, image);
  const scale = Math.min((canvas.width - padding * 2) / window.width, (canvas.height - padding * 2) / window.height);
  return { canvas, image: { width: image.width * scale, height: image.height * scale }, scale };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => `&#${String(char.charCodeAt(0))};`);
}

/** Where each mesh color after the first glows from: top left, top right, bottom right, bottom left. */
const MESH_CORNERS = ['0% 0%', '100% 0%', '100% 100%', '0% 100%'];

/**
 * A tile of grey film grain. `feTurbulence` with a fixed seed draws the same pixels on every run. The SVG uses double
 * quotes only, which `encodeURIComponent` escapes, so the URL is safe inside `url('...')` in a style attribute.
 */
function grain(amount: number): string {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">' +
    '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" stitchTiles="stitch"/>' +
    '<feColorMatrix type="saturate" values="0"/></filter>' +
    `<rect width="100%" height="100%" filter="url(#n)" opacity="${String(amount)}"/></svg>`;
  return `url('data:image/svg+xml,${encodeURIComponent(svg)}') 0 0 / 240px 240px`;
}

export function backgroundCss(background: ResolvedBackground): string {
  switch (background.type) {
    case 'solid':
      return background.color;
    case 'gradient':
      return `linear-gradient(${String(background.angle)}deg, ${background.from}, ${background.to})`;
    case 'transparent':
      return 'transparent';
    case 'mesh': {
      const [base, ...glows] = background.colors;
      const layers = glows.map((glow, index) => `radial-gradient(at ${MESH_CORNERS[index] ?? '50% 50%'}, ${glow} 0%, transparent 62%)`);
      return [...layers, base].join(', ');
    }
    case 'dots': {
      const tile = px(background.spacing);
      return `radial-gradient(circle, ${background.dot} 1.25px, transparent 1.75px) 0 0 / ${tile} ${tile}, ${background.color}`;
    }
    case 'noise':
      return `${grain(background.amount)}, linear-gradient(${String(background.angle)}deg, ${background.from}, ${background.to})`;
  }
}

const px = (value: number): string => `${String(Math.round(value * 1000) / 1000)}px`;

/** A small line icon as inline SVG, `size` CSS pixels square, drawn in a 10 unit box. */
function icon(path: string, size: number, color: string, width = 1): string {
  return (
    `<svg width="${px(size)}" height="${px(size)}" viewBox="0 0 10 10" style="display:block;flex:none">` +
    `<path d="${path}" fill="none" stroke="${color}" stroke-width="${String(width)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

const ICONS = {
  back: 'M6.5 1.5 3 5l3.5 3.5',
  forward: 'M3.5 1.5 7 5 3.5 8.5',
  reload: 'M8.2 3.6A3.6 3.6 0 1 0 8.6 5.6M8.4 1.4v2.4H6',
  lock: 'M2.6 4.6h4.8v4H2.6zM3.6 4.6V3.2a1.4 1.4 0 0 1 2.8 0v1.4',
  minimize: 'M2 5h6',
  maximize: 'M2.2 2.2h5.6v5.6H2.2z',
  close: 'M2.2 2.2l5.6 5.6M7.8 2.2 2.2 7.8',
  prompt: 'M1.5 2.5 4.5 5l-3 2.5M5.5 8h3',
};

/**
 * One framed window as self-contained markup (inline styles only), so a page can hold several at different
 * scales. `extraStyle` goes on the outer element, for positioning and transforms. Without `imageSrc` the screenshot
 * is an empty `#hole` with nothing painted behind it, for clips that composite their frames in later. `address` is the
 * address bar text of the `browser` style, and `barColor` replaces the `terminal` style's bar color (tty mode passes
 * the terminal background).
 */
export function windowMarkup({
  frame,
  image,
  scale: s,
  imageSrc,
  title,
  address,
  barColor,
  extraStyle = '',
}: {
  frame: ResolvedFrame;
  image: { width: number; height: number };
  scale: number;
  imageSrc: string | undefined;
  title: string | undefined;
  address?: string | undefined;
  barColor?: string | undefined;
  extraStyle?: string;
}): string {
  const theme = THEMES[frame.theme];
  const hairline = px(Math.max(1, s));
  const shadow = frame.shadow
    ? `0 ${px(24 * s)} ${px(64 * s)} rgba(0,0,0,0.35), 0 ${px(8 * s)} ${px(24 * s)} rgba(0,0,0,0.22)`
    : 'none';
  const barBackground =
    frame.style === 'windows' ? theme.windows : frame.style === 'terminal' ? (barColor ?? theme.terminal) : theme.bar;
  const bar = frame.style === 'none' ? '' : barMarkup(frame, { s, theme, hairline, title, address, background: barBackground });
  // The outline sits on top of the screenshot so light apps keep an edge on light backgrounds.
  const outline =
    `<div style="position:absolute;inset:0;border-radius:inherit;pointer-events:none;` +
    `box-shadow:inset 0 0 0 ${hairline} ${theme.outline}"></div>`;
  const size = `display:block;width:${px(image.width)};height:${px(image.height)}`;
  const media = imageSrc === undefined ? `<div id="hole" style="${size}"></div>` : `<img src="${imageSrc}" alt="" style="${size}">`;
  return (
    `<div class="window" style="position:relative;overflow:hidden;flex:none;width:${px(image.width)};` +
    `border-radius:${px(frame.radius * s)};background:${imageSrc === undefined ? 'transparent' : barBackground};box-shadow:${shadow};${extraStyle}">` +
    `${bar}${media}` +
    `${outline}</div>`
  );
}

/** The title bar of every style but `none`. */
function barMarkup(
  frame: ResolvedFrame,
  {
    s,
    theme,
    hairline,
    title,
    address,
    background,
  }: {
    s: number;
    theme: (typeof THEMES)[keyof typeof THEMES];
    hairline: string;
    title: string | undefined;
    address: string | undefined;
    background: string;
  },
): string {
  const style = frame.style;
  const lights = (size: number): string =>
    `<div style="display:flex;gap:${px(8 * s)};padding-left:${px(14 * s)};position:relative;z-index:1">${LIGHTS.map(
      color => `<i style="display:block;width:${px(size * s)};height:${px(size * s)};border-radius:50%;background:${color}"></i>`,
    ).join('')}</div>`;
  const centered = (inner: string, font: string): string =>
    `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;` +
    `font:${font};color:${theme.title};white-space:nowrap">${inner}</div>`;
  const border = style === 'terminal' ? '' : `;border-bottom:${hairline} solid ${theme.border}`;
  let inner: string;
  if (style === 'window' || style === 'minimal') {
    inner =
      (style === 'window' ? lights(12) : '') + (title ? centered(escapeHtml(title), `500 ${px(13 * s)}/1 ${SANS}`) : '');
  } else if (style === 'browser') {
    const arrows =
      `<div style="display:flex;gap:${px(14 * s)};padding-left:${px(22 * s)};position:relative;z-index:1">` +
      [ICONS.back, ICONS.forward, ICONS.reload].map(path => icon(path, 14 * s, theme.title, 1.1)).join('') +
      '</div>';
    const field =
      `<div style="display:flex;align-items:center;justify-content:center;gap:${px(6 * s)};box-sizing:border-box;` +
      `width:52%;height:${px(28 * s)};padding:0 ${px(12 * s)};border-radius:${px(8 * s)};background:${theme.field};` +
      `box-shadow:inset 0 0 0 ${hairline} ${theme.border}">` +
      `${icon(ICONS.lock, 11 * s, theme.title, 1.1)}` +
      `<span style="overflow:hidden;text-overflow:ellipsis">${escapeHtml(address ?? '')}</span></div>`;
    inner = lights(12) + arrows + centered(field, `400 ${px(12.5 * s)}/1 ${SANS}`);
  } else if (style === 'windows') {
    const buttons =
      `<div style="display:flex;margin-left:auto;height:100%;position:relative;z-index:1">` +
      [ICONS.minimize, ICONS.maximize, ICONS.close]
        .map(
          path =>
            `<div style="display:flex;align-items:center;justify-content:center;width:${px(46 * s)};height:100%">` +
            `${icon(path, 10 * s, theme.title, 0.9)}</div>`,
        )
        .join('') +
      '</div>';
    const label = title
      ? `<div style="padding-left:${px(14 * s)};font:400 ${px(12 * s)}/1 ${SANS};color:${theme.title};white-space:nowrap;` +
        `overflow:hidden;text-overflow:ellipsis">${escapeHtml(title)}</div>`
      : '';
    inner = label + buttons;
  } else {
    // terminal: a tab with a prompt icon and the title, on a bar that shares the screen's color.
    const tab =
      `<div style="display:flex;align-items:center;gap:${px(7 * s)};height:${px(22 * s)};padding:0 ${px(12 * s)};` +
      `border-radius:${px(6 * s)};background:${theme.field}">${icon(ICONS.prompt, 11 * s, theme.title, 1.2)}` +
      `${title ? `<span>${escapeHtml(title)}</span>` : ''}</div>`;
    inner = lights(11) + centered(tab, `500 ${px(12 * s)}/1 ${MONO}`);
  }
  return (
    `<div style="box-sizing:border-box;position:relative;display:flex;align-items:center;` +
    `height:${px(BAR_HEIGHT[style] * s)};background:${background}${border}">${inner}</div>`
  );
}

/** A minimal HTML page: fixed-size body, the frame background, `body` markup centered. */
export function page(canvas: { width: number; height: number }, background: string, body: string, css = ''): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: ${px(canvas.width)}; height: ${px(canvas.height)}; overflow: hidden; position: relative;
    background: ${background};
    display: flex; align-items: center; justify-content: center;
  }
${css}
</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * A self-contained HTML page that shows the screenshot in its frame. No network, system fonts only.
 *
 * Without `imageSrc` the page is the frame around a hole: the background moves from `body` to `#backdrop`, which
 * the caller clips around `#hole`, so a screenshot with a transparent background leaves the hole see-through.
 */
export function frameHtml({
  frame,
  layout,
  imageSrc,
  title,
  address,
  barColor,
}: {
  frame: ResolvedFrame;
  layout: FrameLayout;
  imageSrc: string | undefined;
  title: string | undefined;
  address?: string | undefined;
  barColor?: string | undefined;
}): string {
  const window = windowMarkup({ frame, image: layout.image, scale: layout.scale, imageSrc, title, address, barColor });
  if (imageSrc !== undefined) return page(layout.canvas, backgroundCss(frame.background), window);
  const backdrop = `<div id="backdrop" style="position:absolute;inset:0;background:${backgroundCss(frame.background)}"></div>`;
  return page(layout.canvas, 'transparent', backdrop + window);
}
