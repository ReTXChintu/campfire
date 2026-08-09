# Campfire — monorepo

npm workspaces: `apps/frontend` (Vite + React SPA) and `apps/backend` (Express + TypeScript, compiled to `dist/` and run with plain `node`, no framework magic).

- Root scripts (`npm run dev` / `build` / `lint`) fan out to both workspaces — see root `package.json`.
- `release-it` runs from the repo root only; it bumps root + both `apps/*/package.json` together in one commit/tag (see `.release-it.json`'s `after:bump` hook).
- Auth is Passport (Google OAuth) + a self-issued JWT, sent as `Authorization: Bearer` from the frontend — not cookies, since the two apps are cross-origin in production (static frontend on Netlify/Vercel, backend on a VPS). `<video>`/`<img>` tags that can't set that header use a separately-scoped, short-lived media token instead (`GET /api/media-token`); see `apps/backend/src/middleware/mediaAuth.ts`.
- The backend is the only thing that touches `ffmpeg`/Google Drive; it needs a persistent process (VPS), not a serverless function — that's the whole reason this was split out of the previous single Next.js app.
