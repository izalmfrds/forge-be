# Forge Backend

Node.js + TypeScript API for `forge-fe`. It runs as a single Express Vercel Function and persists data in PostgreSQL through Prisma.

## Stack

- Node.js 20+
- TypeScript 5
- Express 4
- Prisma 5
- PostgreSQL (Neon recommended)
- JWT authentication
- Zod request validation
- Vercel Functions

This stack can be started on free plans for personal/prototype use: [Vercel Hobby](https://vercel.com/docs/plans/hobby) for compute and [Neon Free Plan](https://neon.com/pricing) for serverless PostgreSQL. Provider limits and eligibility can change, so review their current terms before production use.

## Implemented APIs

| Area | Endpoints |
|---|---|
| Health | `GET /`, `GET /health` |
| Auth | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` |
| Projects | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`, `POST /api/projects/:id/members` |
| Requirements | `GET/POST /api/projects/:id/requirement`, `POST /api/projects/:id/requirement/send-to-kanban` |
| Kanban | `GET /api/projects/:id/kanban`, `POST /api/projects/:id/kanban/sync`, CRUD under `/api/kanban/cards` |
| Screens | list/create under `/api/projects/:id/screens`; screen, nodes, guides, and history under `/api/screens` |
| AI Workspace | `POST /api/ai/chat`, `POST /api/ai/generate-requirement` |
| Search | `GET /api/search?q=...&projectId=...` |
| Export | `GET /api/projects/:id/export?format=json` |

Every endpoint under `/api`, except `/api/auth/*`, requires:

```http
Authorization: Bearer <JWT>
```

Project authorization uses the `owner`, `editor`, `member`, and `viewer` membership roles.

## Local setup

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
npm run prisma:seed
npm run dev
```

The API starts on `http://localhost:4000`.

Default seed credentials are only for local development:

```text
demo@forge.local
forge-demo-123
```

Change or omit `SEED_USER_PASSWORD` outside local development.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `DATABASE_URL` | yes | Pooled PostgreSQL URL used by serverless runtime |
| `DIRECT_URL` | yes | Direct PostgreSQL URL used for migrations |
| `JWT_SECRET` | yes | Long random secret used to sign access tokens |
| `FRONTEND_URL` | yes | Comma-separated allowed CORS origins |
| `AI_RATE_LIMIT_PER_MINUTE` | no | Per-instance AI request limit; defaults to 20 |
| `GEMINI_API_KEY` | for Gemini | Server-only key created in Google AI Studio |
| `GEMINI_MODEL` | no | Defaults to the free-tier-friendly `gemini-2.5-flash-lite` |
| `GEMINI_TIMEOUT_MS` | no | Provider request timeout; defaults to 45 seconds |
| `AI_FALLBACK_MODE` | no | Falls back to the local engine when Gemini fails if set to `true` |
| `ALLOW_CLIENT_MODEL_OVERRIDE` | no | Allows only models listed in `GEMINI_ALLOWED_MODELS` |
| `AUTH_DISABLED` | no | Local-only auth bypass; ignored by convention in production |

Generate a JWT secret:

```bash
openssl rand -base64 48
```

## AI behavior and secrets

`/api/ai/*` uses Gemini when `GEMINI_API_KEY` is configured. The backend sends the prompt, project name/type/description, recent chat context, and current requirement to Gemini. It requests a structured JSON result, validates that result with Zod, and only then persists a new requirement version.

If Gemini is not configured—or it fails while `AI_FALLBACK_MODE=true`—the deterministic local requirement engine remains available. Responses expose `mode: "gemini"` or `mode: "local"` so the frontend can show the actual execution mode.

Create a key in [Google AI Studio](https://aistudio.google.com/apikey), then add it only to the backend `.env` and Vercel Environment Variables. Never prefix it with `NEXT_PUBLIC_` or send it from the browser. Gemini free-tier content may be used by Google to improve its products; review the current [Gemini API pricing and data-use table](https://ai.google.dev/gemini-api/docs/pricing) before sending production or confidential data.

## Deploy to Vercel

Panduan deployment end-to-end tersedia di [`DEPLOYMENT.md`](./DEPLOYMENT.md).

1. Create a free Neon PostgreSQL project.
2. Copy the pooled URL to `DATABASE_URL` and direct URL to `DIRECT_URL`.
3. Run `npx prisma migrate deploy` against the production database.
4. Import the `forge-be` repository in Vercel.
5. Add `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `FRONTEND_URL`, and `GEMINI_API_KEY` to Vercel Environment Variables.
6. Deploy. Vercel routes all requests to `api/index.ts`.
7. Set the frontend API base URL to the resulting Vercel deployment URL.

Database and function regions should be close to reduce latency. Use the pooled Neon URL for serverless requests.

## Validation

```bash
npm run check
npm test
npm run build
```

`npm run check` validates the Prisma schema and TypeScript without emitting files.
