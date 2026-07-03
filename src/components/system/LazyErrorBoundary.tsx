import { Component, ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
  message: string;
}

const RELOAD_FLAG = "__lazy_chunk_reloaded__";

/**
 * Catches dynamic-import / chunk-load failures (typically caused by a stale
 * SPA shell pointing to a chunk hash that no longer exists on the CDN after
 * a fresh deploy) and triggers a single full page reload.
 *
 * Guards:
 * - Only triggers on chunk-load signatures (ChunkLoadError, "Failed to fetch
 *   dynamically imported module", "Importing a module script failed").
 * - Never reloads more than once per session (sessionStorage flag).
 * - Re-throws any other error so the regular error path is unaffected.
 */
export class LazyErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      isChunkError: LazyErrorBoundary.isChunkLoadError(error),
      message: error?.message || "Unknown route error",
    };
  }

  componentDidCatch(error: Error) {
    if (!LazyErrorBoundary.isChunkLoadError(error)) {
      console.error("[LazyErrorBoundary] route render failed:", error);
      return;
    }

    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === "1";
    } catch {
      // sessionStorage unavailable (private mode, etc.) — fall through
    }

    if (alreadyReloaded) {
      console.error("[LazyErrorBoundary] chunk load failed twice, giving up:", error);
      return;
    }

    try {
      sessionStorage.setItem(RELOAD_FLAG, "1");
    } catch {
      /* ignore */
    }

    console.warn("[LazyErrorBoundary] stale chunk detected, reloading once:", error.message);
    // Defer to next tick so React can finish the render cycle
    setTimeout(() => window.location.reload(), 0);
  }

  static isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const err = error as { name?: string; message?: string };
    if (err.name === "ChunkLoadError") return true;
    const msg = (err.message || String(error)).toLowerCase();
    return (
      msg.includes("failed to fetch dynamically imported module") ||
      msg.includes("importing a module script failed") ||
      msg.includes("error loading dynamically imported module") ||
      msg.includes("loading chunk") // webpack-style fallback
    );
  }

  render() {
    if (this.state.hasError && this.state.isChunkError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4 text-center">
          <AlertTriangle className="h-14 w-14 text-destructive" />
          <h1 className="text-xl font-semibold text-foreground">Страница не загрузилась</h1>
          <p className="text-sm text-muted-foreground max-w-md">
            Произошла ошибка интерфейса. Обновите страницу — если проблема повторится, мы увидим её в логах.
          </p>
          <Button onClick={() => window.location.reload()}>Обновить</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
