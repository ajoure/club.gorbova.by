import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportRouteError, type ReportStatus } from "@/lib/reportRouteError";
import { isChunkLoadError, makeRouteErrorDiagnostic, type RouteErrorDiagnostic } from "../../../supabase/functions/_shared/route-error-diagnostic";

interface Props { children: ReactNode }
interface State {
  hasError: boolean; isChunkError: boolean;
  diagnostic: RouteErrorDiagnostic | null; reportStatus: ReportStatus;
  copied: boolean; copyFailed: boolean;
}
/** Recovery is always explicit: never discard another open form with an automatic reload. */
export class LazyErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isChunkError: false, diagnostic: null, reportStatus: "pending", copied: false, copyFailed: false };
  private unmounted = false;
  static isChunkLoadError = isChunkLoadError;
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { hasError: true, isChunkError: isChunkLoadError(error) };
  }
  componentDidCatch(error: Error) {
    const diagnostic = makeRouteErrorDiagnostic(error, {
      id: globalThis.crypto?.randomUUID?.() ?? "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16);
      }), at: new Date().toISOString(),
      pathname: window.location.pathname, search: window.location.search,
      build: (window as Window & { __BUILD_FINGERPRINT__?: string }).__BUILD_FINGERPRINT__ ?? "unknown", online: navigator.onLine,
    });
    if (diagnostic.kind === "chunk") diagnostic.recovery = "manual";
    console.error("[LazyErrorBoundary] route failure", diagnostic);
    try { sessionStorage.setItem("__last_route_error__", JSON.stringify(diagnostic)); } catch { /* best effort */ }
    this.setState({ diagnostic });
    void reportRouteError(diagnostic).then(reportStatus => {
      if (!this.unmounted) this.setState({ reportStatus });
    });
  }
  componentWillUnmount() { this.unmounted = true; }
  private copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.state.diagnostic, null, 2));
      if (!this.unmounted) this.setState({ copied: true, copyFailed: false });
    } catch { if (!this.unmounted) this.setState({ copyFailed: true }); }
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    const { isChunkError, diagnostic, reportStatus, copied, copyFailed } = this.state;
    return <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4 py-8 text-center">
      <AlertTriangle className="h-14 w-14 shrink-0 text-destructive" />
      <h1 className="text-xl font-semibold text-foreground">{isChunkError ? "Не удалось загрузить файлы страницы" : "Страница не загрузилась"}</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        {isChunkError ? "Проверьте соединение с интернетом. Страница не будет обновляться автоматически. Нажмите «Обновить», когда будете готовы: несохранённые изменения могут быть потеряны."
          : "Произошла ошибка интерфейса. Попробуйте обновить страницу. Если ошибка повторится, передайте технический отчёт поддержке."}
      </p>
      {diagnostic && <>
        <p className="text-xs text-muted-foreground max-w-md break-all">Код ошибки: {diagnostic.id}</p>
        <p className="text-xs text-muted-foreground max-w-md" role="status">
          {reportStatus === "sent" ? "Технический отчёт сохранён в системном журнале."
            : reportStatus === "pending" ? "Проверяем отправку технического отчёта…"
            : "Автоматическая отправка не подтверждена. Скопируйте отчёт для поддержки."}
        </p>
      </>}
      <div className="flex flex-wrap justify-center gap-2 max-w-full">
        <Button onClick={() => window.location.reload()}>Обновить</Button>
        {diagnostic && <Button variant="outline" onClick={this.copyDiagnostic}>{copied ? "Отчёт скопирован" : "Скопировать отчёт"}</Button>}
      </div>
      {copyFailed && <textarea readOnly aria-label="Технический отчёт для ручного копирования" className="w-full max-w-md h-36 rounded border p-2 text-xs" value={JSON.stringify(diagnostic, null, 2)} />}
    </div>;
  }
}
