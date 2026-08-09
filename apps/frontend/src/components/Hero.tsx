import { Link } from "react-router-dom";

export default function Hero({
  title,
  badge,
  playHref,
  infoHref,
}: {
  title: string;
  badge?: string;
  playHref: string;
  infoHref?: string | null;
}) {
  return (
    <div
      className="relative flex h-[70vh] min-h-[460px] w-full items-end"
      style={{
        background: "radial-gradient(circle at 75% 30%, #3a1a12 0%, #1a0e12 40%, #0A0B0F 75%)",
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
      <div className="relative z-10 max-w-xl px-4 pb-14 sm:px-6 sm:pb-20">
        {badge && (
          <div className="mb-4 inline-flex items-center gap-2 rounded border border-amber/30 bg-amber/10 px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-amber">
            {badge}
          </div>
        )}
        <h1 className="mb-6 font-display text-6xl leading-[0.9] tracking-wide text-white sm:text-8xl">
          {title}
        </h1>
        <div className="flex gap-3">
          <Link
            to={playHref}
            className="flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/90"
          >
            ▶ Play
          </Link>
          {infoHref && (
            <Link
              to={infoHref}
              className="flex items-center gap-2 rounded-md border border-white/15 bg-white/10 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/15"
            >
              More Info
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
