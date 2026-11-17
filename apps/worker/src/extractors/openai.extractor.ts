import type { MatchCandidate, MatchLineInput } from '@kavach/shared';
import {
  type DocumentExtractor,
  type ExtractionHints,
  ExtractorError,
  type ExtractorResponse,
  type PageInput,
  type RepairRequest,
} from './document-extractor';
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM_PROMPT,
  PROMPT_VERSION,
  TIEBREAK_JSON_SCHEMA,
  TIEBREAK_SYSTEM_PROMPT,
  extractionUserPrompt,
  repairPrompt,
} from './prompts';

export interface OpenAIExtractorOptions {
  apiKey: string;
  model: string;
  /** Override for an Azure / regional / proxy endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
  | { type: 'file'; file: { filename: string; file_data: string } };

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface ChatCompletion {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string | null; type?: string };
}

/**
 * OpenAI vision / document understanding with structured JSON output (PRD §7.3 step 3, §22.2).
 * Images go as data URLs and PDFs as file inputs, so no page is rasterised here.
 * The API key lives only in the worker's environment (PRD §25.2, ARCHITECTURE §7.5).
 */
export class OpenAIExtractor implements DocumentExtractor {
  readonly provider = 'openai';
  readonly promptVersion = PROMPT_VERSION;
  readonly model: string;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: OpenAIExtractorOptions) {
    this.model = options.model;
    this.url = `${(options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.doFetch = options.fetch ?? fetch;
  }

  async extract(
    pages: PageInput[],
    hints: ExtractionHints,
    repair?: RepairRequest,
  ): Promise<ExtractorResponse> {
    const pageCount = pages.reduce((n, p) => n + p.pageCount, 0);
    const parts: ContentPart[] = [{ type: 'text', text: extractionUserPrompt(hints, pageCount) }];
    for (const p of pages) {
      const dataUrl = `data:${p.mimeType};base64,${p.data.toString('base64')}`;
      if (p.mimeType === 'application/pdf') {
        parts.push({
          type: 'file',
          file: { filename: `document-${p.pageNo}.pdf`, file_data: dataUrl },
        });
      } else {
        parts.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } });
      }
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ];
    if (repair) {
      messages.push({ role: 'assistant', content: JSON.stringify(repair.previous ?? null) });
      messages.push({ role: 'user', content: repairPrompt(repair.errors) });
    }
    return this.call(messages, 'invoice_extraction', EXTRACTION_JSON_SCHEMA);
  }

  async resolveCandidates(
    line: MatchLineInput,
    candidates: MatchCandidate[],
  ): Promise<ExtractorResponse> {
    const payload = {
      line: {
        description: line.description,
        suggestedName: line.suggestedName,
        brand: line.brand,
        grade: line.grade,
        size: line.size,
        specification: line.specification,
        packSize: line.packSize,
      },
      candidates: candidates.map((c) => ({
        id: c.materialId,
        name: c.name,
        category: c.categoryName,
        stockUnit: c.stockUnitCode,
      })),
    };
    return this.call(
      [
        { role: 'system', content: TIEBREAK_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      'candidate_choice',
      TIEBREAK_JSON_SCHEMA,
    );
  }

  private async call(
    messages: ChatMessage[],
    schemaName: string,
    schema: Record<string, unknown>,
  ): Promise<ExtractorResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.doFetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          // Do not keep the request for later retrieval on the provider side.
          store: false,
          response_format: {
            type: 'json_schema',
            json_schema: { name: schemaName, strict: true, schema },
          },
        }),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        throw new ExtractorError('TIMEOUT', 'TIMEOUT', 'The AI service did not answer in time.');
      }
      throw new ExtractorError('TRANSIENT', 'NETWORK', 'Cannot reach the AI service.');
    } finally {
      clearTimeout(timer);
    }

    const body = (await res.json().catch(() => null)) as ChatCompletion | null;
    if (!res.ok) {
      // The provider's message can describe the request; it never contains the key.
      const detail = body?.error?.message?.slice(0, 300) ?? `HTTP ${res.status}`;
      const code = body?.error?.code ?? `HTTP_${res.status}`;
      if (res.status === 429 || res.status >= 500 || res.status === 408) {
        throw new ExtractorError('TRANSIENT', String(code), detail);
      }
      throw new ExtractorError('PROVIDER', String(code), detail);
    }

    const choice = body?.choices?.[0];
    if (choice?.message?.refusal) {
      throw new ExtractorError('REFUSED', 'REFUSED', choice.message.refusal.slice(0, 300));
    }
    const text = choice?.message?.content;
    const usage = {
      model: body?.model ?? this.model,
      inputTokens: body?.usage?.prompt_tokens ?? null,
      outputTokens: body?.usage?.completion_tokens ?? null,
    };
    if (!text || choice?.finish_reason === 'length') {
      // Truncated or empty: handed back as invalid output so the pipeline can retry once.
      return { raw: null, ...usage };
    }
    try {
      return { raw: JSON.parse(text) as unknown, ...usage };
    } catch {
      return { raw: null, ...usage };
    }
  }
}
