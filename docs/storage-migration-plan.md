# Storage migration plan — single Google Drive → multi-account pool (MEGA / TeraBox / S3)

Status: **proposal, nothing implemented.** Written 2026-11-15.

## 0. TL;DR

1. The expensive, valuable work is **decoupling Campfire from Drive** — a `StorageProvider`
   interface plus a per-video *locator* (`provider`, `accountId`, `remoteId`) and a stable internal
   id that is no longer the Drive file id. That work is identical no matter which backend you pick,
   and it is a prerequisite for *any* multi-account setup.
2. Multi-account **MEGA** is technically workable (the Node SDK supports ranged reads), but on free
   accounts the transfer quota is **per IP, not per account** — roughly 5 GB per ~6 h rolling
   window, and streaming counts against it. Since every byte is served by *your one VPS IP*,
   adding more free MEGA accounts buys you **storage, not bandwidth**. That is the single most
   important fact in this document.
3. **TeraBox has no official API.** Every Node library for it drives the private web endpoints with
   a browser-harvested `ndus`/`jsToken` session, which expires, breaks on deploys, and is against
   their terms. I would not put the library's playback path on it.
4. Recommended shape: keep the pool abstraction, use **MEGA (paid, 1–2 accounts) or S3-compatible
   object storage (Cloudflare R2 / Backblaze B2 / iDrive e2 / Storj) as the hot tier** for anything
   people actually watch, and keep cheap/free accounts (MEGA free, TeraBox, leftover Drive) as a
   **cold archive tier** that gets promoted on demand. The abstraction makes that a config change,
   not a rewrite.

---

## 1. What is coupled to Drive today

| Coupling | Where | Migration impact |
|---|---|---|
| `catalogVideos._id` **is** the Drive file id | `lib/catalogVideos.ts` | **Highest.** Leaks into `/watch/:fileId`, `/api/stream/:fileId`, progress docs, subtitle sets, watch parties, rendition filenames, and client deep links/bookmarks on three apps. |
| `parentFolderId` is a Drive folder id, `env.driveRootFolderId` is the tree root | `lib/catalogFolders.ts`, `catalogScan.ts` | High — the whole catalog IA is "mirror a Drive folder tree". A provider pool has no single tree. |
| Folder-tree scan/discovery (`files.list` paging, `videoMediaMetadata`, `thumbnailLink`) | `lib/drive.ts`, `lib/catalogScan.ts` | High — MEGA gives you a node tree and sizes, but **no server-side duration and no thumbnails**; both must be produced locally with ffmpeg. |
| Byte streaming with HTTP `Range` passthrough | `routes/stream.ts` → `drive.streamFile()` | Medium — maps to MEGA `download({ start, end, maxConnections: 1 })`; see §4.1. |
| **ffmpeg reads an authenticated Drive HTTPS URL directly** (remux, probe, subtitle extract, renditions) | `drive.ts`'s `remuxToMp4`, `probeSource`, `extractSubtitle`, `generateRenditionFile` | **High and easy to miss.** MEGA has no plain URL — content is client-side encrypted. ffmpeg must instead read from *our own* loopback endpoint. See §4.2. |
| Drive-served thumbnails | `routes/thumbnail.ts`, `drive.getThumbnail()` | Medium — must generate and store our own poster/still images. |
| Admin upload/convert pipeline (`stage`, `convert`, `download` routes) | `routes/admin/*`, `lib/staging.ts` | Medium — gains an "upload to which account?" placement decision. |

Everything above is backend-only except the `fileId` in client URLs — which is why §3 keeps those
URLs working.

## 2. Target architecture

### 2.1 `StorageProvider` interface

One module per backend in `apps/backend/src/lib/storage/`:

```
providers/drive.ts   (wraps today's lib/drive.ts — no behaviour change)
providers/mega.ts    (megajs)
providers/s3.ts      (R2 / B2 / e2 / Storj / Wasabi — one impl covers all)
providers/terabox.ts (optional, cold tier only, clearly marked unsupported)
```

