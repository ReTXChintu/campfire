import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { playHref, useSources } from "../../lib/play";
import type { TmdbRef } from "../../lib/types";
import { Skeleton } from "../ui/States";
import { SOURCE_CHOICE, SourceChoiceLabel } from "../SourceChoice";

/** What a Play button opens: the sources added in admin, each playing the title from itself. */
export default function SourceMenu({ title, headingClass }: { title: TmdbRef; headingClass?: string }) {
  const { data, isLoading, isError, refetch } = useSources();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [data]);

  return (
    <section ref={section} aria-label="Play from" className="grid scroll-my-6 gap-3">
      {headingClass && <h3 className={headingClass}>Play from</h3>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {data?.map((source) => (
          <li key={source.id}>
            <Link to={playHref(title, source.id)} className={SOURCE_CHOICE}>
              <SourceChoiceLabel name={source.name} />
            </Link>
          </li>
        ))}
        {isLoading && (
          <li>
            <Skeleton className="h-16 w-full" />
          </li>
        )}
      </ul>
      {isError && (
        <p role="alert" className="text-sm text-danger">
          The sources did not load.{" "}
          <button type="button" onClick={() => refetch()} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        </p>
      )}
    </section>
  );
}
