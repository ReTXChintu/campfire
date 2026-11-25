import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { parseTitleParam, titleParam } from "../lib/explore";

/** The title whose details are open, kept in the address (`?title=movie-603`) so it can be linked to
 * and Back closes it. `play` opens them on the sources to play from. */
export function useTitlePanel() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const opened = parseTitleParam(params.get("title"));
  const pushed = (location.state as { exploreOpened?: boolean } | null)?.exploreOpened === true;

  const open = useCallback(
    (type: "movie" | "tv", id: string, play = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("title", titleParam(type, id));
          if (play) next.set("play", "1");
          else next.delete("play");
          return next;
        },
        // Closing then knows that Back lands on the page without the panel.
        { state: { exploreOpened: true }, preventScrollReset: true },
      ),
    [setParams],
  );

  const close = useCallback(() => {
    if (pushed) {
      navigate(-1);
      return;
    }
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("title");
        next.delete("play");
        return next;
      },
      { replace: true },
    );
  }, [pushed, navigate, setParams]);

  return { opened, open, close };
}
