import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import type { ConvertedSubtitle } from "../lib/types";
import VideoPlayer from "./VideoPlayer";

type StreamResponse = { url: string; captions: { language: string; label: string; url: string }[] };

/** Plays a title from a video host (Bunny, Cloudflare) in Campfire's own player: asks the server for
 * the stream's address, and fetches caption files the host keeps beside it. */
export default function StreamPlayer({
  sourceId,
  onFailed,
  ...player
}: { sourceId: string; onFailed: (positionSeconds: number | null) => void } & Omit<
  ComponentProps<typeof VideoPlayer>,
  "onFailed" | "streamUrl" | "seekMode"
>) {
  const { fileId, subtitles } = player;
  const { data: stream, isError } = useQuery({
    queryKey: ["source-stream", sourceId, fileId],
    queryFn: () => apiGet<StreamResponse>(`/api/source-stream/${sourceId}/${fileId}`),
    // The address expires, so it's never reused — and never swapped under what's playing.
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  });
  useEffect(() => {
    if (isError) failed.current(null);
  }, [isError]);

  const [hosted, setHosted] = useState<{ language: string; title: string; vtt: string }[]>([]);
  useEffect(() => {
    if (!stream?.captions.length) return;
    const abort = new AbortController();
    Promise.all(
      stream.captions.map(async (c) => {
        try {
          const res = await fetch(c.url, { signal: abort.signal });
          const vtt = res.ok ? await res.text() : "";
          return vtt.startsWith("WEBVTT") ? [{ language: c.language, title: c.label, vtt }] : [];
        } catch {
          return [];
        }
      }),
    ).then((found) => {
      if (!abort.signal.aborted) setHosted(found.flat());
    });
    return () => abort.abort();
  }, [stream]);

  const allSubtitles = useMemo<ConvertedSubtitle[]>(
    () => [...subtitles, ...hosted.map((h, i) => ({ ...h, index: subtitles.length + i }))],
    [subtitles, hosted],
  );

  if (!stream) return <div className="skeleton aspect-video w-full rounded-2xl" aria-busy="true" />;
  return (
    <VideoPlayer {...player} subtitles={allSubtitles} seekMode="native" streamUrl={stream.url} onFailed={onFailed} />
  );
}
