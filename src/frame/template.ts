import type { ResolvedBackground, ResolvedFrame } from '../config/types.js';

/** Title bar height per style, in CSS pixels at scale 1. */
export const BAR_HEIGHT: Record<ResolvedFrame['style'], number> = { window: 40, minimal: 28, none: 0 };

const THEMES = {
  dark: { bar: '#1f2430', border: 'rgba(255,255,255,0.06)', title: 'rgba(255,255,255,0.62)', outline: 'rgba(255,255,255,0.10)' },
  light: { bar: '#eceef2', border: 'rgba(0,0,0,0.08)', title: 'rgba(0,0,0,0.55)', outline: 'rgba(0,0,0,0.12)' },
} as const;

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

export function backgroundCss(background: ResolvedBackground): string {
  switch (background.type) {
    case 'solid':
      return background.color;
    case 'gradient':
      return `linear-gradient(${String(background.angle)}deg, ${background.from}, ${background.to})`;
    case 'transparent':
      return 'transparent';
  }
}

const px = (value: number): string => `${String(Math.round(value * 1000) / 1000)}px`;

/**
 * One framed window as self-contained markup (inline styles only), so a page can hold several at different
 * scales. `extraStyle` goes on the outer element, for positioning and transforms.
 */
export function windowMarkup({
  frame,
  image,
  scale: s,
  imageSrc,
  title,
  extraStyle = '',
}: {
  frame: ResolvedFrame;
  image: { width: number; height: number };
  scale: number;
  imageSrc: string;
  title: string | undefined;
  extraStyle?: string;
}): string {
  const theme = THEMES[frame.theme];
  const hairline = px(Math.max(1, s));
  const shadow = frame.shadow
    ? `0 ${px(24 * s)} ${px(64 * s)} rgba(0,0,0,0.35), 0 ${px(8 * s)} ${px(24 * s)} rgba(0,0,0,0.22)`
    : 'none';
  const lights =
    frame.style === 'window'
      ? `<div style="display:flex;gap:${px(8 * s)};padding-left:${px(14 * s)};position:relative;z-index:1">${LIGHTS.map(
          color => `<i style="display:block;width:${px(12 * s)};height:${px(12 * s)};border-radius:50%;background:${color}"></i>`,
        ).join('')}</div>`
      : '';
  const titleMarkup = title
    ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;` +
      `font:500 ${px(13 * s)}/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:${theme.title};white-space:nowrap">` +
      `${escapeHtml(title)}</div>`
    : '';
  const bar =
    frame.style === 'none'
      ? ''
      : `<div style="box-sizing:border-box;position:relative;display:flex;align-items:center;` +
        `height:${px(BAR_HEIGHT[frame.style] * s)};background:${theme.bar};border-bottom:${hairline} solid ${theme.border}">` +
        `${lights}${titleMarkup}</div>`;
  // The outline sits on top of the screenshot so light apps keep an edge on light backgrounds.
  const outline =
    `<div style="position:absolute;inset:0;border-radius:inherit;pointer-events:none;` +
    `box-shadow:inset 0 0 0 ${hairline} ${theme.outline}"></div>`;
  return (
    `<div class="window" style="position:relative;overflow:hidden;flex:none;width:${px(image.width)};` +
    `border-radius:${px(frame.radius * s)};background:${theme.bar};box-shadow:${shadow};${extraStyle}">` +
    `${bar}<img src="${imageSrc}" alt="" style="display:block;width:${px(image.width)};height:${px(image.height)}">` +
    `${outline}</div>`
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

/** A self-contained HTML page that shows the screenshot in its frame. No network, system fonts only. */
export function frameHtml({
  frame,
  layout,
  imageSrc,
  title,
}: {
  frame: ResolvedFrame;
  layout: FrameLayout;
  imageSrc: string;
  title: string | undefined;
}): string {
  return page(
    layout.canvas,
    backgroundCss(frame.background),
    windowMarkup({ frame, image: layout.image, scale: layout.scale, imageSrc, title }),
  );
}
