# Campfire

A personal streaming and watch party app that lists and streams videos from a single Google Drive folder. Subfolders inside the root folder are treated as series/playlists with ordered episodes and autoplay-next. Email/password login with open signup (one seeded admin account, everyone else signs up); per-user watch progress is stored in MongoDB.

Monorepo: `apps/frontend` (Vite + React SPA, deploys as a static site), `apps/backend` (Express + TypeScript, runs on a VPS — it needs a persistent process for `ffmpeg` and Drive streaming, which serverless functions can't provide), and `apps/mobile` (Flutter, Android/iOS — same design, no admin screens; see `apps/mobile/README.md`).

## How it works

- **Login**: no OAuth — plain email/password. One admin account is seeded into Mongo from `ADMIN_EMAIL`/`ADMIN_PASSWORD` on every backend startup (edit those two vars and restart the backend to change the password); anyone else can sign up for their own account from the login screen, same as the old "any Google account can sign in" behavior, just with a password instead of an OAuth handshake. Signup never grants admin — only the seeded `ADMIN_EMAIL` account gets the admin UI.
- **Google Drive access**: server-side only, via a Service Account (`GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`) — unrelated to login. Service accounts have no storage quota of their own, so the target Drive folder only needs to be shared with the service account's email as **Viewer**; the app never writes to Drive. New content is uploaded by hand through Drive's own UI; the admin **Converter** page is a local convert-and-download tool (device → server → browser-native MP4 download), not a Drive uploader.

## Google Cloud setup (Drive access only)

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com/) → New Project.
2. **Enable the Drive API**: APIs & Services → Library → search "Google Drive API" → Enable.
3. **Create a Service Account**: Credentials → Create Credentials → Service account (e.g. `drive-reader`, no project IAM roles needed) → Keys tab → Add Key → JSON → download. Treat this file as a secret — never commit it.
4. **Share the target Drive folder** with the service account's `client_email` (found in the downloaded JSON) as **Viewer**.
5. **Get the folder ID**: from the folder's URL, `https://drive.google.com/drive/folders/<FOLDER_ID>` — the trailing segment is your `DRIVE_ROOT_FOLDER_ID`.

## Environment variables

Copy `apps/backend/.env.example` to `apps/backend/.env` and fill in:

```
PORT=4000

FRONTEND_URL=http://localhost:5173    # your deployed frontend URL in prod

ADMIN_EMAIL=                          # the one account this app has
ADMIN_PASSWORD=                       # change this and restart the backend to rotate it

AUTH_JWT_SECRET=                      # openssl rand -base64 32
MEDIA_TOKEN_SECRET=                   # openssl rand -base64 32 (a different secret from the above)

MONGODB_URI=                          # your MongoDB connection string
MONGODB_DB_NAME=stream

GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=    # base64 of the entire downloaded service-account JSON file
                                       # e.g. `base64 -w0 service-account.json`

DRIVE_ROOT_FOLDER_ID=                 # target folder id (Google Cloud setup, step 5)
```

And copy `apps/frontend/.env.example` to `apps/frontend/.env`:

```
VITE_API_URL=http://localhost:4000    # your deployed backend URL in prod
```

## Admin Converter

The seeded `ADMIN_EMAIL` account can visit `/admin` to convert a video from their own device into a browser-native MP4 entirely on the server (no Drive round trip for the source file), then download the result and upload it to the Drive folder by hand. `ffprobe` runs once during staging so the admin can pick an audio track and see real track info before converting; extracted subtitle tracks are saved and can be linked to a catalog video afterwards without re-uploading them.

## Content conventions

- Videos at the top level of the root folder show up as standalone videos.
- Any subfolder is browsable and can contain a mix of videos and further subfolders, nested as deeply as you like (e.g. `Campfire / House of the Dragon / Season 1 / episode files`).
- Within any single folder, videos are ordered by natural filename sort. Zero-pad episode numbers (`01`, `02`, … `10`) for correct ordering.
- Autoplay-next only chains between videos that sit directly in the *same* folder (e.g. within `Season 1`) — it does not jump across sibling subfolders (e.g. from the last episode of Season 1 into Season 2).
- Drop a `thumbnail.jpg`/`.jpeg`/`.png` file directly into a series/season folder in Drive to set its poster image — picked up on the next admin Scan.

