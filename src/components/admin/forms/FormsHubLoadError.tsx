import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FormsHubLoadErrorProps {
  onRetry: () => void;
}

/**
 * Never present an authorization/query failure as a legitimate empty archive.
 */
export function FormsHubLoadError({ onRetry }: FormsHubLoadErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-10 text-center"
    >
      <AlertCircle className="h-8 w-8 text-destructive" />
      <div>
        <p className="font-medium text-foreground">Не удалось загрузить данные</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Это ошибка загрузки, а не отсутствие исторических записей.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Повторить
      </Button>
    </div>
  );
}
