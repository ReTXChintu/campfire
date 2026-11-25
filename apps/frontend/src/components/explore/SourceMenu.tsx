import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { playHref, useTitleSources, type TitleSource } from "../../lib/play";
import type { TmdbRef } from "../../lib/types";

const SAID: Record<TitleSource["result"], { text: string; tone: string }> = {
  found: { text: "Has it", tone: "text-live" },
  none: { text: "Doesn't have it right now", tone: "text-text-tertiary" },
  unreachable: { text: "Didn't answer", tone: "text-amber" },
};

function Choice({ to, name, note, tone }: { to: string; name: string; note: string; tone: string }) {
  return (
    <li>
      <Link
        to={to}
        className="group flex min-h-16 items-center gap-4 rounded-xl border border-divider bg-surface px-4 py-3 transition hover:border-white/40 hover:bg-surface-hover"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black transition group-hover:bg-accent">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <polygon points="8,5 19,12 8,19" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-white">
            <span className="sr-only">Play from </span>
            {name}
          </span>
          <span className={`block text-xs ${tone}`}>{note}</span>
        </span>
      </Link>
    </li>
  );
}

/** What the details' Play button opens: every source, each playing from itself alone, and all of them
 * in order. They're asked about the title as this opens. */
export default function SourceMenu({ title, headingClass }: { title: TmdbRef; headingClass: string }) {
  const { data, isLoading, isError, refetch } = useTitleSources(title);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [data]);

  return (
    <section ref={section} id="detail-sources" aria-labelledby="detail-sources-heading" className="grid scroll-my-6 gap-3">
      <h3 id="detail-sources-heading" className={headingClass}>
        Play from
      </h3>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <Choice to={playHref(title)} name="All sources" note="Tries each one in order" tone="text-text-tertiary" />
        {data?.map((s) => (
          <Choice
            key={s.id}
            to={playHref(title, s.id)}
            name={s.name}
            note={s.needsApp ? "Has it, needs the app" : SAID[s.result].text}
            tone={s.needsApp ? "text-amber" : SAID[s.result].tone}
          />
        ))}
        {isLoading && [0, 1].map((n) => <li key={n} className="skeleton h-16 rounded-xl" />)}
      </ul>
      {isLoading && (
        <p role="status" className="text-sm text-text-secondary">
          Checking every source…
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-danger">
          The sources could not be checked.{" "}
          <button type="button" onClick={() => refetch()} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        </p>
      )}
    </section>
  );
}
