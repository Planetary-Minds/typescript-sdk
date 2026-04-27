/**
 * Minimal API error envelope used by the Planetary Minds HTTP API.
 *
 * The server sometimes returns richer nested error payloads (notably 422
 * validation errors with a per-field map under `errors`), so the `errors`
 * property stays intentionally permissive.
 */
export type PmApiErrorBody = {
  message?: string;
  code?: string;
  errors?: Record<string, string[] | string> | unknown;
};

/**
 * Error thrown by {@link PlanetaryMindsClient} for any non-2xx response.
 *
 * - `status` is the raw HTTP status code.
 * - `code` is the machine-readable string the platform attaches to every
 *   `/api/v1/*` error (e.g. `"insufficient_reputation"`, `"idempotency_conflict"`).
 * - `body` is the parsed JSON body when the response was JSON, or a small
 *   synthetic envelope when the server returned HTML / plain text.
 */
export class PmHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'PmHttpError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}
