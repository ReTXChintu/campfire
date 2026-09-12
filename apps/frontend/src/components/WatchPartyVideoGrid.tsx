import { GridLayout, ParticipantTile, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

/** Camera tiles for whoever currently has their camera on — renders nothing when nobody does, so
 * a voice-only party (today's default, camera starts off) doesn't reserve empty video space. Must
 * be rendered inside a RoomContext.Provider (see WatchPage.tsx). */
export default function WatchPartyVideoGrid() {
  const tracks = useTracks([Track.Source.Camera]);
  if (tracks.length === 0) return null;

  return (
    <div className="h-56 overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <GridLayout tracks={tracks}>
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}
