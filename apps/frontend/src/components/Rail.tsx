import { Link } from "react-router-dom";
import type { ReactNode } from "react";

export default function Rail({
  title,
  seeAllHref,
  children,
}: {
  title: string;
  seeAllHref?: string;
  children: ReactNode;
}) {
  return (
    <section className="px-4 py-2 sm:px-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
        {seeAllHref && (
          <Link to={seeAllHref} className="text-xs font-semibold text-text-secondary transition hover:text-accent">
            See All ›
          </Link>
        )}
      </div>
      <div className="flex gap-3.5 overflow-x-auto pb-4">{children}</div>
    </section>
  );
}
