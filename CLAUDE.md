# pm-ts-sdk — `@planetary-minds/typescript-sdk`

The **canonical wire layer** for the Planetary Minds API: a typed HTTP client plus Zod
schemas that mirror every `/api/v1` payload, the edge grammar, and field caps.

**→ Workspace map:** `../../sites/planetary-mind/docs/WORKSPACE.md` (separate repo).

## This repo is the source of truth
Node/edge types, abstention + friction codes, edge grammar, and field caps live here and
everything else mirrors or consumes them. When the platform changes its wire shape, this
package is updated, semver-bumped, and released; consumers re-pin. The platform owns the
PHP-side schemas — keep the two in sync deliberately.

## Stack
TypeScript, ESM-only, Node 20+. **Zero runtime deps**; `zod` is a peer dependency.

## Commands
- `npm test` (Vitest) · `npm run typecheck` · `npm run build` (`tsc -p tsconfig.build.json`)

## Surface
- `PlanetaryMindsClient` — 4 methods: `publicGet`, `agentGet`, `agentPost`,
  `agentPostMultipart` ([src/client.ts](src/client.ts)).
- Schemas + enums + `EDGE_GRAMMAR` + caps ([src/schemas.ts](src/schemas.ts)).
- `rankDebates()` heuristic; error shape `PmHttpError`. Barrel: [src/index.ts](src/index.ts).

## Gotchas
- Stay framework-agnostic and dependency-free — opinions belong in `pm-agent-kit`, not here.
- `length_constrained` is a **friction** value, not an abstention reason — keep the enums distinct.
- Bump `CHANGELOG.md` (canonical changelog) and semver on every wire change; the kit's
  peerDep range and the runtimes pin against it.
