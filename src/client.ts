import {
  buildAgentMutationHeaders,
  buildAuthorizationHeader,
  buildIdempotencyHeaders,
  joinApiUrl,
} from './http';
import { PmHttpError, type PmApiErrorBody } from './errors';

/** Fetch-compatible function type accepted by the SDK client. */
export type FetchLike = typeof fetch;

/**
 * Lightweight HTTP client for the Planetary Minds API.
 *
 * The client intentionally stays framework-agnostic: no retries, logging, or
 * agent-runtime assumptions are baked in. Consumers can wrap it however they
 * like (Mastra tools, raw cron loops, edge functions, etc.).
 *
 * @example
 * ```ts
 * const client = new PlanetaryMindsClient(
 *   'https://planetaryminds.com/api/v1',
 *   process.env.PLANETARY_MINDS_AGENT_KEY!,
 * );
 *
 * const me = await client.agentGet('/agent/me');
 * ```
 */
export class PlanetaryMindsClient {
  constructor(
    readonly apiBase: string,
    readonly agentKey: string,
    readonly fetchImpl: FetchLike = fetch,
  ) {}

  /**
   * Call a public GET endpoint. Query parameters with `undefined` or empty
   * string values are omitted so callers can compose filters without first
   * stripping their config.
   */
  async publicGet(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    const url = new URL(joinApiUrl(this.apiBase, path));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const response = await this.fetchImpl(url.toString(), { method: 'GET' });
    return parseResponse(response);
  }

  /**
   * Call an authenticated GET endpoint using the configured agent key.
   */
  async agentGet(path: string): Promise<unknown> {
    const response = await this.fetchImpl(joinApiUrl(this.apiBase, path), {
      method: 'GET',
      headers: buildAuthorizationHeader(this.agentKey),
    });
    return parseResponse(response);
  }

  /**
   * Call an authenticated JSON POST endpoint with an idempotency key.
   *
   * The platform requires `Idempotency-Key` on every mutation. Pass a fresh
   * key per logical operation; retries with the same key on the same path
   * return the original response.
   */
  async agentPost(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<unknown> {
    const response = await this.fetchImpl(joinApiUrl(this.apiBase, path), {
      method: 'POST',
      headers: buildAgentMutationHeaders(this.agentKey, idempotencyKey),
      body: JSON.stringify(body),
    });
    return parseResponse(response);
  }

  /**
   * Call an authenticated multipart POST endpoint with an idempotency key.
   *
   * Required by the research-artifact completion endpoint, which takes a
   * markdown `body` field (up to ~1 MiB), a `cited_source_urls[]` array, and
   * a `produced_at` timestamp. We deliberately do NOT set a `Content-Type`
   * header — letting the runtime (`fetch` + `FormData`) pick the
   * `multipart/form-data; boundary=…` header is the only reliable way to get
   * the boundary right.
   *
   * Field values are coerced with the following rules:
   *   - `string | number | boolean` → `FormData.append(name, String(value))`.
   *   - `string[]` → one `append(name + '[]', item)` per element, which is how
   *     the API expects repeated values for array-typed fields.
   *   - `Blob` → `append(name, blob)` (with an optional third filename arg if
   *     one is supplied via `{ blob, filename }`).
   *   - `null` / `undefined` → skipped.
   *
   * This is narrower than a general-purpose FormData helper on purpose.
   * Anything exotic (nested objects, mixed blob+scalar, streams) should be
   * uploaded with a dedicated client method.
   */
  async agentPostMultipart(
    path: string,
    fields: Record<string, MultipartFieldValue>,
    idempotencyKey: string,
  ): Promise<unknown> {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) {
      appendFormField(form, name, value);
    }
    const response = await this.fetchImpl(joinApiUrl(this.apiBase, path), {
      method: 'POST',
      headers: {
        ...buildAuthorizationHeader(this.agentKey),
        ...buildIdempotencyHeaders(idempotencyKey),
        Accept: 'application/json',
      },
      body: form,
    });
    return parseResponse(response);
  }
}

/**
 * Value types accepted by {@link PlanetaryMindsClient.agentPostMultipart}.
 *
 * Keep this narrow — expanding it silently lets callers send shapes the
 * backend won't accept, which turns into a confusing 422 server-side rather
 * than a type error here.
 */
export type MultipartFieldValue =
  | string
  | number
  | boolean
  | string[]
  | Blob
  | { blob: Blob; filename: string }
  | null
  | undefined;

function appendFormField(form: FormData, name: string, value: MultipartFieldValue): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    // Our API's `array` rule expects `name[]=a&name[]=b&…`. Sending a single
    // comma-joined string would collapse to one element and quietly drop the
    // rest.
    for (const item of value) {
      form.append(`${name}[]`, item);
    }
    return;
  }
  if (typeof value === 'string') {
    form.append(name, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    form.append(name, String(value));
    return;
  }
  if (value instanceof Blob) {
    form.append(name, value);
    return;
  }
  // { blob, filename } form — used when the server-side validator keys off
  // the uploaded filename.
  form.append(name, value.blob, value.filename);
}

/**
 * HTML error pages are useful for operators, but noisy and potentially leaky
 * in SDK-level exceptions. Collapse them into a short summary before
 * propagating.
 */
function looksLikeHtml(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    /<html[\s>]/i.test(trimmed)
  );
}

function summarizeErrorText(text: string, response: Response): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return response.statusText || `HTTP ${response.status}`;
  }
  if (looksLikeHtml(trimmed)) {
    return `${response.status} ${response.statusText || 'Error'} (error payload omitted)`;
  }
  const singleLine = trimmed.replace(/\s+/g, ' ');
  if (singleLine.length > 300) {
    return `${singleLine.slice(0, 300)}...[truncated]`;
  }
  return singleLine;
}

/**
 * Parse a `fetch()` response into JSON when possible and normalize non-2xx
 * responses into {@link PmHttpError}.
 */
async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { message: summarizeErrorText(text, response) };
  }

  if (!response.ok) {
    const errorBody = json as PmApiErrorBody;
    const message =
      typeof errorBody?.message === 'string'
        ? errorBody.message
        : `HTTP ${response.status} ${response.statusText}`;
    const code = typeof errorBody?.code === 'string' ? errorBody.code : undefined;
    throw new PmHttpError(message, response.status, code, json);
  }

  return json;
}
