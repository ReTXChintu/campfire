import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import { PAGE } from "../lib/layout";
import NotFoundPage from "./NotFoundPage";

/** `/title/movie/603`, `/title/tv/1396?season=1&episode=2` — a link to a title by its TMDb id,
 * which stays right when its file is replaced. Goes to wherever the library has it. */
export default function TitlePage() {
  const { type, tmdbId } = useParams();
  const [params] = useSearchParams();
  const query = new URLSearchParams();
  for (const name of ["season", "episode"]) {
    const value = params.get(name);
    if (value) query.set(name, value);
  }
  const path = `/api/title/${type}/${tmdbId}${query.size ? `?${query}` : ""}`;
  const { data, isLoading } = useQuery({
    queryKey: ["title", path],
    queryFn: () => apiGet<{ kind: "folder" | "video"; id: string }>(path),
    retry: false,
  });
  if (isLoading) return <div className={PAGE} aria-busy="true" />;
  if (!data) return <NotFoundPage />;
  return <Navigate to={data.kind === "folder" ? `/folder/${data.id}` : `/watch/${data.id}`} replace />;
}
