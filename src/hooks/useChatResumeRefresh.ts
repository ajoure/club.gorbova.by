import { useEffect } from "react";

/** Mobile browsers suspend WebSockets. Refresh data after returning, never the page. */
export function useChatResumeRefresh(refresh: () => void) {
  useEffect(() => {
    const resume = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);
}
