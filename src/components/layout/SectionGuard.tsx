import { ReactNode } from "react";
import { useSectionAccess } from "@/hooks/useSectionAccess";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "./DashboardLayout";
import { SectionLockedState } from "@/components/sections/SectionLockedState";

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
 * - isError → deny + error UI внутри DashboardLayout
 * - is_public=true → всегда пропускает
 * - is_public=false + has_access=true → пропускает
 * - is_public=false + has_access=false → paywall (SectionLockedState) внутри DashboardLayout
 * - is_active=false → inactive screen внутри DashboardLayout
 * - Admin → всегда пропускает (через RPC + early shortcut)
 * - Section not found in app_sections → пропускает (unmapped route)
 * - НЕ делает redirect
 *
 * Все deny/error/inactive экраны рендерятся внутри DashboardLayout,
 * чтобы сохранить sidebar, breadcrumbs и header платформы.
 */
export function SectionGuard({ sectionCode, children }: SectionGuardProps) {
  const { checkAccess, isLoading, isError, gatingEnabled } = useSectionAccess();

  // Kill-switch disabled → pass through
  if (!gatingEnabled) {
    return <>{children}</>;
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // RPC error → deny with error UI inside DashboardLayout
  if (isError) {
    return (
      <DashboardLayout>
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
      </DashboardLayout>
    );
  }

  const access = checkAccess(sectionCode);

  // Section not found in app_sections → pass through (safe default for unmapped routes)
  if (!access.found) {
    return <>{children}</>;
  }

  // Inactive section → deny inside DashboardLayout (admin bypassed via checkAccess)
  if (!access.is_active) {
    return (
      <DashboardLayout>
        <SectionLockedState
          sectionCode={sectionCode}
          sectionLabel={access.section_label}
          isInactive
        />
      </DashboardLayout>
    );
  }

  // Public section → always allow
  if (access.is_public) {
    return <>{children}</>;
  }

  // Gated + has access → allow
  if (access.has_access) {
    return <>{children}</>;
  }

  // Gated + no access → paywall inside DashboardLayout
  return (
    <DashboardLayout>
      <SectionLockedState
        sectionCode={sectionCode}
        sectionLabel={access.section_label}
      />
    </DashboardLayout>
  );
}
