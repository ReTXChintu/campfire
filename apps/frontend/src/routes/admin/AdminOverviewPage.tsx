import { Link } from "react-router-dom";
import AdminShell from "../../components/admin/AdminShell";
import ScanButton from "../../components/admin/ScanButton";
import { useAdminOverview } from "../../hooks/useAdminCatalog";
import { useAdminRequestCounts } from "../../hooks/useAdminRequests";
import { useLibrary } from "../../hooks/useCatalog";
import { ErrorCard, Skeleton } from "../../components/ui/States";
import { REQUEST_STATUSES, REQUEST_STATUS_CLASSES, REQUEST_STATUS_LABELS } from "../../lib/requestStatus";

function Tile({
  label,
  value,
  hint,
  to,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  to?: string;
  tone?: "default" | "warn" | "live";
}) {
  const valueTone = tone === "warn" ? "text-amber" : tone === "live" ? "text-live" : "text-white";
  const body = (
    <>
      <p className="text-[11px] font-semibold tracking-[0.08em] text-text-tertiary uppercase">{label}</p>
      <p className={`font-display text-3xl tracking-wide tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="text-xs text-text-tertiary">{hint}</p>}
    </>
  );
  const className =
    "grid content-start gap-1.5 rounded-xl border border-divider bg-surface p-4 transition hover:border-divider-strong";
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** The dashboard the admin panel never had: what is waiting to be curated, what is ready to
 * publish, what the viewers can actually see, and how the request queue looks. Every number comes
 * from an endpoint that already exists — there is no storage or queue-health figure here because
 * the backend doesn't report one. */
export default function AdminOverviewPage() {
  const overview = useAdminOverview();
  const counts = useAdminRequestCounts();
  const library = useLibrary();

  const pending = overview.data
    ? overview.data.pendingFolders.length + overview.data.pendingVideos.length
    : 0;
  const readyToPublish = overview.data
    ? overview.data.unpublishedFolders.length + overview.data.unpublishedVideos.length
    : 0;
  const publishedSeries = library.data?.folders.length ?? 0;
  const publishedFilms = library.data?.videos.length ?? 0;
  const newRequests = counts.data?.counts.new ?? 0;

  return (
    <AdminShell
      section="overview"
      title="Overview"
      description="Scan Drive for new files, curate them, then publish — curating alone does not make something visible to viewers."
      actions={<ScanButton />}
    >
      {overview.error ? (
        <ErrorCard
          title="The catalog summary did not load"
          message={overview.error.message}
          onRetry={() => overview.refetch()}
          retrying={overview.isFetching}
        />
      ) : overview.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[104px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile
              label="Needs curation"
              value={pending}
              hint="Found in Drive, no title yet"
              to="/admin/catalog"
              tone={pending > 0 ? "warn" : "default"}
            />
            <Tile
              label="Ready to publish"
              value={readyToPublish}
              hint="Curated but still hidden"
              to="/admin/catalog"
              tone={readyToPublish > 0 ? "warn" : "default"}
            />
            <Tile label="Published series" value={publishedSeries} hint="Visible to viewers" tone="live" />
            <Tile label="Published films" value={publishedFilms} hint="Visible to viewers" tone="live" />
          </div>

          <div className="mt-8 grid items-start gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-divider bg-surface p-5">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <h2 className="font-display text-xl tracking-wide text-white">Request queue</h2>
                <Link
                  to="/admin/requests"
                  className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition hover:text-accent"
                >
                  Open requests ›
                </Link>
              </div>
              {counts.error ? (
                <ErrorCard
                  title="Request counts did not load"
                  message={counts.error.message}
                  onRetry={() => counts.refetch()}
                  retrying={counts.isFetching}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {REQUEST_STATUSES.map((status) => (
                    <span
                      key={status}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${REQUEST_STATUS_CLASSES[status]}`}
                    >
                      {REQUEST_STATUS_LABELS[status]}
                      <span className="font-mono tabular-nums">{counts.data?.counts[status] ?? 0}</span>
                    </span>
                  ))}
                </div>
              )}
              {newRequests > 0 && (
                <p className="mt-4 text-sm text-text-secondary">
                  {newRequests} {newRequests === 1 ? "request is" : "requests are"} waiting for a first look.
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-divider bg-surface p-5">
              <h2 className="mb-4 font-display text-xl tracking-wide text-white">Next in the catalog</h2>
              {pending + readyToPublish === 0 ? (
                <p className="text-sm text-text-secondary">
                  Nothing is waiting — everything found in Drive is curated and published.
                </p>
              ) : (
                <div className="grid gap-1">
                  {[
                    ...(overview.data?.pendingFolders ?? []).map((folder) => ({
                      key: `f-${folder._id}`,
                      to: `/admin/catalog/folder/${folder._id}`,
                      name: folder.driveName,
                      tag: "Needs curation · Folder",
                    })),
                    ...(overview.data?.pendingVideos ?? []).map((video) => ({
                      key: `v-${video._id}`,
                      to: `/admin/catalog/video/${video._id}`,
                      name: video.driveName,
                      tag: "Needs curation · Video",
                    })),
                    ...(overview.data?.unpublishedFolders ?? []).map((folder) => ({
                      key: `uf-${folder._id}`,
                      to: `/admin/catalog/folder/${folder._id}`,
                      name: folder.title ?? folder.driveName,
                      tag: "Ready to publish · Folder",
                    })),
                    ...(overview.data?.unpublishedVideos ?? []).map((video) => ({
                      key: `uv-${video._id}`,
                      to: `/admin/catalog/video/${video._id}`,
                      name: video.title ?? video.driveName,
                      tag: "Ready to publish · Video",
                    })),
                  ]
                    .slice(0, 8)
                    .map((entry) => (
                      <Link
                        key={entry.key}
                        to={entry.to}
                        className="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition hover:bg-surface-hover"
                      >
                        <span className="shrink-0 text-xs text-amber">{entry.tag}</span>
                        <span className="min-w-0 flex-1 truncate text-white">{entry.name}</span>
                      </Link>
                    ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </AdminShell>
  );
}
