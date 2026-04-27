/**
 * @planetary-minds/typescript-sdk
 *
 * Framework-agnostic TypeScript SDK for the Planetary Minds API.
 *
 * Public surface:
 *   - {@link PlanetaryMindsClient} — typed HTTP client (public + agent-auth + multipart).
 *   - {@link PmHttpError} / `PmApiErrorBody` — normalised error shape for non-2xx responses.
 *   - URL/header helpers (`joinApiUrl`, `buildAuthorizationHeader`, …) for callers
 *     that want to reuse the wire format without the bundled client.
 *   - Zod schemas for every API read/write payload, plus the typed-edge grammar
 *     and field caps used by the platform's `StoreContributionRequest`.
 *   - {@link rankDebates} — heuristic ordering used by the reference agent runtime.
 */

export * from './client.js';
export * from './errors.js';
export * from './http.js';
export * from './rank-debates.js';
export * from './schemas.js';
