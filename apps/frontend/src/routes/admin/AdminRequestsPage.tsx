import { useEffect, useMemo, useState } from "react";
import AdminNav from "../../components/admin/AdminNav";
import RequestPoster from "../../components/requests/RequestPoster";
import RequestStatusPill from "../../components/requests/RequestStatusPill";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS } from "../../lib/requestStatus";
import { useAuthedImage } from "../../hooks/useAuthedImage";
import { useLibrary } from "../../hooks/useCatalog";
import {
  useAdminRequests,
  useBulkRequestStatus,
  useDeleteAdminRequest,
  useUpdateAdminRequest,
} from "../../hooks/useAdminRequests";
import { ApiError } from "../../lib/api";
import type { AdminRequest, RequestCatalogRef, RequestStatus } from "../../lib/types";

/** Statuses the server accepts in bulk. "declined" needs a note and "added" needs a catalog link,
 * so both are per-request decisions and aren't offered here (the server refuses them too). */
const BULK_STATUSES: RequestStatus[] = ["new", "planned", "sourcing"];

function fieldError(error: unknown, field: string): string | null {
  return error instanceof ApiError && error.field === field ? error.message : null;
}

function otherError(error: unknown, knownFields: string[]): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.field && knownFields.includes(error.field)) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Serialises a catalogRef into one `<select>` value, so "video:abc" round-trips without a second
 * piece of state for the kind. */
function refValue(ref: RequestCatalogRef | null): string {
  return ref ? `${ref.kind}:${ref.id}` : "";
}

function parseRefValue(value: string): RequestCatalogRef | null {
  if (!value) return null;
  const [kind, ...rest] = value.split(":");
  if (kind !== "video" && kind !== "folder") return null;
  return { kind, id: rest.join(":") };
}

function ReferenceImagePreview({ path }: { path: string }) {
  const { url, failed } = useAuthedImage(path);
  if (failed) return <p className="text-xs text-text-tertiary">That reference image couldn't be loaded.</p>;
  if (!url) return <div className="h-32 w-24 animate-pulse rounded bg-surface-hover" />;
  return <img src={url} alt="Reference image from the requester" className="max-h-56 rounded-md object-contain" />;
}

