import { promises as fs } from 'node:fs';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeUuid(value: string) {
  if (!UUID.test(value)) throw new Error('Invalid asset evidence storage key.');
  return value.toLowerCase();
}

class LocalAssetEvidenceStorage {
  readonly directory = path.resolve(process.env.ASSET_EVIDENCE_DIRECTORY || 'uploads/assets');

  storageKey(tenantId: string, evidenceId: string) {
    return `${normalizeUuid(tenantId)}/${normalizeUuid(evidenceId)}.webp`;
  }

  async write(tenantId: string, evidenceId: string, contents: Buffer) {
    const key = this.storageKey(tenantId, evidenceId);
    const filePath = this.resolveOwnedPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, { flag: 'wx' });
    return key;
  }

  async read(storageKey: string) { return fs.readFile(this.resolveOwnedPath(storageKey)); }

  async remove(storageKey: string | null | undefined) {
    if (!storageKey) return;
    await fs.unlink(this.resolveOwnedPath(storageKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private resolveOwnedPath(storageKey: string) {
    const key = storageKey.replace(/\\/g, '/');
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(key)) throw new Error('Invalid asset evidence storage key.');
    const resolved = path.resolve(this.directory, key);
    const relative = path.relative(this.directory, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Asset evidence path escaped its storage directory.');
    return resolved;
  }
}

// Pending evidence is never written: the same transaction records a report or
// deletes the re-encoded file on failure. Periodic orphan cleanup may safely
// remove files with no matching condition-report storage key.
export const assetEvidenceStorage = new LocalAssetEvidenceStorage();
