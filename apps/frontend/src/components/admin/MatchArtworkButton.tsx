import { Link } from "react-router-dom";
import { useMatchMissingArtwork } from "../../hooks/useAdminCatalog";

/** Matches every movie and series that still has no artwork (including ones that missed before),
 * then lists what still needs a pasted link. New titles are matched after each scan anyway; this
 * is for retrying and for seeing what's left. */
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
            {result.unmatched.length === 0 && " Every movie and series has artwork."}
          </p>
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
    </div>
  );
}
