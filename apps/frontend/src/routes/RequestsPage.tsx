import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { PublicRequest, RequestStatus } from "../lib/types";
import { useDeleteRequest, useMyRequests, useRequests, useToggleUpvote } from "../hooks/useRequests";
import RequestCard from "../components/requests/RequestCard";
import RequestModal from "../components/requests/RequestModal";
import { REQUEST_STATUSES, REQUEST_STATUS_LABELS } from "../lib/requestStatus";
import { EmptyState, ErrorCard, Skeleton } from "../components/ui/States";
import { PAGE_X } from "../lib/layout";

type Tab = "browse" | "mine";
type Sort = "wanted" | "newest" | "recently-added";

function sortRequests(requests: PublicRequest[], sort: Sort): PublicRequest[] {
  const copy = [...requests];
  if (sort === "wanted") return copy.sort((a, b) => b.wantCount - a.wantCount);
  if (sort === "newest") return copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  // "Recently added" puts fulfilled requests first, newest fulfilment at the top.
  return copy.sort((a, b) => {
    const aAdded = a.status === "added" ? 1 : 0;
    const bAdded = b.status === "added" ? 1 : 0;
    if (aAdded !== bAdded) return bAdded - aAdded;
    return Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt);
  });
}

function RequestGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{children}</div>
  );
}

export default function RequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightedId = searchParams.get("request");

  const [tab, setTab] = useState<Tab>("browse");
  const [status, setStatus] = useState<RequestStatus | "all">("all");
  const [sort, setSort] = useState<Sort>("wanted");
  const [modalOpen, setModalOpen] = useState(false);

  const board = useRequests();
  const mine = useMyRequests();
  const toggleUpvote = useToggleUpvote();
  const deleteRequest = useDeleteRequest();

  const active = tab === "browse" ? board : mine;
  const loaded = active.data?.requests;

  const visible = useMemo(() => {
    const requests = loaded ?? [];
    const filtered = tab === "browse" && status !== "all" ? requests.filter((r) => r.status === status) : requests;
    return sortRequests(filtered, tab === "mine" ? "newest" : sort);
  }, [loaded, status, sort, tab]);

  /** A fulfilled-request spotlight slide links here with ?request=<id>; bring it into view and
   * ring it rather than leaving the viewer to find it in the board themselves. */
  useEffect(() => {
    if (!highlightedId || board.isLoading) return;
    const node = document.getElementById(`request-${highlightedId}`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightedId, board.isLoading]);

  const openRequestModal = () => setModalOpen(true);

  return (
    <main className={`w-full flex-1 ${PAGE_X} py-8`}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-sm uppercase tracking-[0.14em] text-text-tertiary">Community</p>
          <h1 className="font-display text-4xl tracking-wide text-white">Requests</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Ask for a film or a series. If it's already on the board, add your vote instead of filing it twice.
          </p>
        </div>
        <button
          type="button"
          onClick={openRequestModal}
          className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
        >
          + Request a title
        </button>
      </div>

      <div className="mb-5 flex gap-4 border-b border-divider" role="tablist" aria-label="Requests">
        {(["browse", "mine"] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`requests-tab-${value}`}
            aria-selected={tab === value}
            aria-controls="requests-panel"
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-1 pb-3 text-sm font-semibold transition ${
              tab === value ? "border-accent text-white" : "border-transparent text-text-secondary hover:text-white"
            }`}
          >
            {value === "browse" ? "Browse requests" : "My requests"}
          </button>
        ))}
      </div>

      {tab === "browse" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {(["all", ...REQUEST_STATUSES] as (RequestStatus | "all")[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
                className={`min-h-[34px] rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                  status === value
                    ? "border-accent-dim bg-accent-soft text-amber"
                    : "border-divider-strong text-text-secondary hover:text-white"
                }`}
              >
                {value === "all" ? "All" : REQUEST_STATUS_LABELS[value]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="requests-sort" className="text-xs font-semibold text-text-secondary">
              Sort
            </label>
            <select
              id="requests-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="min-h-[36px] rounded-md border border-divider-strong bg-background px-2.5 py-1.5 text-xs text-white outline-none focus:border-accent"
            >
              <option value="wanted">Most wanted</option>
              <option value="newest">Newest</option>
              <option value="recently-added">Recently added</option>
            </select>
          </div>
        </div>
      )}

      <div id="requests-panel" role="tabpanel" aria-labelledby={`requests-tab-${tab}`}>
        {active.isLoading ? (
          <RequestGrid>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 rounded-2xl" />
            ))}
          </RequestGrid>
        ) : active.error ? (
          <ErrorCard
            title="The requests board did not load"
            message={active.error.message}
            onRetry={() => active.refetch()}
            retrying={active.isFetching}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={tab === "mine" ? "No requests from you yet" : "Nothing on the board"}
            message={
              tab === "mine"
                ? "You haven't asked for anything yet. When you do, you can follow it from New through Planned, Sourcing and Added right here."
                : status === "all"
                  ? "Nothing on the board yet — be the first to ask for something."
                  : "Nothing with that status. Clear the filter, or ask for something new."
            }
            action={
              <button
                type="button"
                onClick={openRequestModal}
                className="rounded-md bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Request a title
              </button>
            }
          />
        ) : (
          <RequestGrid>
            {visible.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                highlighted={request.id === highlightedId}
                upvoting={toggleUpvote.isPending}
                onUpvote={(wantsIt) => toggleUpvote.mutate({ id: request.id, wantsIt })}
                onWithdraw={
                  tab === "mine" && request.isMine
                    ? () => {
                        if (window.confirm(`Withdraw your request for “${request.title}”?`)) {
                          deleteRequest.mutate(request.id);
                        }
                      }
                    : undefined
                }
              />
            ))}
          </RequestGrid>
        )}
      </div>

      {(toggleUpvote.isError || deleteRequest.isError) && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          {(toggleUpvote.error ?? deleteRequest.error)?.message}
        </p>
      )}

      {highlightedId && (
        <button
          type="button"
          onClick={() => setSearchParams({}, { replace: true })}
          className="mt-6 text-xs font-semibold text-text-secondary underline transition hover:text-white"
        >
          Clear the highlighted request
        </button>
      )}

      <RequestModal open={modalOpen} onClose={() => setModalOpen(false)} onSeeMine={() => setTab("mine")} />
    </main>
  );
}
