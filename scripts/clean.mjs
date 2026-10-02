import { rmSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
for (const name of ['dist', 'server.js']) {
    const target = resolve(root, name);
    if (!target.startsWith(root + sep) || dirname(target) !== root)
        throw new Error('Refusing cleanup outside the repository.');
    rmSync(target, { recursive: true, force: true });
}
