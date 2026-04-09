import { ReactNode } from "react";
import { useSectionAccess } from "@/hooks/useSectionAccess";
import { resolveSectionCode } from "@/constants/sectionCodes";
import { Loader2, Lock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SectionGuardProps {
  sectionCode: string;
  children: ReactNode;
}

/**
 * SectionGuard — обёртка для защиты контента секции.
 *
 * Контракт:
 * - Kill-switch off → всегда пропускает
 * - Loading → spinner
 * - RPC error → deny + error UI (данных нет, нельзя определить public/gated)
 * - is_public=true → всегда пропускает
 * - is_public=false + has_access=true → пропускает
 * - is_public=false + has_access=false → overlay/paywall
 * - Admin → всегда пропускает (через RPC + early shortcut)
 * - Section not found in app_sections → пропускает (unmapped route)
 * - НЕ делает redirect
 */
export function SectionGuard({ sectionCode: rawCode, children }: SectionGuardProps) {
  const { checkAccess, isLoading, isError, gatingEnabled } = useSectionAccess();
  const sectionCode = resolveSectionCode(rawCode);

  // 1. Kill-switch disabled → pass through
  if (!gatingEnabled) {
    return <>{children}</>;
  }

  // 2. Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 3. RPC error → deny (данных нет, невозможно определить public/gated)
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center gap-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-lg font-semibold">Не удалось проверить доступ</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          Произошла ошибка при проверке прав доступа к разделу.
          Попробуйте обновить страницу.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Обновить страницу
        </Button>
      </div>
    );
  }

  // 4. Теперь данные загружены успешно — проверяем доступ
  const access = checkAccess(sectionCode);

  // Section not found in app_sections → pass through (safe default for unmapped routes)
  if (!access.found) {
    return <>{children}</>;
  }

  // Public section → always allow
  if (access.is_public) {
    return <>{children}</>;
  }

  // Gated + has access → allow
  if (access.has_access) {
    return <>{children}</>;
  }

  // Gated + no access → paywall overlay
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center gap-4">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Доступ ограничен</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        Раздел «{access.section_label}» доступен только по подписке.
      </p>
      {(access.granted_via_tariff_name || access.granted_via_product_name) && (
        <p className="text-xs text-muted-foreground">
          Доступ предоставляется через:{" "}
          <span className="font-medium text-foreground">
            {access.granted_via_tariff_name || access.granted_via_product_name}
          </span>
        </p>
      )}
    </div>
  );
}
