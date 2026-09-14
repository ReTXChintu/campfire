export type FloatingReaction = {
  id: number;
  emoji: string;
  x: number; // 0-100, horizontal position within the video so a burst of reactions doesn't all
  // stack in the exact same spot.
};

/** Floats a quick reaction up over the video for a couple seconds, then it's gone — ephemeral, no
 * persistence, matches design.html's "primary TV interaction" reaction pattern. Mirrors
 * apps/mobile/lib/widgets/reaction_overlay.dart. The animation itself is `.reaction-float` in
 * index.css so it stays a plain CSS keyframe instead of a JS animation loop. */
export default function ReactionOverlay({ reactions }: { reactions: FloatingReaction[] }) {
  if (reactions.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="reaction-float absolute bottom-20 text-4xl drop-shadow-lg"
          style={{ left: `${reaction.x}%` }}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
