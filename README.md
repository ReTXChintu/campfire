# Campfire

A personal Next.js streaming and watch party app that lists and streams videos from a single Google Drive folder. Subfolders inside the root folder are treated as series/playlists with ordered episodes and autoplay-next. Any Google account can sign in; per-user watch progress is stored in MongoDB.

## How it works

Two separate Google credentials are used, on purpose:

1. **OAuth Web Client** — used only for login (identity), via NextAuth's Google provider. This is what lets any Google account sign in to the app.
2. **Service Account** — used only server-side to call the Drive API (listing, streaming, thumbnails, and — for admins — uploading). The target Drive folder is shared with the service account's email as **Editor** (needs write access for the admin upload feature; read-only Viewer access is not enough), so signed-in users never need their own Drive access.

## Google Cloud setup

1. **Create a project** at [console.cloud.google.com](https://console.cloud.google.com/) → New Project.
2. **Enable the Drive API**: APIs & Services → Library → search "Google Drive API" → Enable.
3. **Configure the OAuth consent screen**: APIs & Services → OAuth consent screen → User type **External** → fill in app name / support email / developer email → only default non-sensitive scopes are used, so no Google verification is required → once set up, click **Publish App** (Testing → Production) so any Google account can sign in, not just added test users.
4. **Create the OAuth Web Client** (login only): Credentials → Create Credentials → OAuth client ID → Web application → add authorized redirect URIs:
   - Dev: `http://localhost:3000/api/auth/callback/google`
   - Prod: `https://<your-domain>/api/auth/callback/google` (can be added later without recreating the client)
   Copy the Client ID and Client Secret.
5. **Create a Service Account** (Drive access): Credentials → Create Credentials → Service account (e.g. `drive-reader`, no project IAM roles needed) → Keys tab → Add Key → JSON → download. Treat this file as a secret — never commit it.
6. **Share the target Drive folder** with the service account's `client_email` (found in the downloaded JSON) as **Editor** (Content manager) — Viewer isn't enough once the admin upload feature is used, since it needs write access to create files/folders.
7. **Get the folder ID**: from the folder's URL, `https://drive.google.com/drive/folders/<FOLDER_ID>` — the trailing segment is your `DRIVE_ROOT_FOLDER_ID`.

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
AUTH_SECRET=                          # openssl rand -base64 32
AUTH_GOOGLE_ID=                       # OAuth Web Client ID (step 4)
AUTH_GOOGLE_SECRET=                   # OAuth Web Client Secret (step 4)
AUTH_URL=http://localhost:3000        # your prod URL when deployed
AUTH_TRUST_HOST=true                  # needed when self-hosting (not required on Vercel)

MONGODB_URI=                          # your MongoDB connection string
MONGODB_DB_NAME=stream

GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=    # base64 of the entire downloaded service-account JSON file
                                       # e.g. `base64 -w0 service-account.json`

DRIVE_ROOT_FOLDER_ID=                 # target folder id (step 7)

ADMIN_EMAILS=                         # comma-separated Google account emails allowed to use /admin (upload)
```

## Admin upload

Accounts listed in `ADMIN_EMAILS` can visit `/admin` to upload a video directly into the Drive folder (standalone, an existing series, or a newly created series) from the browser — no more uploading by hand through Drive's own UI. After the file lands on Drive, the app runs `ffprobe` once and caches the real duration and audio/subtitle track info in MongoDB, so watching that video skips the slower live-probe path other content still uses. Uploads are a single streamed request (not resumable) — a dropped connection on a large file needs to be retried from the start.

## Content conventions

- Videos at the top level of the root folder show up as standalone videos.
- Any subfolder is browsable and can contain a mix of videos and further subfolders, nested as deeply as you like (e.g. `Stream / House of the Dragon / Season 1 / episode files`).
- Within any single folder, videos are ordered by Drive's natural filename sort. Zero-pad episode numbers (`01`, `02`, … `10`) for correct ordering.
- Autoplay-next only chains between videos that sit directly in the *same* folder (e.g. within `Season 1`) — it does not jump across sibling subfolders (e.g. from the last episode of Season 1 into Season 2).

## Running locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
