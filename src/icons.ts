import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { ShowcaseError } from './errors.js';
import { log } from './log.js';

export type IconPreset = 'web' | 'electron' | 'tauri';

type IconFile = { file: string; size: number } | { file: string; ico: number[] } | { file: string; icns: true };

export const ICON_PRESETS: Record<IconPreset, IconFile[]> = {
  web: [
    { file: 'favicon.ico', ico: [16, 32, 48] },
    { file: 'apple-touch-icon.png', size: 180 },
    { file: 'icon-192.png', size: 192 },
    { file: 'icon-512.png', size: 512 },
  ],
  electron: [
    { file: 'icon.png', size: 1024 },
    { file: 'icon-16.png', size: 16 },
    { file: 'icon-32.png', size: 32 },
    { file: 'icon.ico', ico: [16, 32, 48, 256] },
  ],
  tauri: [
    { file: '32x32.png', size: 32 },
    { file: '128x128.png', size: 128 },
    { file: '128x128@2x.png', size: 256 },
    { file: 'icon.png', size: 1024 },
    { file: 'icon.ico', ico: [16, 24, 32, 48, 64, 256] },
    { file: 'icon.icns', icns: true },
  ],
};

// Apple's PNG-payload icon types, as iconutil writes them.
const ICNS_TYPES: [string, number][] = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function png(source: string, size: number): Promise<Buffer> {
  return sharp(source)
    .resize(size, size, { fit: 'contain', background: TRANSPARENT })
    .png({ compressionLevel: 9, palette: true, effort: 10, quality: 82 })
    .toBuffer();
}

/** A Windows .ico holding PNG images, one per size (the format Vista and later read). */
export function encodeIco(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, data }, index) => {
    const at = index * 16;
    // 0 means 256 in the one-byte width and height fields.
    entries.writeUInt8(size >= 256 ? 0 : size, at);
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1);
    entries.writeUInt8(0, at + 2);
    entries.writeUInt8(0, at + 3);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(data.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, entries, ...images.map(image => image.data)]);
}

/** A macOS .icns holding PNG images. */
export function encodeIcns(images: { type: string; data: Buffer }[]): Buffer {
  const chunks = images.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([head, data]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

/** Write an app icon set for `preset` from one square source image. */
export async function generateIcons(
  source: string,
  preset: IconPreset,
  outDir: string,
): Promise<{ file: string; path: string }[]> {
  const sourcePath = resolve(source);
  if (!existsSync(sourcePath)) {
    throw new ShowcaseError(`Icon source not found: ${sourcePath}. Use a square PNG, 1024x1024 or larger.`);
  }
  const files = Object.hasOwn(ICON_PRESETS, preset) ? ICON_PRESETS[preset] : undefined;
  if (!files) {
    throw new ShowcaseError(`Unknown icon preset "${preset}" (use ${Object.keys(ICON_PRESETS).join(', ')})`);
  }
  const { width = 0, height = 0 } = await sharp(sourcePath).metadata();
  if (width !== height) {
    log.warn(`warning: ${source} is ${String(width)}x${String(height)}, not square; icons will be padded.`);
  }
  if (Math.min(width, height) < 1024) {
    log.warn(`warning: ${source} is smaller than 1024px; large icons will be upscaled.`);
  }

  await mkdir(outDir, { recursive: true });
  const written: { file: string; path: string }[] = [];
  for (const target of files) {
    let data: Buffer;
    let label: string;
    if ('size' in target) {
      data = await png(sourcePath, target.size);
      label = `${String(target.size)}x${String(target.size)}`;
    } else if ('ico' in target) {
      data = encodeIco(await Promise.all(target.ico.map(async size => ({ size, data: await png(sourcePath, size) }))));
      label = `ico ${target.ico.join(', ')}`;
    } else {
      data = encodeIcns(await Promise.all(ICNS_TYPES.map(async ([type, size]) => ({ type, data: await png(sourcePath, size) }))));
      label = 'icns 16 to 512@2x';
    }
    const path = join(outDir, target.file);
    await writeFile(path, data);
    written.push({ file: target.file, path });
    log.info(`  ok    ${target.file}  ${label}  ${relative(process.cwd(), path)}`);
  }
  return written;
}
