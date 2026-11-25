import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiGet } from "../lib/api";
import { ErrorCard } from "../components/ui/States";
import { PAGE } from "../lib/layout";
import NotFoundPage from "./NotFoundPage";

/** `/play/movie/603`, `/play/tv/1396[?season=1&episode=2]`, `&source=…` — what every Play button opens. Goes on to
 * wherever the title is watched, leaving nothing in the history for Back to bounce off. */
export default function PlayPage() {
  const { type, tmdbId } = useParams();
  const [params] = useSearchParams();
  const query = new URLSearchParams();
  for (const name of ["season", "episode"]) {
    const value = params.get(name);
    if (value) query.set(name, value);
  }
  const path = `/api/title/${type}/${tmdbId}/play${query.size ? `?${query}` : ""}`;
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ["play", path],
    queryFn: () => apiGet<{ href: string }>(path),
    // Where a series carries on changes with every episode.
    gcTime: 0,
    retry: false,
  });
  const source = params.get("source");
  if (data) return <Navigate to={source ? `${data.href}?source=${encodeURIComponent(source)}` : data.href} replace />;
  if (error instanceof ApiError && error.status === 400) return <NotFoundPage />;
  if (error) {
    return (
      <main className={PAGE}>
        <ErrorCard title="That can't be played" message={error.message} onRetry={() => refetch()} retrying={isFetching} />
      </main>
    );
  }
  return (
    <main className={PAGE} aria-busy="true">
      <div className="skeleton aspect-video w-full rounded-2xl" />
    </main>
  );
}
