# Document Extraction Foundation

Stanza's document-extraction API is provider-neutral and disabled when no OCR
adapter is configured. The current foundation accepts JPEG, PNG, and WebP
images. PDF extraction is intentionally unsupported until a bounded, sandboxed
PDF parser and page limit are selected.

## Configuration

- `DOCUMENT_EXTRACTION_PROVIDER`: provider adapter identifier. No external
  provider is configured by default.
- `DOCUMENT_EXTRACTION_RETENTION_HOURS`: job-result retention from 1 to 24
  hours; defaults to 4.
- `DOCUMENT_EXTRACTION_TEMP_DIR`: optional private temporary directory. The
  default is an operating-system temporary directory outside public uploads.
- `ALLOW_DOCUMENT_EXTRACTION_FIXTURES`: enables deterministic fixtures only
  when set to `true` together with `DOCUMENT_EXTRACTION_PROVIDER=fixture` and
  `NODE_ENV=test`.

Provider adapters must return candidate fields and confidence only. They must
not expose raw provider payloads through the application contract. Before
enabling an external adapter, document its retention, regional processing,
model-training controls, credential handling, and deletion behavior.

Extraction results are editable candidates. They never create or update an
expense claim, applicant, or asset record automatically.
