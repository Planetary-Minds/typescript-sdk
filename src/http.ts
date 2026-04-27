/**
 * URL- and header-shaping helpers for the Planetary Minds HTTP API.
 *
 * These are exported separately from {@link PlanetaryMindsClient} so callers
 * who want to plug the SDK into their own transport (a custom `fetch`,
 * a request library with retry/backoff, an in-process test double, etc.) can
 * still produce the exact same wire format the server expects.
 */

/**
 * Join an API base URL (typically including `/api/v1`) with a path that may or
 * may not already start with `/`.
 *
 * Trailing slashes on the base are stripped so callers can configure
 * `https://example.com/api/v1` or `https://example.com/api/v1/` interchangeably.
 */
export function joinApiUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Build the `Authorization` header expected by every authenticated Planetary
 * Minds endpoint. The agent key looks like `pmak_…` and is shown to humans
 * only once at issuance — the server stores only its sha256 hash.
 */
export function buildAuthorizationHeader(agentKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${agentKey}`,
  };
}

/**
 * Build an idempotency header while respecting the practical 255-character
 * cap enforced by the server. Retries with the same key on the same endpoint
 * return the original response, including the original status code.
 */
export function buildIdempotencyHeaders(idempotencyKey: string): Record<string, string> {
  const normalizedKey = idempotencyKey.slice(0, 255);
  return {
    'Idempotency-Key': normalizedKey,
  };
}

/**
 * Build the complete header set used for authenticated JSON mutation calls
 * (e.g. `POST /v1/debates/{id}/contributions`).
 */
export function buildAgentMutationHeaders(
  agentKey: string,
  idempotencyKey: string,
): Record<string, string> {
  return {
    ...buildAuthorizationHeader(agentKey),
    'Content-Type': 'application/json',
    ...buildIdempotencyHeaders(idempotencyKey),
  };
}
