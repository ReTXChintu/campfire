/** Explains the "locked" (no playback control) watch-party state in the chrome itself, instead of
 * just silently greying out the seek/skip/speed controls — see design.html's lock-banner
 * component. Mirrors apps/mobile/lib/widgets/lock_banner.dart.
 *
 * Doesn't know *who* currently holds control by name — the watch-party roster only carries a
 * device label (see lib/types.ts's WatchPartyParticipant), not the account's display name, so this
 * stays deliberately generic rather than fabricating one. */
export default function LockBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border-y border-r border-white/15 border-l-[3px] border-l-danger bg-surface-hover/90 px-3.5 py-2.5 text-xs text-white">
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-danger" fill="currentColor">
        <path d="M17 9V7a5 5 0 0 0-10 0v2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2Zm-8-2a3 3 0 0 1 6 0v2H9Z" />
      </svg>
      <div>
        <p className="font-semibold">Someone else has the remote</p>
        <p className="mt-0.5 text-white/60">You can watch, chat, and talk — ask them to hand it over.</p>
      </div>
    </div>
  );
}