function DetailPanel({ request }: { request: AdminRequest }) {
  const [status, setStatus] = useState<RequestStatus>(request.status);
  const [adminNote, setAdminNote] = useState(request.adminNote ?? "");
  const [type, setType] = useState<"movie" | "series" | "">(request.type ?? "");
  const [catalogRef, setCatalogRef] = useState(refValue(request.catalogRef));
  const update = useUpdateAdminRequest();
  const remove = useDeleteAdminRequest();
  const { data: library } = useLibrary();

  // Reset the form whenever a different request is selected (or the saved one comes back changed).
  useEffect(() => {
    setStatus(request.status);
    setAdminNote(request.adminNote ?? "");
    setType(request.type ?? "");
    setCatalogRef(refValue(request.catalogRef));
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id, request.updatedAt]);

  // The picker offers published library items, which is exactly what an "added" request should be
  // able to point at — an unpublished target would make a spotlight slide whose Play goes nowhere.
  const catalogOptions = useMemo(() => {
    if (!library) return [];
    return [
      ...library.folders.map((item) => ({ value: `folder:${item.id}`, label: `${item.name} (series)` })),
      ...library.videos.map((item) => ({ value: `video:${item.id}`, label: item.name })),
    ];
  }, [library]);

  const noteError = fieldError(update.error, "adminNote");
  const refError = fieldError(update.error, "catalogRef");
  const bannerError = otherError(update.error, ["adminNote", "catalogRef"]);

  async function onSave() {
    await update
      .mutateAsync({
        id: request.id,
        patch: {
          status,
          adminNote: adminNote.trim() ? adminNote.trim() : null,
          type: type === "" ? null : type,
          catalogRef: parseRefValue(catalogRef),
        },
      })
      .catch(() => null);
  }

  return (
    <div className="grid gap-4 rounded-2xl border border-divider bg-surface p-4">
      <div className="flex gap-4">
        <div className="w-24 shrink-0">
          <RequestPoster
            id={request.id}
            title={request.title}
            refImagePath={request.refImagePath}
            posterUrl={request.refMeta?.posterUrl ?? null}
          />
        </div>
        <div className="grid min-w-0 content-start gap-1.5">
          <RequestStatusPill status={request.status} />
          <h2 className="font-display text-2xl tracking-wide text-white">{request.title}</h2>
          <p className="text-xs text-text-tertiary">
            {[request.year, request.type === "series" ? "Series" : request.type === "movie" ? "Movie" : null]
              .filter(Boolean)
              .join(" · ") || "No year or type on record"}
          </p>
          <p className="text-xs text-text-secondary">
            Asked by <b className="text-white">{request.requestedBy.name ?? request.requestedBy.email ?? "someone"}</b>{" "}
            · {new Date(request.createdAt).toLocaleDateString()}
          </p>
          <p className="text-xs text-text-secondary">
            {request.wantCount} {request.wantCount === 1 ? "person wants" : "people want"} this
            {request.voters.length > 0 && (
              <>: {request.voters.map((voter) => voter.name ?? voter.email).filter(Boolean).join(", ")}</>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-2 rounded-xl border border-divider-strong p-3">
        <p className="text-xs font-bold text-white">Reference</p>
        {request.refLink && (
          <a
            href={request.refLink}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-xs font-semibold text-amber underline"
          >
            {request.refLink} ↗
          </a>
        )}
        {request.refMeta && (
          <div className="grid gap-1 rounded-md bg-background p-2.5">
            <p className="text-xs font-semibold text-white">
              {request.refMeta.title}
              {request.refMeta.year ? ` (${request.refMeta.year})` : ""}
            </p>
            {request.refMeta.overview && <p className="text-xs text-text-secondary">{request.refMeta.overview}</p>}
          </div>
        )}
        {request.refImagePath && <ReferenceImagePreview path={request.refImagePath} />}
        {!request.refLink && !request.refImagePath && (
          <p className="text-xs text-text-tertiary">No reference was attached.</p>
        )}
      </div>

      <div className="grid gap-3 rounded-xl border border-divider-strong p-3">
        <p className="text-xs font-bold text-white">Admin actions</p>
        {bannerError && (
          <p className="rounded-md border border-danger/40 bg-danger-soft px-2.5 py-2 text-xs text-danger">
            {bannerError}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor="admin-request-status" className="text-xs font-semibold text-text-secondary">
              Status
            </label>
            <select
              id="admin-request-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as RequestStatus)}
              className="min-h-[40px] rounded-md border border-divider-strong bg-background px-2.5 text-sm text-white outline-none focus:border-accent"
            >
              {REQUEST_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {REQUEST_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="admin-request-type" className="text-xs font-semibold text-text-secondary">
              Type <span className="text-text-tertiary">(optional)</span>
            </label>
            <select
              id="admin-request-type"
              value={type}
              onChange={(event) => setType(event.target.value as "movie" | "series" | "")}
              className="min-h-[40px] rounded-md border border-divider-strong bg-background px-2.5 text-sm text-white outline-none focus:border-accent"
            >
              <option value="">Not set</option>
              <option value="movie">Movie</option>
              <option value="series">Series</option>
            </select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="admin-request-note" className="text-xs font-semibold text-text-secondary">
            Note to requester
          </label>
          <textarea
            id="admin-request-note"
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
            rows={3}
            placeholder="Tell them what happens next. Required when declining."
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? "admin-request-note-error" : undefined}
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm text-white outline-none focus:border-accent ${
              noteError ? "border-danger" : "border-divider-strong"
            }`}
          />
          {noteError && (
            <p id="admin-request-note-error" className="text-xs text-danger">
              {noteError}
            </p>
          )}
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="admin-request-catalog" className="text-xs font-semibold text-text-secondary">
            Link to a catalog item
          </label>
          <select
            id="admin-request-catalog"
            value={catalogRef}
            onChange={(event) => setCatalogRef(event.target.value)}
            aria-invalid={refError ? true : undefined}
            aria-describedby={refError ? "admin-request-catalog-error" : undefined}
            className={`min-h-[40px] rounded-md border bg-background px-2.5 text-sm text-white outline-none focus:border-accent ${
              refError ? "border-danger" : "border-divider-strong"
            }`}
          >
            <option value="">Not linked</option>
            {catalogOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {refError ? (
            <p id="admin-request-catalog-error" className="text-xs text-danger">
              {refError}
            </p>
          ) : (
            <p className="text-xs text-text-tertiary">
              Marking a request <b>Added</b> with a link is what gives it a “Requested by … · Now available” spotlight
              slide on Home, and the requester a “Watch it now” button.
            </p>
          )}
        </div>

        {update.isSuccess && !update.isPending && (
          <p className="rounded-md border border-live/30 bg-live/10 px-2.5 py-2 text-xs text-live">
            Saved.
            {request.status === "added" && request.catalogRef
              ? " This request now has a spotlight slide on Home."
              : ""}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={update.isPending}
            className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete the request for “${request.title}”? This can't be undone.`)) {
                remove.mutate(request.id);
              }
            }}
            disabled={remove.isPending}
            className="rounded-md border border-danger px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger-soft disabled:opacity-60"
          >
            Delete request
          </button>
        </div>
        {remove.isError && <p className="text-xs text-danger">{remove.error.message}</p>}
      </div>
    </div>
  );
}

export default function AdminRequestsPage() {
  const [filter, setFilter] = useState<RequestStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [bulkStatus, setBulkStatus] = useState<RequestStatus | "">("");

  const { data, isLoading, error } = useAdminRequests(filter);
  const bulk = useBulkRequestStatus();

  const requests = data?.requests ?? [];
  const counts = data?.counts;
  const checkedIds = Object.keys(checked).filter((id) => checked[id]);
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0] ?? null;

  // A filter change can drop the selected row and any ticked rows out of the list entirely.
  useEffect(() => {
    setChecked({});
  }, [filter]);

  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6 lg:px-8">
      <AdminNav active="requests" />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-sm uppercase tracking-[0.14em] text-text-tertiary">From your users</p>
          <h1 className="font-display text-4xl tracking-wide text-white">Requests</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {data ? `${data.total} requests · ${counts?.new ?? 0} new` : "Loading…"}
          </p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-divider" role="tablist" aria-label="Status">
        {(["all", ...REQUEST_STATUSES] as (RequestStatus | "all")[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold transition ${
              filter === value ? "border-accent text-white" : "border-transparent text-text-secondary hover:text-white"
            }`}
          >
            {value === "all" ? "All" : REQUEST_STATUS_LABELS[value]}{" "}
            <span className="text-text-tertiary">
              {value === "all"
                ? counts
                  ? Object.values(counts).reduce((sum, n) => sum + n, 0)
                  : ""
                : (counts?.[value] ?? "")}
            </span>
          </button>
        ))}
      </div>

      {checkedIds.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber/35 bg-amber/10 px-3 py-2 text-xs text-amber">
          <span className="font-semibold">{checkedIds.length} selected</span>
          <span className="flex-1" />
          <label htmlFor="bulk-status" className="font-semibold">
            Set status
          </label>
          <select
            id="bulk-status"
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value as RequestStatus | "")}
            className="min-h-[32px] rounded-md border border-divider-strong bg-background px-2 text-xs text-white outline-none focus:border-accent"
          >
            <option value="">Choose…</option>
            {BULK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {REQUEST_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!bulkStatus || bulk.isPending}
            onClick={async () => {
              if (!bulkStatus) return;
              await bulk.mutateAsync({ ids: checkedIds, status: bulkStatus }).catch(() => null);
              setChecked({});
              setBulkStatus("");
            }}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110 disabled:opacity-60"
          >
            {bulk.isPending ? "Applying…" : "Apply"}
          </button>
          <p className="basis-full text-text-tertiary">
            Declined and Added are per-request decisions — they need a note or a catalog link, so they're set in the
            detail panel.
          </p>
        </div>
      )}

      {bulk.isError && (
        <p className="mb-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {bulk.error.message}
        </p>
      )}

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          Failed to load requests: {error.message}
        </p>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,6fr)_minmax(0,4fr)]">
          <div className="grid gap-2">
            {isLoading
              ? [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-surface" />)
              : requests.length === 0
                ? <p className="rounded-xl border border-divider bg-surface px-4 py-8 text-center text-sm text-text-secondary">
                    Nothing matches this filter.
                  </p>
                : requests.map((request) => (
                    <div key={request.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`check-${request.id}`}
                        checked={!!checked[request.id]}
                        onChange={(event) =>
                          setChecked((previous) => ({ ...previous, [request.id]: event.target.checked }))
                        }
                        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                      />
                      <label htmlFor={`check-${request.id}`} className="sr-only">
                        Select {request.title}
                      </label>
                      <button
                        type="button"
                        onClick={() => setSelectedId(request.id)}
                        aria-current={selected?.id === request.id}
                        className={`grid flex-1 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
                          selected?.id === request.id
                            ? "border-accent-dim bg-accent-soft"
                            : "border-divider bg-surface hover:bg-surface-hover"
                        }`}
                      >
                        <RequestPoster
                          id={request.id}
                          title={request.title}
                          refImagePath={request.refImagePath}
                          posterUrl={request.refMeta?.posterUrl ?? null}
                        />
                        <span className="grid min-w-0 gap-1">
                          <span className="truncate text-sm font-semibold text-white">
                            {request.title}
                            {request.year !== null && (
                              <span className="ml-1.5 font-normal text-text-tertiary">{request.year}</span>
                            )}
                          </span>
                          <span className="truncate text-xs text-text-tertiary">
                            {request.requestedBy.name ?? request.requestedBy.email ?? "someone"} ·{" "}
                            <b className="font-medium text-text-secondary">
                              {request.wantCount} {request.wantCount === 1 ? "person wants" : "people want"} this
                            </b>
                          </span>
                        </span>
                        <RequestStatusPill status={request.status} />
                      </button>
                    </div>
                  ))}
          </div>

          <div>
            {selected ? (
              <DetailPanel key={selected.id} request={selected} />
            ) : (
              <p className="rounded-2xl border border-divider bg-surface px-4 py-8 text-center text-sm text-text-secondary">
                Pick a request to see its detail.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
