import type { ExtractionMode } from './extraction-types';
import { ExtractionError } from './extraction-types';

export type ProviderFieldCandidate = {
  value: unknown;
  confidence?: unknown;
};

export type ProviderExtraction = {
  fields: Record<string, ProviderFieldCandidate | undefined>;
  warnings?: Array<{ code: string; field?: string; message: string }>;
};

export type ExtractionProviderInput = {
  mode: ExtractionMode;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  buffer: Buffer;
};

export interface ExtractionProvider {
  readonly id: string;
  extract(input: ExtractionProviderInput): Promise<ProviderExtraction>;
}

const FIXTURES: Record<ExtractionMode, ProviderExtraction> = {
  expense_receipt: {
    fields: {
      merchantName: { value: 'Stanza Test Market', confidence: 0.98 },
      transactionDate: { value: '2026-07-29', confidence: 0.94 },
      totalAmount: { value: '125.50', confidence: 0.96 },
      currency: { value: 'EGP', confidence: 0.91 },
    },
  },
  candidate_document: {
    fields: {
      fullName: { value: 'Amina Example', confidence: 0.95 },
      email: { value: 'amina.example.invalid@example.com', confidence: 0.92 },
      phoneNumber: { value: '+20 100 000 0000', confidence: 0.88 },
    },
  },
  asset_label: {
    fields: {
      serialNumber: { value: 'SN-TEST-9aB2', confidence: 0.97 },
      modelNumber: { value: 'STZ-14', confidence: 0.9 },
      manufacturer: { value: 'Stanza Test Hardware', confidence: 0.89 },
      barcodeText: { value: 'TEST-00001234', confidence: 0.93 },
    },
  },
};

export class FixtureExtractionProvider implements ExtractionProvider {
  readonly id = 'deterministic_fixture';

  constructor(private readonly fixtures: Partial<Record<ExtractionMode, ProviderExtraction>> = FIXTURES) {}

  async extract(input: ExtractionProviderInput) {
    const fixture = this.fixtures[input.mode];
    if (!fixture) throw new ExtractionError('EXTRACTION_FAILED', 'The extraction fixture is unavailable.', 500);
    return structuredClone(fixture);
  }
}

class UnavailableExtractionProvider implements ExtractionProvider {
  readonly id = 'unconfigured';

  async extract(): Promise<ProviderExtraction> {
    throw new ExtractionError(
      'EXTRACTION_PROVIDER_UNAVAILABLE',
      'Document extraction is not configured.',
      503,
    );
  }
}

export function createConfiguredExtractionProvider(env: NodeJS.ProcessEnv = process.env): ExtractionProvider {
  const provider = env.DOCUMENT_EXTRACTION_PROVIDER?.trim().toLowerCase();
  if (
    provider === 'fixture'
    && env.NODE_ENV === 'test'
    && env.ALLOW_DOCUMENT_EXTRACTION_FIXTURES === 'true'
  ) {
    return new FixtureExtractionProvider();
  }
  return new UnavailableExtractionProvider();
}
