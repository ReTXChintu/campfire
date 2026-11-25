import type { PlayerFeatures, PlayerOption, VideoResponse } from "./types";

export const ALL_FEATURES: PlayerFeatures = {
  autoplay: true,
  exit: true,
  pip: true,
  sourceMenu: true,
  captions: true,
  quality: true,
  volume: true,
  fullscreen: true,
  settings: true,
};

/** How a title plays from each source. An older backend sends only the embedded ones, or nothing. */
export function webPlayers(video: VideoResponse): PlayerOption[] {
  return (
    video.players ?? [
      ...(video.embeds ?? []).map((e, i) => ({ id: `embed-${i}`, kind: "embed" as const, name: e.provider, url: e.url })),
      { id: "drive", kind: "drive" as const, name: "Drive", features: ALL_FEATURES },
    ]
  );
}