## Running locally

Requires `ffmpeg`/`ffprobe` on PATH for the backend (or set `FFMPEG_PATH`/`FFPROBE_PATH` in `apps/backend/.env` to their absolute paths — see that file's `.env.example`. If you see `spawn ffmpeg ENOENT` in the logs or as an API error, this is why: it's almost always PATH not resolving the binary in whatever process actually started the backend, which is especially easy to hit under pm2, since its daemon's PATH doesn't always match your interactive shell's).

```bash
npm install
npm run dev
```

This runs both `apps/backend` (http://localhost:4000) and `apps/frontend` (http://localhost:5173) in parallel via `concurrently`. Open the frontend URL and sign in with `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## Mobile app

`apps/mobile` is a separate Flutter app (Android/iOS), not an npm workspace — see `apps/mobile/README.md` for its own setup. It mirrors the web app's screens, dark theme, and email/password login, but has **no admin UI at all**; the Converter and Catalog stay web-only.

## Deployment

### Option A — Netlify/Vercel (frontend) + your own VPS (backend)

- **Frontend**: static build (`apps/frontend/dist`) — deploy to Netlify/Vercel/any static host. `netlify.toml` at the repo root is already configured for this (build command runs from the repo root via the npm workspace).
- **Backend**: needs a real, persistent Node process — deploy to a VPS (`npm run build --workspace=apps/backend` then `npm start --workspace=apps/backend`, behind a process manager and a reverse proxy for TLS).

### Option B — both on one VPS via pm2, over `https://<IP>:<PORT>` (no domain/reverse proxy)

Root `.env` (copy from `.env.example`) controls this — separate from `apps/backend/.env` and `apps/frontend/.env`, which still hold each app's own secrets:

```
SERVER_IP=203.0.113.10   # your VPS's public IP
BACKEND_PORT=50001
FRONTEND_PORT=50000
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
```

1. Point `apps/backend/.env`'s `FRONTEND_URL` at `https://<SERVER_IP>:<FRONTEND_PORT>` and `apps/frontend/.env`'s `VITE_API_URL` at `https://<SERVER_IP>:<BACKEND_PORT>` (the frontend one has to be set *before* building — it's baked into the static JS bundle, pm2 can't override it at runtime).
2. Generate a self-signed cert (browsers will warn on first visit — expected for an IP address with no real CA): `npm run deploy:certs` (reads `SERVER_IP` from `.env`, or pass an IP directly: `./scripts/generate-self-signed-cert.sh <ip>`). This also copies the public cert into `apps/mobile` — see that app's README if you're building the mobile app too, since native Android/iOS networking can't click through a self-signed-cert warning the way a browser can.
3. Build both apps: `npm run build`.
4. `npm run deploy:start` (wraps `pm2 start ecosystem.config.js`) — starts `campfire-backend` serving the API and `campfire-frontend` serving the static build, both over HTTPS with the generated cert, on the ports from `.env`. `npm run deploy:stop` / `deploy:restart` / `deploy:logs` manage them the same way; `pm2 save && pm2 startup` (run manually, not wrapped) makes them survive a reboot.

Without `SSL_CERT_PATH`/`SSL_KEY_PATH` set, both apps fall back to plain HTTP — that's what local dev already uses.

### Mobile

`flutter build apk` / `flutter build ipa` from `apps/mobile`, pointed at the production backend via `--dart-define=API_URL=...`, then distributed through the Play Store / App Store / TestFlight, or a direct download link — set `VITE_MOBILE_APP_DOWNLOAD_URL` in `apps/frontend/.env` to show a "Get the App" button in the web app's top bar linking to it. No CI wiring for building/publishing the mobile app is set up yet. If the backend uses the self-signed cert (Option B above), see `apps/mobile/README.md`'s certificate-trust section first — the app needs the cert bundled in to reach the backend at all, and iOS video playback specifically won't work against a self-signed cert regardless.

## Releasing

`npm run release` (wraps `release-it`) bumps the version in the root `package.json`, both `apps/*/package.json` (backend + frontend), and `apps/mobile/pubspec.yaml` (via `scripts/sync-mobile-version.mjs`, since Flutter isn't an npm package) together in a single commit + tag.
