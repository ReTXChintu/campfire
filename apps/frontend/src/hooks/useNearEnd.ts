import { useEffect, useRef } from "react";

/** Calls `onNear` when the element the returned ref is on comes within a screen or so of view. */
export function useNearEnd(onNear: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onNear);
  useEffect(() => {
    callback.current = onNear;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && callback.current(), {
      rootMargin: "1000px 0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [active]);
  return ref;
}
