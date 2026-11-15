import { Link } from "react-router-dom";
import type { PublicRequest } from "../../lib/types";
import RequestPoster from "./RequestPoster";
import RequestStatusPill from "./RequestStatusPill";

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

/** One request on the community board. The type chip and the year are rendered **only** when the
 * server actually has them — they come from the link lookup or an admin, so they're usually null,
 * and a "Movie"/"Unknown" placeholder would be a lie rather than a layout fix. */
export default function RequestCard({
  request,
  onUpvote,
  upvoting,
  onWithdraw,
  highlighted = false,
}: {
  request: PublicRequest;
  onUpvote: (wantsIt: boolean) => void;
  upvoting?: boolean;
  /** Only passed on the "My requests" tab — the server lets an owner withdraw their own request
   * while it's still open, and refuses once it's been added. */
  onWithdraw?: () => void;
  highlighted?: boolean;
}) {
  return (
    <article
      id={`request-${request.id}`}
      className={`grid gap-3 rounded-2xl border bg-surface p-3 transition ${
        highlighted ? "border-accent-dim ring-1 ring-accent-dim" : "border-divider"
      }`}
    >
      <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
        <RequestPoster
          id={request.id}
          title={request.title}
          refImagePath={request.refImagePath}
          posterUrl={request.refMeta?.posterUrl ?? null}
        />
        <div className="grid content-start gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatusPill status={request.status} />
            {request.type && (
              <span className="rounded border border-divider-strong px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
                {request.type === "series" ? "Series" : "Movie"}
              </span>
            )}
          </div>
          <h3 className="text-sm font-semibold text-white">
            {request.title}
            {request.year !== null && <span className="ml-1.5 font-normal text-text-tertiary">{request.year}</span>}
          </h3>
          <p className="text-xs text-text-tertiary">
            {request.isMine ? "You" : (request.requestedByName ?? "Someone")} · {relativeDate(request.createdAt)}
          </p>
        </div>
      </div>

      {request.adminNote && (
        <p
          className={`rounded-md px-2.5 py-2 text-xs ${
            request.status === "declined"
              ? "border border-danger/35 bg-danger-soft text-danger"
              : "border border-live/30 bg-live/10 text-live"
          }`}
        >
          <b>Admin:</b> {request.adminNote}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onUpvote(!request.iWantIt)}
          aria-pressed={request.iWantIt}
          disabled={upvoting}
          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
            request.iWantIt
              ? "border-accent-dim bg-accent-soft text-amber"
              : "border-divider-strong text-text-secondary hover:border-accent-dim hover:text-amber"
          }`}
        >
          <span aria-hidden="true">▲</span> Me too · {request.wantCount}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {request.status === "added" && request.catalogRef && (
            <Link
              to={
                request.catalogRef.kind === "folder"
                  ? `/folder/${request.catalogRef.id}`
                  : `/watch/${request.catalogRef.id}`
              }
              className="rounded-md border border-divider-strong px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-surface-hover"
            >
              Watch it now
            </Link>
          )}
          {request.refLink && (
            <a
              href={request.refLink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md px-2 py-1.5 text-xs font-semibold text-text-secondary transition hover:text-white"
            >
              Reference ↗
            </a>
          )}
          {onWithdraw && request.status !== "added" && (
            <button
              type="button"
              onClick={onWithdraw}
              className="rounded-md border border-danger px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger-soft"
            >
              Withdraw
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
