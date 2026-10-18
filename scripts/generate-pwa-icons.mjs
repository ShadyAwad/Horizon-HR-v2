import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {STANZA_FINGERPRINT_GROOVES} from '../src/components/stanzaFingerprintGeometry.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'public','icons');
// Login, launcher and installed app deliberately share the same path geometry.
export function iconSvg(kind){
 const paths=STANZA_FINGERPRINT_GROOVES.map(d=>`<path d="${d}"/>`).join('');
 const group=(attributes)=>`<g fill="none" stroke-linecap="round" stroke-linejoin="round" ${attributes}>${paths}</g>`;
 if(kind==='favicon')return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none"><defs><linearGradient id="ink" x1="8" y1="6" x2="25" y2="27" gradientUnits="userSpaceOnUse"><stop stop-color="#6EE7B7"/><stop offset="1" stop-color="#10B981"/></linearGradient></defs>${group('transform="translate(4 4)" stroke="#02110B" stroke-width="3.4" opacity="0.8"')}${group('transform="translate(4 4)" stroke="url(#ink)" stroke-width="2"')}</svg>\n`;
 if(kind==='standard')return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">${group('transform="translate(96 96) scale(13.3333)" stroke="#10B981" stroke-width="2"')}</svg>\n`;
 if(kind!=='app')throw Error('Unknown icon variant');
 // Full-bleed opaque background; the foreground fits inside the central 80% circle.
 return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none"><defs><radialGradient id="background" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(256 216) rotate(90) scale(310)"><stop stop-color="#0A2A1E"/><stop offset="0.58" stop-color="#04140E"/><stop offset="1" stop-color="#020604"/></radialGradient><filter id="glow" x="62" y="62" width="388" height="388" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="9"/></filter></defs><rect width="512" height="512" fill="url(#background)"/>${group('transform="translate(102.4 102.4) scale(12.8)" stroke="#34D399" stroke-width="2" opacity="0.22" filter="url(#glow)"')}${group('transform="translate(102.4 102.4) scale(12.8)" stroke="#34D399" stroke-width="2"')}</svg>\n`;
}
export async function generatePwaIcons(){
 await mkdir(directory,{recursive:true});
 const sources={standard:iconSvg('standard'),app:iconSvg('app'),favicon:iconSvg('favicon')};
 for(const [kind,svg] of Object.entries(sources))await writeFile(path.join(directory,`stanza-${kind==='standard'?'standard-icon':kind==='app'?'app-icon':'favicon'}.svg`),svg);
 const outputs=[['stanza-192.png',192,'standard'],['stanza-512.png',512,'standard'],['stanza-maskable-192.png',192,'app'],['stanza-maskable-512.png',512,'app'],['stanza-apple-touch-icon.png',180,'app'],['stanza-favicon-32.png',32,'favicon'],['stanza-favicon-16.png',16,'favicon']];
 await Promise.all(outputs.map(async([filename,size,kind])=>sharp(Buffer.from(sources[kind]),{density:384}).resize(size,size,{fit:'fill'}).png({compressionLevel:9,palette:false}).toFile(path.join(directory,filename))));
 console.log(`Generated 3 SVG sources and ${outputs.length} PNG variants from the current Stanza mark.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await generatePwaIcons();
