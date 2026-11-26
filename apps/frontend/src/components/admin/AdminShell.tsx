import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAdminRequestCounts } from "../../hooks/useAdminRequests";
import { PAGE_X } from "../../lib/layout";

export type AdminSection = "overview" | "catalog" | "sources" | "embeds" | "anime" | "requests";

/**
 * The admin shell: a left sidebar plus a content pane, instead of the two bare tabs this panel
 * used to be. The sidebar turns into a scrollable row of pills under `lg` so the same markup works
 * on a phone. The Converter is deliberately absent — it was removed from the product.
 */
export default function AdminShell({
  section,
  title,
  description,
  actions,
  children,
}: {
  section: AdminSection;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // Counts-only call, so the "N new" badge doesn't drag the whole request list (and a user lookup
  // per voter) onto every admin page.
  const { data } = useAdminRequestCounts();
  const newCount = data?.counts.new ?? 0;

  const items: { to: string; label: string; key: AdminSection; badge?: number }[] = [
    { to: "/admin", label: "Overview", key: "overview" },
    { to: "/admin/catalog", label: "Catalog", key: "catalog" },
    { to: "/admin/sources", label: "Sources", key: "sources" },
    { to: "/admin/embeds", label: "Embeds", key: "embeds" },
    { to: "/admin/anime", label: "Anime", key: "anime" },
    { to: "/admin/requests", label: "Requests", key: "requests", badge: newCount },
  ];

  return (
    <div className="grid w-full flex-1 lg:grid-cols-[232px_minmax(0,1fr)]">
      <nav
        aria-label="Admin"
        className="flex gap-1 overflow-x-auto border-b border-divider bg-[var(--bg-elevated)] px-4 py-3 lg:flex-col lg:overflow-visible lg:border-r lg:border-b-0 lg:px-3 lg:py-5"
      >
        <p className="hidden px-3 pb-2 font-display text-xs tracking-[0.16em] text-text-tertiary uppercase lg:block">
          Admin
        </p>
        {items.map((item) => (
          <NavLink
            key={item.key}
            to={item.to}
            end={item.to === "/admin"}
            className={() =>
              `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                section === item.key
                  ? "bg-accent-soft text-amber"
                  : "text-text-secondary hover:bg-surface hover:text-white"
              }`
            }
          >
            {item.label}
            {item.badge ? (
              <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] text-black">{item.badge}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className={`min-w-0 ${PAGE_X} py-8`}>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl tracking-wide text-white">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-sm text-text-secondary">{description}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
