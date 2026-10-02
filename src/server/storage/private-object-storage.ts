import crypto from 'node:crypto';
import { PrivateExtractionStorage } from '../document-extraction/extraction-storage';
export interface PrivateObjectStorage {
    write(buffer: Buffer): Promise<string>;
    read(key: string): Promise<Buffer>;
    remove(key: string | null | undefined): Promise<void>;
}
export interface ObjectTransport {
    put(key: string, buffer: Buffer): Promise<void>;
    get(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
}
/** The transport must use authenticated S3/R2 operations against a private bucket. */
export class PrivateObjectAdapter implements PrivateObjectStorage {
    constructor(private transport: ObjectTransport, private prefix = 'grievances') { }
    private key(key: string) { if (!/^[0-9a-f-]{36}\.bin$/i.test(key))
        throw Error('Invalid private object key'); return this.prefix + '/' + key; }
    async write(buffer: Buffer) { const key = crypto.randomUUID() + '.bin'; await this.transport.put(this.key(key), buffer); return key; }
    read(key: string) { return this.transport.get(this.key(key)); }
    async remove(key: string | null | undefined) { if (key)
        await this.transport.delete(this.key(key)); }
}
export function grievanceStorage(): PrivateObjectStorage { return new PrivateExtractionStorage(process.env.GRIEVANCE_ATTACHMENT_DIRECTORY || 'uploads/private-grievances', Infinity); }
