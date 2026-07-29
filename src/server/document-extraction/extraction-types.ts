export const EXTRACTION_MODES = ['expense_receipt', 'candidate_document', 'asset_label'] as const;
export type ExtractionMode = typeof EXTRACTION_MODES[number];
export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'expired' | 'deleted';
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unavailable';

export type ExtractionWarning = {
  code: string;
  field: string | null;
  message: string;
};

export type ExtractedField = {
  value: string | null;
  confidence: number | null;
  confidenceLevel: ConfidenceLevel;
  warning: string | null;
};

export type ExpenseReceiptFields = {
  merchantName: ExtractedField;
  transactionDate: ExtractedField;
  totalAmount: ExtractedField;
  currency: ExtractedField;
};

export type CandidateDocumentFields = {
  fullName: ExtractedField;
  email: ExtractedField;
  phoneNumber: ExtractedField;
};

export type AssetLabelFields = {
  serialNumber: ExtractedField;
  modelNumber: ExtractedField;
  manufacturer: ExtractedField;
  barcodeText: ExtractedField;
};

export type ExtractionFields = ExpenseReceiptFields | CandidateDocumentFields | AssetLabelFields;

export type StructuredExtraction = {
  fields: ExtractionFields;
  warnings: ExtractionWarning[];
};

export type ExtractionResponse = {
  extractionId: string;
  mode: ExtractionMode;
  status: ExtractionStatus;
  fields: ExtractionFields | null;
  warnings: ExtractionWarning[];
  expiresAt: string;
};

export const MODE_PERMISSIONS: Record<ExtractionMode, string> = {
  expense_receipt: 'document_extraction.expense.self',
  candidate_document: 'document_extraction.candidate.manage',
  asset_label: 'document_extraction.asset.manage',
};

export function isExtractionMode(value: unknown): value is ExtractionMode {
  return typeof value === 'string' && (EXTRACTION_MODES as readonly string[]).includes(value);
}

export class ExtractionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}
