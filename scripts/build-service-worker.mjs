import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** Tie the existing handwritten worker to the frontend deployment, without timestamps. */
export async function writeServiceWorker(outDir=path.resolve('dist')) {
 const source=await readFile(new URL('../public/service-worker.js',import.meta.url),'utf8');
 const hash=createHash('sha256').update(source).update(await readFile(path.join(outDir,'index.html')));
 const assets=source.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)?.[1].match(/'([^']+)'/g);
 if(!assets?.length)throw Error('Service worker static asset inventory missing');
 for(const quoted of assets){const asset=quoted.slice(1,-1);hash.update(asset).update(await readFile(path.join(outDir,asset.slice(1))));}
 const revision=hash.digest('hex').slice(0,20),placeholder="const BUILD_REVISION = 'unversioned';";
 if(!source.includes(placeholder))throw Error('Service worker revision placeholder missing');
 await writeFile(path.join(outDir,'service-worker.js'),source.replace(placeholder,`const BUILD_REVISION = '${revision}';`));
 return revision;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await writeServiceWorker(process.argv[2]?path.resolve(process.argv[2]):undefined);
