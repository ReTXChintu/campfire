import { usePublishNamedEpisodes, type PublishPreview } from "../../hooks/useAdminCatalog";

const SKIP_REASONS: Record<PublishPreview["skipped"][number]["reason"], (n: number) => string> = {
  "held-back": (n) => `${n} curated but not published — held back, so left for you`,
  "folder-held-back": (n) => `${n} in a season folder you're holding back`,
  "no-tmdb-name": (n) => `${n} TMDb couldn't name`,
};

/**
 * Publishes the episodes of a series that nobody ever curated but TMDb has since named — the pile
 * a library builds up when a season is uploaded and never gone through by hand.
 *
 * Always two steps. The first only looks, and says how each season's names were found: a season
 * matched by position has nothing in its files confirming the names, so it's flagged for a look
 * before every viewer sees them. Nothing is published until the second button.
 */
export default function PublishEpisodesPanel({ folderId }: { folderId: string }) {
  const preview = usePublishNamedEpisodes(folderId);
  const publish = usePublishNamedEpisodes(folderId);
  const plan = preview.data;
  const total = plan?.seasons.reduce((n, s) => n + s.episodes.length, 0) ?? 0;
  const done = publish.data?.published;

  const skippedCounts = new Map<string, number>();
  for (const item of plan?.skipped ?? []) skippedCounts.set(item.reason, (skippedCounts.get(item.reason) ?? 0) + 1);

  return (
    <section className="mb-8 rounded-lg border border-divider p-4" aria-labelledby="publish-episodes-heading">
      <h2 id="publish-episodes-heading" className="mb-3 text-sm font-semibold text-white">
        Unpublished episodes
      </h2>
      <p className="text-sm text-text-secondary">
        Episodes nobody has curated yet stay hidden from viewers. Once TMDb has named them, they can go live under those
        names — after you&apos;ve seen the list.
      </p>

      <button
        type="button"
        onClick={() => {
          publish.reset();
          preview.mutate({ dryRun: true });
        }}
        disabled={preview.isPending || publish.isPending}
        className="mt-4 rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
      >
        {preview.isPending ? "Checking…" : plan ? "Check again" : "Check for unpublished episodes"}
      </button>

      <div aria-live="polite">
        {preview.error && <p className="mt-2 text-sm text-red-400">{preview.error.message}</p>}
        {publish.error && <p className="mt-2 text-sm text-red-400">{publish.error.message}</p>}
        {done && (
          <p className="mt-3 text-sm text-live">
            Published {total} episode{total === 1 ? "" : "s"}. They&apos;re live now.
          </p>
        )}
      </div>

      {plan && !done && (
        <div className="mt-4">
          {plan.seriesHidden && (
            <p className="mb-3 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
              This series itself isn&apos;t published, so none of these will be visible until it is.
            </p>
          )}

          {plan.seasons.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing to publish — every named episode is already live.</p>
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {plan.seasons.map((season) => (
                <li key={season.folderId} className="rounded-md border border-divider p-3">
                  <p className="text-sm font-semibold text-white">
                    {season.name}{" "}
                    <span className="font-normal text-text-tertiary">
                      · {season.episodes.length} episode{season.episodes.length === 1 ? "" : "s"}
                      {season.publishesFolder && " · publishes the season too"}
                    </span>
                  </p>
                  {season.matchedBy === "position" && (
                    <p className="mt-1.5 text-xs text-amber">
                      Matched by position — nothing in these filenames confirms the names. Worth checking a couple
                      before publishing.
                    </p>
                  )}
                  <ol className="mt-2 grid gap-0.5 text-xs text-text-secondary">
                    {season.episodes.map((episode) => (
                      <li key={episode.id} className="truncate">
                        <span className="inline-block w-8 font-mono text-text-tertiary">
                          {episode.episode != null ? `E${episode.episode}` : "—"}
                        </span>
                        {episode.name}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          )}

          {skippedCounts.size > 0 && (
            <p className="mt-3 text-xs text-text-tertiary">
              Left alone:{" "}
              {[...skippedCounts.entries()]
                .map(([reason, n]) => SKIP_REASONS[reason as keyof typeof SKIP_REASONS](n))
                .join("; ")}
              .
            </p>
          )}

          {total > 0 && (
            <button
              type="button"
              onClick={() => publish.mutate({ dryRun: false })}
              disabled={publish.isPending}
              className="mt-4 rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              {publish.isPending ? "Publishing…" : `Publish ${total} episode${total === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
