import { promises as fs } from 'node:fs';
import path from 'node:path';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string) {
  if (!UUID_PATTERN.test(value)) throw new Error('Invalid company feed image storage key.');
  return value.toLowerCase();
}

class LocalCompanyFeedImageStorage {
  readonly directory = path.resolve(process.env.COMPANY_FEED_IMAGE_DIRECTORY || 'uploads/company-feed');

  storageKey(tenantId: string, imageId: string) {
    return `${assertUuid(tenantId)}/${assertUuid(imageId)}.webp`;
  }

  async write(tenantId: string, imageId: string, contents: Buffer) {
    const storageKey = this.storageKey(tenantId, imageId);
    const filePath = this.resolveOwnedPath(storageKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents, { flag: 'wx' });
    return storageKey;
  }

  async read(storageKey: string) {
    return fs.readFile(this.resolveOwnedPath(storageKey));
  }

  async remove(storageKey: string | null | undefined) {
    if (!storageKey) return;
    await fs.unlink(this.resolveOwnedPath(storageKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private resolveOwnedPath(storageKey: string) {
    const normalized = storageKey.replace(/\\/g, '/');
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(normalized)) {
      throw new Error('Invalid company feed image storage key.');
    }
    const resolved = path.resolve(this.directory, normalized);
    const relative = path.relative(this.directory, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Company feed image path escaped its storage directory.');
    }
    return resolved;
  }
}

// Development and single-node deployments use local disk. Swap this adapter
// for tenant-scoped object storage before running multiple stateless instances.
export const companyFeedImageStorage = new LocalCompanyFeedImageStorage();
