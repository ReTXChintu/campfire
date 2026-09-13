import { GridLayout, ParticipantTile, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

/** Camera tiles for whoever currently has their camera on — renders nothing when nobody does, so
 * a voice-only party (today's default, camera starts off) doesn't reserve empty video space. Floats
 * as a small strip over the top-right of the video itself (see design.html) rather than sitting in
 * its own row below it. Must be rendered inside a RoomContext.Provider (see WatchPage.tsx). */
export default function WatchPartyVideoGrid() {
  const tracks = useTracks([Track.Source.Camera]);
  if (tracks.length === 0) return null;

  return (
    <div className="flex h-24 gap-1.5 overflow-x-auto sm:h-28">
      {tracks.map((track) => (
        <div
          key={`${track.participant.identity}-${track.source}`}
          className="aspect-video h-full shrink-0 overflow-hidden rounded-lg border border-white/15 bg-black/60 shadow-lg"
        >
          <GridLayout tracks={[track]}>
            <ParticipantTile />
          </GridLayout>
        </div>
      ))}
    </div>
  );
}