Interface (minimum viable surface, derived from the table above):

```ts
type Locator = { provider: "drive" | "mega" | "s3" | "terabox"; accountId: string; remoteId: string };

interface StorageProvider {
  readonly id: string;
  listTree(root: string): AsyncIterable<RemoteNode>;            // for scan/import
  stat(loc: Locator): Promise<{ name: string; size: number; mimeType: string }>;
  openRange(loc: Locator, start?: number, end?: number): Promise<Readable>;  // the hot path
  upload(loc: Omit<Locator, "remoteId">, src: Readable, meta): Promise<string /* remoteId */>;
  delete(loc: Locator): Promise<void>;
  capabilities: { rangeReads: boolean; publicUrl: boolean; serverThumbnails: boolean; durationMeta: boolean };
}
```

`capabilities` is what lets the rest of the backend stop caring which provider it is talking to:
the thumbnail route falls back to local ffmpeg extraction when `serverThumbnails` is false, the
scanner probes for duration when `durationMeta` is false, and so on.

### 2.2 Account pool

New Mongo collection `storageAccounts`:

```
{ _id, provider, label, credentialsRef, status: 'active'|'full'|'readonly'|'disabled',
  quotaBytes, usedBytes, bytesServedWindow, lastErrorAt, lastErrorCode, priority, tier: 'hot'|'cold' }
```

- Credentials live in env / a secrets file, **never** in Mongo — Mongo holds only a reference key
  (`MEGA_ACCOUNT_3_EMAIL` / `_PASSWORD`).
- **Placement policy** on upload: cheapest active account in the target tier with
  `usedBytes + size < quotaBytes * 0.92`, ties broken by `priority`. Never split a single file
  across accounts (no chunk-striping — it multiplies failure modes for no gain here).
- Keep **one series/folder on one account** where it fits, so a season is never half-unavailable.
- `status: 'full'` is set by the uploader, not guessed; `'readonly'`/`'disabled'` are set by the
  health check in §6.

### 2.3 Video identity (the part that must be right)

Stop using the provider id as the primary key:

```
catalogVideos {
  _id: <stable internal id>,       // keep the existing Drive id as the value for migrated rows
  locator: { provider, accountId, remoteId },
  mirrors: [ { provider, accountId, remoteId, verifiedAt } ],   // optional redundancy
  contentHash: "sha256:…",         // the real identity, used for verification + dedupe
  legacyDriveId: string | null,
  sizeBytes, durationSeconds, mimeType, posterPath, …           // unchanged fields
}
```

Reusing the current Drive id **as the value** of `_id` for existing rows is the trick that keeps
every existing URL, bookmark, progress record, subtitle set and watch party working with no
rewrite — the id simply stops *meaning* "Drive file" and becomes an opaque key. New videos get a
fresh ULID. `legacyDriveId` keeps the old mapping for audit and rollback.

## 3. Phases

**Phase 0 — prep (no user-visible change).**
Inventory: count/size/mimetype of every published video (`db.catalogVideos.aggregate`), total bytes,
how much is MKV vs native, how much has renditions. Decide the hot/cold split from *actual* watch
data (`progress` collection) — you will likely find <20 % of titles account for most playback.
Record a `contentHash` for every file by streaming it through sha256 (this is also the migration's
verification baseline; do it before you move anything).

**Phase 1 — abstraction, Drive-only.**
Introduce `StorageProvider`, the `locator` field, and the capability fallbacks. Backfill
`locator = { provider: 'drive', accountId: 'primary', remoteId: _id }` for every row. Ship it.
Nothing has moved yet; if this phase is correct, playback is byte-identical. **This is the phase to
not rush** — it is where regressions would hide.

**Phase 2 — second provider, write path only.**
Implement `providers/mega.ts` (or `s3.ts`) + the account pool + placement policy. Point *new*
admin uploads/conversions at the new provider. Watch the stream path under real use with a handful
of new titles before touching any existing content.

