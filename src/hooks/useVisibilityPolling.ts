import { useState, useEffect } from "react";

/**
 * Returns the polling interval when the tab is visible, or `false` when hidden.
 * Use with React Query's `refetchInterval` to pause polling when the user switches tabs.
 */
export function useVisibilityPolling(interval: number): number | false {
  const [isVisible, setIsVisible] = useState(
    typeof document !== "undefined" ? !document.hidden : true
  );

  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden);
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return isVisible ? interval : false;
}
