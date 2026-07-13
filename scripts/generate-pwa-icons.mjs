import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDirectory = path.join(root, 'public', 'icons');
const appIconSource = path.join(iconDirectory, 'stanza-app-icon.svg');
const faviconSource = path.join(iconDirectory, 'stanza-favicon.svg');
const outputs = [
  ['stanza-192.png', 192, appIconSource],
  ['stanza-512.png', 512, appIconSource],
  ['stanza-maskable-192.png', 192, appIconSource],
  ['stanza-maskable-512.png', 512, appIconSource],
  ['stanza-apple-touch-icon.png', 180, appIconSource],
  ['stanza-favicon-32.png', 32, faviconSource],
  ['stanza-favicon-16.png', 16, faviconSource],
];

await mkdir(iconDirectory, { recursive: true });

await Promise.all(outputs.map(async ([filename, size, source]) => {
  await sharp(source, { density: 384 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9, palette: false })
    .toFile(path.join(iconDirectory, filename));
}));

console.log(`Generated ${outputs.length} Stanza icon assets.`);
