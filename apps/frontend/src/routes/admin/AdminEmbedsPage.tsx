import { useState } from "react";
import { Link } from "react-router-dom";
import AdminShell from "../../components/admin/AdminShell";
import EmbedEditor from "../../components/admin/EmbedEditor";
import { EmptyState, ErrorCard, Skeleton } from "../../components/ui/States";
import { useDeleteEmbeds, useEmbeddedTitles, useEmbedVideoSearch, type EmbeddedTitle } from "../../lib/embeds";

/** Every title with embedded players, and a search to add them to another. */
export default function AdminEmbedsPage() {
  const { data, isLoading, error, refetch, isFetching } = useEmbeddedTitles();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<{ fileId: string; title: string } | null>(null);
  const results = useEmbedVideoSearch(search);

  return (
    <AdminShell
      section="embeds"
      title="Embeds"
      description="Players that a title tries, in order, before its own file. Use them for videos you host or have permission to show."
    >
      <div className={`grid gap-6 ${open ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" : ""}`}>
        <div className={`grid min-w-0 content-start items-start gap-6 ${open ? "" : "lg:grid-cols-2"}`}>
          <section className="rounded-2xl border border-divider bg-surface p-5">
            <h2 className="mb-3 font-display text-xl tracking-wide text-white">Add to a title</h2>
            <input
              type="search"
              aria-label="Search the catalog"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search films and episodes"
              className="min-h-11 w-full rounded-lg border border-divider-strong bg-background px-3 text-sm text-white"
            />
            {results.data && (
              <ul className="mt-2 grid gap-1">
                {results.data.map((video) => (
                  <li key={video.fileId} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setOpen({ fileId: video.fileId, title: video.title })}
                      className="w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-hover"
                    >
                      <span className="block truncate text-sm text-white">{video.title}</span>
                      <span className="block truncate text-xs text-text-tertiary">{video.driveName}</span>
                    </button>
                  </li>
                ))}
                {results.data.length === 0 && (
                  <li className="px-3 py-2.5 text-sm text-text-tertiary">Nothing matches.</li>
                )}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-divider bg-surface p-5">
            <h2 className="mb-3 font-display text-xl tracking-wide text-white">
              Titles with players{data ? ` (${data.titles.length})` : ""}
            </h2>
            {error && (
              <ErrorCard
                title="The embeds did not load"
                message={error.message}
                onRetry={() => refetch()}
                retrying={isFetching}
              />
            )}
            {isLoading && <Skeleton className="h-28" />}
            {data?.titles.length === 0 && (
              <EmptyState title="No embeds yet" message="Search for a title above to add its first player." />
            )}
            <ul className="grid gap-1">
              {data?.titles.map((title) => (
                <TitleRow
                  key={title.key}
                  title={title}
                  selected={!!title.fileId && open?.fileId === title.fileId}
                  onOpen={(fileId) => setOpen({ fileId, title: title.title ?? title.key })}
                />
              ))}
            </ul>
          </section>
        </div>

        {open && (
          <section className="min-w-0 self-start rounded-2xl border border-divider bg-surface p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="font-display text-xl tracking-wide text-white">{open.title}</h2>
              <Link
                to={`/admin/catalog/video/${open.fileId}`}
                className="text-sm text-text-tertiary underline-offset-2 hover:text-white hover:underline"
              >
                Open in catalog
              </Link>
            </div>
            <EmbedEditor key={open.fileId} fileId={open.fileId} />
          </section>
        )}
      </div>
    </AdminShell>
  );
}

function TitleRow({
  title,
  selected,
  onOpen,
}: {
  title: EmbeddedTitle;
  selected: boolean;
  onOpen: (fileId: string) => void;
}) {
  const remove = useDeleteEmbeds();
  const players = title.embeds.map((e) => `${e.provider ?? "Unsupported"}${e.enabled ? "" : " (off)"}`).join(", ");
  if (!title.fileId) {
    return (
      <li className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-text-secondary">{title.key} — no longer in the catalog</span>
          <span className="block truncate text-xs text-text-tertiary">{players}</span>
        </span>
        <button
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm("Remove these players?")) remove.mutate(title.key);
          }}
          className="min-h-9 rounded-lg border border-danger/40 px-3 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50"
        >
          Remove
        </button>
      </li>
    );
  }
  const fileId = title.fileId;
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(fileId)}
        aria-current={selected}
        className={`w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-hover ${
          selected ? "bg-surface-hover" : ""
        }`}
      >
        <span className="block truncate text-sm text-white">{title.title}</span>
        <span className="block truncate text-xs text-text-tertiary">{players}</span>
      </button>
    </li>
  );
}
