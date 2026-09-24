export { capture, type CaptureOptions, type CaptureResult, type CapturedFile } from './capture.js';
export { defineConfig } from './config/define.js';
export { CONFIG_NAMES, findConfigFile, loadConfig } from './config/load.js';
export { isTtyConfig, resolveConfig } from './config/resolve.js';
export { encodeAnimation, type AnimationFormat, type AnimationFrame, type EncodeOptions } from './encode.js';
export { ConfigError, ShowcaseError } from './errors.js';
export { frame, type FramedFile, type FrameRunOptions } from './frame/index.js';
export { hero, heroHtml } from './hero.js';
export { encodeIcns, encodeIco, generateIcons, ICON_PRESETS, type IconPreset } from './icons.js';
export { init, starterConfig } from './init.js';
export { exportPortfolio, GALLERY_FILE, type GalleryItem, type PortfolioResult } from './portfolio.js';
export { readmeSnippet, type ReadmeOptions } from './readme.js';
export { record, type RecordedClip, type RecordedFile, type RecordOptions } from './record.js';
export type * from './config/types.js';
export type * from './tty/types.js';
export {
  DARK_THEME,
  LIGHT_THEME,
  openTtySession,
  parseKeys,
  renderTtyScreen,
  resolveTerminalOptions,
  TERMINAL_DEFAULTS,
} from './tty/index.js';
