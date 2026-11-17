import type { MatchCandidate, MatchLineInput, UploadMimeType } from '@kavach/shared';

/**
 * The AI provider boundary (CLAUDE.md stack: "OpenAI behind a DocumentExtractor interface, so the
 * provider can be swapped or given a fallback OCR"; ARCHITECTURE §3.3).
 *
 * An extractor only reads documents and answers questions. It returns raw, unvalidated output:
 * the pipeline validates it with zod and decides what it means. Nothing here can reach stock.
 */
export interface PageInput {
  pageNo: number;
  mimeType: UploadMimeType;
  /** Pages inside the file: 1 for an image. */
  pageCount: number;
  /** The bytes to send: images are upright and reduced; PDFs are sent as stored. */
  data: Buffer;
  /** sha256 of the file as uploaded. */
  sha256: string;
}

export interface ExtractionHints {
  /** Unit names of the project, so the model writes "Bags" and not "bgs." where it can. */
  units: string[];
  /** Category names of the project (PRD §6.3). */
  categories: string[];
}

/** Sent with a second attempt when the first answer did not fit the schema. */
export interface RepairRequest {
  previous: unknown;
  errors: string[];
}

export interface ExtractorResponse {
  /** Parsed JSON, not yet validated. */
  raw: unknown;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export type ExtractorErrorKind =
  /** Rate limit, 5xx, network: worth another attempt later. */
  | 'TRANSIENT'
  | 'TIMEOUT'
  /** The provider declined to read the document. */
  | 'REFUSED'
  /** Bad request, bad key, unsupported file: retrying will not help. */
  | 'PROVIDER'
  /** No provider is configured. */
  | 'NOT_CONFIGURED';

export class ExtractorError extends Error {
  constructor(
    readonly kind: ExtractorErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExtractorError';
  }

  get retryable(): boolean {
    return this.kind === 'TRANSIENT' || this.kind === 'TIMEOUT';
  }
}

export interface DocumentExtractor {
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  /** Reads the whole document: quality, header and lines (PRD §7.3 steps 2–4). */
  extract(
    pages: PageInput[],
    hints: ExtractionHints,
    repair?: RepairRequest,
  ): Promise<ExtractorResponse>;
  /** Chooses between close Material Master candidates for one line (PRD §22.3 step 6). */
  resolveCandidates(line: MatchLineInput, candidates: MatchCandidate[]): Promise<ExtractorResponse>;
}
