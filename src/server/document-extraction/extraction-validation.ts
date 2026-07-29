import path from 'node:path';
import sharp from 'sharp';
import { ExtractionError } from './extraction-types';

export const EXTRACTION_MAX_BYTES = 10 * 1024 * 1024;
export const EXTRACTION_MAX_INPUT_PIXELS = 40_000_000;
export const EXTRACTION_MAX_DIMENSION = 12_000;
export const EXTRACTION_OUTPUT_MAX_DIMENSION = 4_096;
export const SUPPORTED_EXTRACTION_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type SupportedExtractionMime = typeof SUPPORTED_EXTRACTION_MIME_TYPES[number];

type UploadInput = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

export type ValidatedExtractionImage = {
  buffer: Buffer;
  mimeType: SupportedExtractionMime;
  originalBytes: number;
  width: number;
  height: number;
};

const extensionMime: Record<string, SupportedExtractionMime> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function detectImageMime(buffer: Buffer): SupportedExtractionMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function validateUploadEnvelope(file: UploadInput): SupportedExtractionMime {
  if (!file.buffer.length || file.size <= 0) throw new ExtractionError('INVALID_IMAGE', 'The selected file is empty.', 400);
  if (file.size > EXTRACTION_MAX_BYTES || file.buffer.length > EXTRACTION_MAX_BYTES) {
    throw new ExtractionError('FILE_TOO_LARGE', 'The selected file must be 10 MB or smaller.', 413);
  }
  const detected = detectImageMime(file.buffer);
  if (!detected || !(SUPPORTED_EXTRACTION_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new ExtractionError('UNSUPPORTED_FILE_TYPE', 'Select a JPEG, PNG, or WebP image.', 415);
  }
  if (detected !== file.mimetype) {
    throw new ExtractionError('UNSUPPORTED_FILE_TYPE', 'The file content does not match its declared image type.', 415);
  }
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (extensionMime[extension] && extensionMime[extension] !== detected) {
    throw new ExtractionError('UNSUPPORTED_FILE_TYPE', 'The filename extension does not match the image content.', 415);
  }
  return detected;
}

export async function validateAndPrepareImage(file: UploadInput): Promise<ValidatedExtractionImage> {
  const mimeType = validateUploadEnvelope(file);
  try {
    const image = sharp(file.buffer, {
      animated: false,
      failOn: 'error',
      limitInputPixels: EXTRACTION_MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width
      || !metadata.height
      || (metadata.pages || 1) !== 1
      || metadata.width > EXTRACTION_MAX_DIMENSION
      || metadata.height > EXTRACTION_MAX_DIMENSION
      || metadata.width * metadata.height > EXTRACTION_MAX_INPUT_PIXELS
    ) {
      throw new ExtractionError('DOCUMENT_TOO_COMPLEX', 'The image dimensions are not supported.', 422);
    }

    let normalized = image
      .rotate()
      .resize({
        width: EXTRACTION_OUTPUT_MAX_DIMENSION,
        height: EXTRACTION_OUTPUT_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });
    if (mimeType === 'image/jpeg') normalized = normalized.jpeg({ quality: 90, mozjpeg: true });
    else if (mimeType === 'image/png') normalized = normalized.png({ compressionLevel: 8 });
    else normalized = normalized.webp({ quality: 90 });
    const result = await normalized.toBuffer({ resolveWithObject: true });
    return {
      buffer: result.data,
      mimeType,
      originalBytes: file.size,
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError('INVALID_IMAGE', 'The image is malformed or cannot be processed.', 422);
  }
}
