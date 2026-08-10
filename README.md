# Campfire

A personal streaming and watch party app that lists and streams videos from a single Google Drive folder. Subfolders inside the root folder are treated as series/playlists with ordered episodes and autoplay-next. Any Google account can sign in; per-user watch progress is stored in MongoDB.

Monorepo: `apps/frontend` (Vite + React SPA, deploys as a static site), `apps/backend` (Express + TypeScript, runs on a VPS — it needs a persistent process for `ffmpeg` and Drive streaming, which serverless functions can't provide), and `apps/mobile` (Flutter, Android/iOS — same design, no admin screens; see `apps/mobile/README.md`).

## How it works

Two separate Google credentials are used, on purpose:

1. **OAuth Web Client** — used only for login (identity), via Passport's Google strategy. This is what lets any Google account sign in to the app.
2. **Service Account** — used only server-side to call the Drive API (listing, streaming, thumbnails). Service accounts have no storage quota of their own, so the target Drive folder only needs to be shared with the service account's email as **Viewer** — the app never writes to Drive. New content is uploaded by hand through Drive's own UI; the admin **Converter** page is a local convert-and-download tool (device → server → browser-native MP4 download), not a Drive uploader.

## Google Cloud setup

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com/) → New Project.
2. **Enable the Drive API**: APIs & Services → Library → search "Google Drive API" → Enable.
3. **Configure the OAuth consent screen**: APIs & Services → OAuth consent screen → User type **External** → fill in app name / support email / developer email → only default non-sensitive scopes are used, so no Google verification is required → once set up, click **Publish App** (Testing → Production) so any Google account can sign in, not just added test users.
4. **Create the OAuth Web Client** (login only): Credentials → Create Credentials → OAuth client ID → Web application → add authorized redirect URIs:
   - Dev: `http://localhost:4000/auth/google/callback`
   - Prod: `https://<your-backend-domain>/auth/google/callback` (can be added later without recreating the client)
   Copy the Client ID and Client Secret.
5. **Create a Service Account** (Drive access): Credentials → Create Credentials → Service account (e.g. `drive-reader`, no project IAM roles needed) → Keys tab → Add Key → JSON → download. Treat this file as a secret — never commit it.
6. **Share the target Drive folder** with the service account's `client_email` (found in the downloaded JSON) as **Viewer**.
7. **Get the folder ID**: from the folder's URL, `https://drive.google.com/drive/folders/<FOLDER_ID>` — the trailing segment is your `DRIVE_ROOT_FOLDER_ID`.

## Environment variables

Copy `apps/backend/.env.example` to `apps/backend/.env` and fill in:

```
PORT=4000

GOOGLE_CLIENT_ID=                     # OAuth Web Client ID (step 4)
GOOGLE_CLIENT_SECRET=                 # OAuth Web Client Secret (step 4)
AUTH_CALLBACK_URL=http://localhost:4000/auth/google/callback
FRONTEND_URL=http://localhost:5173    # your deployed frontend URL in prod

AUTH_JWT_SECRET=                      # openssl rand -base64 32
MEDIA_TOKEN_SECRET=                   # openssl rand -base64 32 (a different secret from the above)

MONGODB_URI=                          # your MongoDB connection string
MONGODB_DB_NAME=stream

GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=    # base64 of the entire downloaded service-account JSON file
                                       # e.g. `base64 -w0 service-account.json`

DRIVE_ROOT_FOLDER_ID=                 # target folder id (step 7)

ADMIN_EMAILS=                         # comma-separated Google account emails allowed to use /admin
```

And copy `apps/frontend/.env.example` to `apps/frontend/.env`:

```
VITE_API_URL=http://localhost:4000    # your deployed backend URL in prod
```

## Admin Converter

Accounts listed in `ADMIN_EMAILS` can visit `/admin` to convert a video from their own device into a browser-native MP4 entirely on the server (no Drive round trip for the source file), then download the result and upload it to the Drive folder by hand. `ffprobe` runs once during staging so the admin can pick an audio track and see real track info before converting; extracted subtitle tracks are saved and can be linked to a catalog video afterwards without re-uploading them.

## Content conventions

- Videos at the top level of the root folder show up as standalone videos.
- Any subfolder is browsable and can contain a mix of videos and further subfolders, nested as deeply as you like (e.g. `Campfire / House of the Dragon / Season 1 / episode files`).
- Within any single folder, videos are ordered by natural filename sort. Zero-pad episode numbers (`01`, `02`, … `10`) for correct ordering.
- Autoplay-next only chains between videos that sit directly in the *same* folder (e.g. within `Season 1`) — it does not jump across sibling subfolders (e.g. from the last episode of Season 1 into Season 2).
- Drop a `thumbnail.jpg`/`.jpeg`/`.png` file directly into a series/season folder in Drive to set its poster image — picked up on the next admin Scan.

## Running locally

Requires `ffmpeg`/`ffprobe` on PATH for the backend.

```bash
npm install
npm run dev
```

This runs both `apps/backend` (http://localhost:4000) and `apps/frontend` (http://localhost:5173) in parallel via `concurrently`. Open the frontend URL.

## Mobile app

`apps/mobile` is a separate Flutter app (Android/iOS), not an npm workspace — see `apps/mobile/README.md` for its own setup (it needs its own Google OAuth client per platform). It mirrors the web app's screens and dark theme but has **no admin UI at all**; the Converter and Catalog stay web-only.

## Deployment

- **Frontend**: static build (`apps/frontend/dist`) — deploy to Netlify/Vercel/any static host. `netlify.toml` at the repo root is already configured for this (build command runs from the repo root via the npm workspace).
- **Backend**: needs a real, persistent Node process — deploy to a VPS (`npm run build --workspace=apps/backend` then `npm start --workspace=apps/backend`, behind a process manager like pm2 and a reverse proxy for TLS).
- **Mobile**: `flutter build apk` / `flutter build ipa` from `apps/mobile`, pointed at the production backend via `--dart-define=API_URL=...`, then distributed through the Play Store / App Store / TestFlight as usual — no CI wiring for this is set up yet.

## Releasing

`npm run release` (wraps `release-it`) bumps the version in the root `package.json`, both `apps/*/package.json` (backend + frontend), and `apps/mobile/pubspec.yaml` (via `scripts/sync-mobile-version.mjs`, since Flutter isn't an npm package) together in a single commit + tag.