**Phase 3 — backfill worker (the actual migration).**
A resumable queue job per video, modelled on the existing `conversionQueue`/`renditionQueue`
pattern so it inherits the same admin visibility:

```
copy:  openRange(old) → upload(new)      (stream, never buffer whole files; 2–3 concurrent max)
verify: sha256 of the uploaded bytes read back == contentHash   (MEGA's own MAC only validates
        whole-file reads, so read back the complete object once)
flip:  catalogVideos.locator = new;  mirrors += old
cool:  leave the Drive copy in place for N days, then delete on explicit admin confirmation
```

Order: cold/rarely-watched titles first (lowest risk), hot titles last and ideally during a quiet
window. Per-item states `queued → copying → verifying → flipped → source-deleted | failed` with a
retry cap and a resume-from-offset copy. Never delete a source in the same job that flipped the
locator.

**Phase 4 — teardown.**
Once `legacyDriveId` rows are all `source-deleted`, retire the Drive service-account key, drop
`DRIVE_ROOT_FOLDER_ID` from required env, and keep `providers/drive.ts` registered (read-only) for
as long as any mirror still points at it.

Rollback at every phase = set `locator` back to the mirror entry. Which is why the source is
deleted last, by hand, and why `mirrors` exists.

## 4. The two hard technical problems

### 4.1 Range seeking on MEGA

`routes/stream.ts` currently forwards the client's `Range` header to Drive and relays Drive's
`206`. MEGA has no HTTP Range — but the Node SDK takes `start`/`end` on `download()`, and with
`maxConnections: 1` that is effectively a ranged read (the community `megastream` project does
exactly this). So:

- Parse `Range` ourselves, call `openRange(loc, start, end)`, and synthesise the `206` +
  `Content-Range` + `Accept-Ranges: bytes` response. The three clients need no change.
- Every seek opens a **fresh decrypt stream** — expect a seek latency penalty (hundreds of ms)
  versus Drive today, and one MEGA connection per seek. Cache the logged-in SDK session per
  account; do not re-login per request.
- Decryption happens **on your VPS CPU** for every streamed byte. That is new, continuous CPU load
  that Drive never imposed (Drive was a dumb byte relay). Budget for it on a small VPS, and measure
  it in Phase 2 with one real 1080p title before committing.

### 4.2 ffmpeg can no longer read the storage URL

Four call sites hand ffmpeg a `https://www.googleapis.com/drive/v3/files/ID?alt=media` URL plus an
auth header (`remuxToMp4`, `probeSource`, `extractSubtitle`, `generateRenditionFile`). MEGA content
is client-side encrypted, so no such URL exists.

Fix, in order of preference:

1. **Point ffmpeg at our own loopback endpoint** —
   `http://127.0.0.1:${PORT}/api/stream/:id?raw=1` with an internal service media token. One code
   path for every provider, keeps ffmpeg's Range-based seeking (it just becomes our own §4.1 code),
   and S3 providers can later be given a presigned URL instead for a free speedup
   (`capabilities.publicUrl`).
2. Pipe to ffmpeg's stdin — works but **loses seeking**, which breaks `probe`/`extractSubtitle` on
   anything but a linear read. Fallback only.
3. Stage the whole file to local disk first — correct but needs tens of GB of scratch and makes
   playback of a non-native container unusably slow. Only acceptable for the offline convert queue.

