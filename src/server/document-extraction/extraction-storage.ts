import crypto from 'node:crypto';
import { mkdir, open, readdir, readFile, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_RETENTION_MS = 4 * 60 * 60 * 1000;

export class PrivateExtractionStorage {
  readonly directory: string;

  constructor(
    root = process.env.DOCUMENT_EXTRACTION_TEMP_DIR || path.join(os.tmpdir(), 'stanza-document-extractions'),
    private readonly staleAfterMs = DEFAULT_RETENTION_MS,
  ) {
    this.directory = path.resolve(root);
  }

  private resolveKey(storageKey: string) {
    if (!/^[0-9a-f-]{36}\.bin$/i.test(storageKey)) throw new Error('Invalid extraction storage key.');
    const resolved = path.resolve(this.directory, storageKey);
    if (path.dirname(resolved) !== this.directory) throw new Error('Invalid extraction storage path.');
    return resolved;
  }

  async write(buffer: Buffer) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const storageKey = `${crypto.randomUUID()}.bin`;
    const file = await open(this.resolveKey(storageKey), 'wx', 0o600);
    try {
      await file.writeFile(buffer);
    } finally {
      await file.close();
    }
    return storageKey;
  }

  async read(storageKey: string) {
    return readFile(this.resolveKey(storageKey));
  }

  async remove(storageKey: string | null | undefined) {
    if (!storageKey) return;
    await unlink(this.resolveKey(storageKey)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async cleanupExpired(now = Date.now()) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile() || !/^[0-9a-f-]{36}\.bin$/i.test(entry.name)) return;
      const filePath = this.resolveKey(entry.name);
      const details = await stat(filePath);
      if (now - details.mtimeMs > this.staleAfterMs) await unlink(filePath).catch(() => undefined);
    }));
  }
}
