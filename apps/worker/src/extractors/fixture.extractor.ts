import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  type DocumentExtractor,
  ExtractorError,
  type ExtractorResponse,
  type PageInput,
} from './document-extractor';
import { ExpectedDocumentSchema, expectedToExtraction } from './expected-format';

/**
 * Offline stand-in for the AI provider. It answers only for the synthetic documents in
 * `test-docs/`, by file fingerprint, with what their answer keys say a perfect reading returns.
 *
 * For development and automated tests without network access or an API key. It reads nothing
 * from the image, so it says nothing about real accuracy, and every log row it produces carries
 * provider "fixture". Never use it in production: the worker refuses to start with it there.
 */
export class FixtureExtractor implements DocumentExtractor {
  readonly provider = 'fixture';
  readonly model = 'test-docs-answer-keys';
  readonly promptVersion = 'fixture-v1';
  private readonly bySha = new Map<string, unknown>();

  constructor(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.expected.json')) continue;
      try {
        const doc = ExpectedDocumentSchema.parse(
          JSON.parse(readFileSync(path.join(dir, name), 'utf8')),
        );
        const file = path.join(dir, doc._meta.file);
        if (!existsSync(file)) continue;
        const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
        this.bySha.set(sha, expectedToExtraction(doc));
      } catch {
        // An answer key that does not parse is skipped: this is a development aid.
      }
    }
  }

  get size(): number {
    return this.bySha.size;
  }

  async extract(pages: PageInput[]): Promise<ExtractorResponse> {
    const known = pages.map((p) => this.bySha.get(p.sha256)).find((x) => x !== undefined);
    if (known === undefined) {
      throw new ExtractorError(
        'NOT_CONFIGURED',
        'NO_FIXTURE',
        'The offline test extractor only knows the sample documents in test-docs/. ' +
          'Set OPENAI_API_KEY and AI_PROVIDER=openai to read real documents.',
      );
    }
    return {
      raw: structuredClone(known),
      model: this.model,
      inputTokens: null,
      outputTokens: null,
    };
  }

  /** The fixture never chooses: ambiguous lines stay in review, as they would without an LLM. */
  async resolveCandidates(): Promise<ExtractorResponse> {
    return {
      raw: { materialId: null, confidence: 0, reason: 'offline fixture' },
      model: this.model,
      inputTokens: null,
      outputTokens: null,
    };
  }
}
