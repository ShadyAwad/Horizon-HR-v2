import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const URL_PREFIX = '/profile-images/';
const FILENAME_PATTERN = /^[0-9a-f-]{36}\.webp$/i;

class LocalProfileImageStorage {
  readonly directory = path.resolve(process.env.PROFILE_IMAGE_DIRECTORY || 'uploads/profile-images');
  readonly publicPath = URL_PREFIX.slice(0, -1);

  async write(contents: Buffer) {
    await fs.mkdir(this.directory, { recursive: true });
    const filename = `${crypto.randomUUID()}.webp`;
    await fs.writeFile(path.join(this.directory, filename), contents, { flag: 'wx' });
    return `${URL_PREFIX}${filename}`;
  }

  async remove(profileImageUrl: string | null | undefined) {
    const filename = this.ownedFilename(profileImageUrl);
    if (!filename) return;
    await fs.unlink(path.join(this.directory, filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private ownedFilename(profileImageUrl: string | null | undefined) {
    if (!profileImageUrl?.startsWith(URL_PREFIX)) return null;
    const filename = profileImageUrl.slice(URL_PREFIX.length);
    return FILENAME_PATTERN.test(filename) ? filename : null;
  }
}

// Swap this adapter for durable object storage in production deployments.
export const profileImageStorage = new LocalProfileImageStorage();
