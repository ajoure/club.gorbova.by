import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

/**
 * Локальный страховочный error boundary для контента урока.
 *
 * Ловит ошибки рендера/коммита от вложенных блоков (видео-плееров, виджетов и т.п.)
 * и показывает аккуратный fallback вместо того, чтобы рушить всю страницу урока.
 *
 * Это НЕ заменяет нормальное обращение с ошибками внутри блоков — это ремень
 * безопасности на случай, когда сторонняя библиотека (например, Kinescope SDK)
 * мутирует DOM так, что React падает в commit-фазе.
 */
export class LessonBlocksErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error?.message ?? null };
  }

  componentDidCatch(error: Error) {
    console.error("[LessonBlocksErrorBoundary] caught:", error);
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold mb-1">Не удалось отобразить содержимое урока</h3>
              <p className="text-sm mb-4 opacity-90">
                Произошла ошибка при рендере одного из блоков. Это не влияет на ваш доступ —
                попробуйте перезагрузить страницу.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={this.handleReset}>
                  Попробовать снова
                </Button>
                <Button size="sm" onClick={this.handleReload} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Перезагрузить
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
