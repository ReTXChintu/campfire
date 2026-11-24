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

/** Every way this page can play a title, in the order to try them. Drive goes last when it's a file
 * a browser can't play: what it then shows is where to get the app. */
export function webPlayers(video: VideoResponse): PlayerOption[] {
  // An older backend sends only the embedded ones, or nothing.
  const all: PlayerOption[] = video.players ?? [
    ...(video.embeds ?? []).map((e, i) => ({ id: `embed-${i}`, kind: "embed" as const, name: e.provider, url: e.url })),
    { id: "drive", kind: "drive" as const, name: "Library", features: ALL_FEATURES },
  ];
  if (video.seekMode === "native") return all;
  return [...all.filter((p) => p.kind !== "drive"), ...all.filter((p) => p.kind === "drive")];
}

/** The one to play now: what the viewer picked, else the first that hasn't failed. With nothing
 * left, Drive again — its own player says what's wrong. */
export function currentPlayer(players: PlayerOption[], failed: string[], chosen: string | null): PlayerOption {
  return (
    players.find((p) => p.id === chosen) ??
    players.find((p) => !failed.includes(p.id)) ??
    players.find((p) => p.kind === "drive") ??
    players[players.length - 1]
  );
}
