import { Component, ErrorInfo, ReactNode } from "react";
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

const RELOAD_TS_KEY = "__lazy_chunk_reload_ts__";
const RELOAD_TTL_MS = 10 * 60_000; // максимум один auto-reload за 10 минут, без циклов
const MEMORY_RELOAD_TS_KEY = "__lazyChunkReloadTs";

/**
 * Catches dynamic-import / chunk-load failures (typically caused by a stale
 * SPA shell pointing to a chunk hash that no longer exists on the CDN after
 * a fresh deploy) and triggers a full page reload — but не чаще одного раза
 * в 60 секунд, чтобы избежать reload-loop на реально битой сборке.
 *
 * Runtime-ошибки, не относящиеся к chunk-load, всплывают как окно ошибки и
 * подробно логируются в консоль вместе с pathname и component stack —
 * это даёт адресный сигнал для последующего фикса.
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

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const pathname = typeof window !== "undefined" ? window.location.pathname : "";

    if (!LazyErrorBoundary.isChunkLoadError(error)) {
      console.error("[LazyErrorBoundary] route render failed", {
        pathname,
        errorName: error?.name,
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
      });
      return;
    }

    // TTL guard: reload разрешён, если с прошлого reload прошло больше RELOAD_TTL_MS.
    // Важно: если storage недоступен (iOS standalone/private mode/webview), нельзя
    // делать автоматический reload — иначе stale chunk превращается в бесконечный цикл.
    let lastReloadAt = 0;
    let canPersistReloadMarker = false;
    try {
      const raw = sessionStorage.getItem(RELOAD_TS_KEY);
      lastReloadAt = raw ? Number(raw) || 0 : 0;
      canPersistReloadMarker = true;
    } catch {
      // sessionStorage unavailable (private mode, standalone webview, etc.)
    }

    if (!lastReloadAt) {
      try {
        lastReloadAt = Number((window as any)[MEMORY_RELOAD_TS_KEY]) || 0;
      } catch {
        /* ignore */
      }
    }

    const now = Date.now();
    if (lastReloadAt && now - lastReloadAt < RELOAD_TTL_MS) {
      console.error("[LazyErrorBoundary] chunk load failed within TTL, giving up", {
        pathname,
        lastReloadAt,
        deltaMs: now - lastReloadAt,
        message: error.message,
      });
      this.setState({ isChunkError: false });
      return;
    }

    if (!canPersistReloadMarker) {
      console.error("[LazyErrorBoundary] chunk load failed and reload marker storage is unavailable, giving up", {
        pathname,
        message: error.message,
      });
      this.setState({ isChunkError: false });
      return;
    }

    try {
      sessionStorage.setItem(RELOAD_TS_KEY, String(now));
      (window as any)[MEMORY_RELOAD_TS_KEY] = now;
    } catch {
      console.error("[LazyErrorBoundary] chunk load failed and reload marker write failed, giving up", {
        pathname,
        message: error.message,
      });
      this.setState({ isChunkError: false });
      return;
    }

    console.warn("[LazyErrorBoundary] stale chunk detected, reloading once", {
      pathname,
      message: error.message,
    });
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
