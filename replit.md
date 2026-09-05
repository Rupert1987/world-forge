# World Forge

World Forge converts concept art into evidence-linked, editable 3D world-building hypotheses for Unreal Engine.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/world-forge/src/pages/workspace.tsx` — main analysis workspace, image upload, calibration, validation, and export UI
- `artifacts/world-forge/src/pages/projects.tsx` — project library
- `artifacts/api-server/src/routes/projects.ts` — project, analysis, summary, and Unreal export endpoints
- `lib/api-spec/openapi.yaml` — source of truth for the typed API contract
- `artifacts/world-forge/src/assets/ana-kara.jpg` — initial concept reference

## Architecture decisions

- Projects, completed analyses, confidence and geometry metadata, uploaded views, jobs, and rendered depth previews persist in PostgreSQL; process memory is only a hydrated runtime cache.
- Drizzle schema changes are applied to development by the configured post-merge script. Replit Publish computes and applies the development-to-production schema diff; do not add startup or deploy-time DDL.
- Concept images are sent transiently for analysis and are not stored as base64 in the database.
- Unreal export keeps world measurements in meters in the manifest and makes the centimeter conversion explicit in the generated editor script.
- Single-view depth is treated as an inference with confidence and validation findings rather than as proven geometry.
- Analysis uses two independent model stages: an image-space visual geometry survey followed by a meter-space 3D production hypothesis.
- Dense depth, multi-view solving and image-to-3D generation are separate adapters; no asset generator is treated as the world-layout solver.
- Clerk is retained behind `AUTH_ENABLED=true` (server) and `VITE_AUTH_ENABLED=true` (web). Both default off for single-user local operation; enable both together before commercial use.

## Product

Users can upload a concept image, calibrate map dimensions, run a vision analysis, inspect terrain layers and landmarks, review modular asset assemblies, see build risks, and export an Unreal-ready manifest/script bundle.

See `docs/reconstruction-research.md` for the research basis, source projects, confidence policy and integration priorities.

## User preferences

The user wants high mathematical/geometric precision, modular enterable buildings rather than collapsed single meshes, and reproducible Unreal placement instructions.

## Gotchas

The API client and Zod schemas are generated from `lib/api-spec/openapi.yaml`; rerun API codegen after changing the contract.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
