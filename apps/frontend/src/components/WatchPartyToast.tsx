export type WatchPartyToastData = {
  id: number;
  message: string;
  control?: boolean; // true = "granted"/"revoked" (ember accent, shown a beat longer) — see WatchPage.tsx
};

/** Top-corner, auto-dismissing, never over playback controls, never steals focus — see
 * design.html's "Joins & control changes" notification pattern. Mirrors
 * apps/mobile/lib/widgets/watch_party_toast.dart. */
export default function WatchPartyToastStack({ toasts }: { toasts: WatchPartyToastData[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex flex-col items-end gap-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`max-w-60 rounded-lg border-y border-r border-white/15 bg-surface-hover/95 py-2.5 pl-3 pr-3 text-xs text-white shadow-lg backdrop-blur ${
            toast.control ? "border-l-[3px] border-l-accent" : "border-l-[3px] border-l-text-tertiary"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
