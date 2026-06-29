import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PublicPageFetchErrorProps {
  onRetry?: () => void;
  details?: string;
}

/**
 * Friendly error state for public site pages when the page resolver
 * fails on a transport/network error (NOT 404).
 *
 * Why a separate state: a fetch error is recoverable (user reload,
 * network blip, extension/CORS issue) and must be visually distinct
 * from an actual missing page so users don't think the page is gone.
 */
export function PublicPageFetchError({ onRetry, details }: PublicPageFetchErrorProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="rounded-full bg-amber-100 dark:bg-amber-900/30 p-4">
            <AlertTriangle className="h-10 w-10 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Страница временно недоступна
          </h1>
          <p className="text-muted-foreground">
            Не удалось загрузить содержимое. Это может быть связано с временным сбоем сети, расширением браузера или кешем. Попробуйте обновить страницу.
          </p>
        </div>
        <div className="flex justify-center">
          <Button
            onClick={() => {
              if (onRetry) onRetry();
              else window.location.reload();
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить страницу
          </Button>
        </div>
        {details && (
          <details className="text-left text-xs text-muted-foreground/70 mt-4">
            <summary className="cursor-pointer">Технические детали</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all bg-muted p-2 rounded">
              {details}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
