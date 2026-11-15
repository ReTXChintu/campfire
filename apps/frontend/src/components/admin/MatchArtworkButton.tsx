import { Link } from "react-router-dom";
import { useMatchMissingArtwork, useUseTmdbTitlesEverywhere } from "../../hooks/useAdminCatalog";

/** The whole catalog's TMDb pass: matches every movie and series that still has no artwork
 * (including ones that missed before), tops up anything matched by an older build, replaces raw
 * filenames with real titles, and names every episode underneath. Then it lists what still needs
 * a pasted link. New titles are matched after each scan anyway; this is for retrying and for
 * seeing what's left. */
export default function MatchArtworkButton() {
  const { mutate, data: result, error, isPending } = useMatchMissingArtwork();

  return (
    <div className="mb-8">
      <button
        onClick={() => mutate()}
        disabled={isPending}
        className="rounded-md border border-divider px-4 py-2 text-sm font-bold text-white/90 transition hover:bg-white/5 disabled:opacity-50"
      >
        {isPending ? "Matching artwork…" : "Match missing artwork"}
      </button>

      {result && (
        <div className="mt-2 text-sm text-text-secondary">
          <p>
            {result.matched.length > 0 ? (
              <span className="text-white">
                Matched {result.matched.length} title{result.matched.length === 1 ? "" : "s"}.
              </span>
            ) : (
              "Nothing new matched."
            )}
            {!!result.enriched && ` Filled in details for ${result.enriched}.`}
            {!!result.episodes?.matched &&
              ` Named ${result.episodes.matched} episode${result.episodes.matched === 1 ? "" : "s"}.`}
            {result.unmatched.length === 0 && " Every movie and series has artwork."}
          </p>
          {!!result.renamed?.length && (
            <p className="mt-1">
              Renamed from TMDb:{" "}
              {result.renamed.map((item, index) => (
                <span key={`${item.kind}-${item.id}`}>
                  {index > 0 && ", "}
                  <Link
                    to={`/admin/catalog/${item.kind}/${item.id}`}
                    className="text-white underline-offset-2 hover:underline"
                  >
                    {item.to}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {!!result.episodes?.unresolved?.length && (
            <p className="mt-1">
              These folders hold episodes but don&apos;t say which season:{" "}
              {result.episodes.unresolved.map((folder, index) => (
                <span key={folder.folderId}>
                  {index > 0 && ", "}
                  <Link
                    to={`/admin/catalog/folder/${folder.folderId}`}
                    className="text-white underline-offset-2 hover:underline"
                  >
                    {folder.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {result.unmatched.length > 0 && (
            <p className="mt-1">
              Still need a link:{" "}
              {result.unmatched.map((item, index) => (
                <span key={item.id}>
                  {index > 0 && ", "}
                  <Link
                    to={`/admin/catalog/${item.kind}/${item.id}`}
                    className="text-white underline-offset-2 hover:underline"
                  >
                    {item.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}

      <UseTmdbTitlesButton />
    </div>
  );
}

/**
 * Renames every matched movie and series to what TMDb calls it.
 *
 * Matching already tidies a raw filename on its own, but only when the two names are plainly the
 * same title and nobody typed the current one by hand — which is most of a real library. This is
 * the deliberate version: it overwrites hand-typed names, so it says so, and it lists exactly what
 * it changed.
 */
function UseTmdbTitlesButton() {
  const { mutate, data, error, isPending } = useUseTmdbTitlesEverywhere();
  return (
    <div className="mt-4 border-t border-divider pt-4">
      <button
        onClick={() => mutate()}
        disabled={isPending}
        className="rounded-md border border-divider px-4 py-2 text-sm font-bold text-white/90 transition hover:bg-white/5 disabled:opacity-50"
      >
        {isPending ? "Renaming…" : "Use TMDb's titles"}
      </button>
      <p className="mt-1.5 text-xs text-text-tertiary">
        Replaces every matched movie&apos;s and series&apos; name with TMDb&apos;s, including names typed by hand.
      </p>
      {data && (
        <div className="mt-2 text-sm text-text-secondary">
          {data.renamed.length === 0 ? (
            <p>Every title already matches TMDb.</p>
          ) : (
            <ul className="grid gap-0.5">
              {data.renamed.map((item) => (
                <li key={`${item.kind}-${item.id}`}>
                  <span className="text-text-tertiary line-through">{item.from}</span>{" "}
                  <span aria-hidden="true">→</span>{" "}
                  <Link
                    to={`/admin/catalog/${item.kind}/${item.id}`}
                    className="text-white underline-offset-2 hover:underline"
                  >
                    {item.to}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}
    </div>
  );
}
