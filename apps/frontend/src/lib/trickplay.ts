import { useEffect, useState } from "react";
import { apiGet } from "./api";

/** A video's seek-bar previews — see apps/backend/src/lib/trickplay.ts. Frame i shows the video
 * at i × interval seconds, laid out columns × rows to a sheet. */
export type TrickplayManifest = {
  version: 1;
  interval: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  count: number;
  sheets: number;
};

type TrickplayResponse = { status: string; manifest?: TrickplayManifest };

/** The frame at or just before `seconds`: which sheet, and its column and row on it. Kept in step
 * with the apps' TrickplayManifest.tileAt (widgets/trickplay_preview.dart). */
export function tileAt(m: TrickplayManifest, seconds: number): { sheet: number; column: number; row: number } {
  const i = Math.min(m.count - 1, Math.max(0, Math.floor(seconds / m.interval)));
  const perSheet = m.columns * m.rows;
  const within = i % perSheet;
  return { sheet: Math.floor(i / perSheet), column: within % m.columns, row: Math.floor(within / m.columns) };
}

const RETRY_MS = 90_000;
const MAX_TRIES = 8;

/** The ready manifest, or null (always null without a file). The first ask queues the previews on the backend, so while
 * they're being made (a video's first play) this asks again every 90 s. */
export function useTrickplay(fileId: string | null): TrickplayManifest | null {
  const [manifest, setManifest] = useState<TrickplayManifest | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let tries = 0;
    setManifest(null);
    if (!fileId) return;
    const load = () => {
      tries++;
      apiGet<TrickplayResponse>(`/api/trickplay/${encodeURIComponent(fileId)}`)
        .then((res) => {
          if (cancelled) return;
          if (res.manifest) setManifest(res.manifest);
          else if ((res.status === "queued" || res.status === "processing") && tries < MAX_TRIES) {
            timer = window.setTimeout(load, RETRY_MS);
          }
        })
        // Failed, switched off, or an older backend: no previews, the bare time stays.
        .catch(() => {});
    };
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileId]);
  return manifest;
}