Also note: `thumbnail.ts` loses Drive's `thumbnailLink` entirely. Generate a poster with ffmpeg at
curation time (and for the request feature's reference images), store it under a new
`POSTERS_DIR` next to `RENDITIONS_DIR`, and serve it from disk. This is strictly better than today
— it also kills a per-request round trip to Google.

## 5. Provider assessment (be honest about this before committing)

| | MEGA (free ×N) | MEGA (paid) | TeraBox | S3-compatible (R2/B2/e2) |
|---|---|---|---|---|
| Official API | No, unofficial SDK (`megajs`) | same | **No API at all** | Yes, stable, documented |
| Ranged reads | Yes (`start`/`end`) | Yes | Unofficial, fragile | Yes, native HTTP Range |
| Direct URL for ffmpeg | No (encrypted) | No | Sometimes, expiring | Yes (presigned) |
| Transfer quota | **~5 GB / ~6 h per IP — not per account** | Large monthly per account | Undocumented, throttled | Metered; R2 egress is free, B2 free to 3× storage |
| CPU cost to serve | High (decrypt every byte) | High | Medium | ~Zero (byte relay or redirect) |
| ToS risk | Multi-account to dodge quotas is explicitly discouraged; ban risk | Fine | Session-token scraping breaches ToS | None |
| Verdict | **storage only, cold tier** | viable hot tier | **archive at best; do not serve playback** | best hot tier |

The multi-account-free-MEGA plan fails for the one thing you want it for: because the free quota is
IP-scoped and all traffic exits your single VPS, ten free accounts serve no more bytes per day than
one. You would need traffic to exit from different IPs per account — which is exactly the
circumvention MEGA warns gets accounts banned, and it would put the whole library at risk of
disappearing at once.

**What I would actually do:** build §2 (you need it regardless), put the hot tier on Cloudflare R2
(free egress is decisive for a streaming app) or one paid MEGA Pro account, and keep MEGA free
accounts + the existing Drive as the cold archive the backfill worker can promote from. If the
constraint is "no monthly bill at all", then accept the honest trade: free tiers can hold the
library but cannot reliably *serve* it, so expect quota stalls during family movie night.

## 6. Operational additions this needs

- **Health check** per account (cheap `stat` of a canary object) every 15 min → flips
  `status`/`priority`, surfaced on the new admin Overview dashboard (see the UI redesign).
- **Quota telemetry**: record `bytesServedWindow` per account and per IP; a "quota exceeded" error
  from MEGA must degrade gracefully — serve from a mirror if one exists, otherwise show a real
  message ("this title is temporarily unavailable, try again in a few hours"), never a dead player.
- **Admin storage screen**: accounts with used/free bars, per-account video counts, migration queue
  progress, failed-item list with retry, and "promote to hot tier" / "move title" actions.
- **Backup of the metadata**, which is now the irreplaceable part: a nightly `mongodump` of
  `catalogVideos`/`catalogFolders`/`storageAccounts`. Lose the locator map and the files are
  anonymous blobs scattered across accounts.
- **Secrets**: N account credentials in env is unwieldy past ~5 accounts; move to a single JSON
  secrets file (gitignored, 0600) read at startup, shaped `{ accounts: [{ id, provider, ... }] }`.

## 7. Effort estimate (rough, single developer)

| Phase | Work |
|---|---|
| 0 — inventory + content hashes | 0.5 day + hashing runtime |
| 1 — `StorageProvider` abstraction, Drive-only, locator backfill | 2–3 days |
| 2 — MEGA or S3 provider + account pool + placement + §4.1/§4.2 | 3–4 days (MEGA), 1–2 days (S3) |
| 3 — backfill worker + admin migration UI | 2–3 days + transfer wall-clock |
| 4 — teardown + docs | 0.5 day |

Transfer wall-clock is the long pole and is bounded by the *source* quota: pulling the whole library
out of Drive through one VPS is days, not hours, for a multi-TB library. Run it as a low-priority
background queue, not a maintenance window.

## 8. Open questions for you

1. Total library size today, and your real monthly egress? (Decides free-tier viability outright.)
2. Hard "no monthly bill", or is ~$5–10/mo acceptable? (Decides §5's recommendation.)
3. How many concurrent viewers at peak? (Decides whether VPS-side decryption is even feasible.)
4. Keep Drive as a tier, or full exit?
5. Is a title being temporarily unavailable (quota stall) acceptable, or is that a non-starter?
