import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FileStack, Globe2, LockKeyhole, PackageOpen, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface PackageOption {
  id: string;
  name: string;
}

interface AccessRuleRow {
  id: string;
  product_id: string | null;
  tariff_id: string | null;
  target_label: string | null;
  conditions: Record<string, unknown> | null;
  product: { id: string; name: string } | null;
  tariff: { id: string; name: string } | null;
}

interface DocumentGenerationAccessPanelProps {
  packages: PackageOption[];
}

function getPackageIds(rule: AccessRuleRow): string[] {
  const value = rule.conditions?.allowed_package_ids;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * One control point for the user-facing document-generation section.
 * `app_sections.is_public` is intentionally the default-access policy;
 * product rules remain the canonical source for restricted access.
 */
export function DocumentGenerationAccessPanel({ packages }: DocumentGenerationAccessPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  const sectionQuery = useQuery({
    queryKey: ["document-generation-access-section"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_sections")
        .select("id, label, is_public, is_active")
        .eq("code", "document_generation")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const rulesQuery = useQuery({
    queryKey: ["document-generation-access-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_rules")
        .select("id, product_id, tariff_id, target_label, conditions, product:products_v2(id, name), tariff:tariffs(id, name)")
        .eq("grant_target_type", "document_generation")
        .eq("target_ref", "document_generation")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AccessRuleRow[];
    },
  });

  const rules = rulesQuery.data ?? [];
  const packageNames = useMemo(() => new Map(packages.map((pkg) => [pkg.id, pkg.name])), [packages]);

  const updateDefaultAccess = useMutation({
    mutationFn: async (isPublic: boolean) => {
      const section = sectionQuery.data;
      if (!section) throw new Error("Раздел «Генерация документов» не найден");
      const { error } = await supabase
        .from("app_sections")
        .update({ is_public: isPublic, updated_at: new Date().toISOString() } as never)
        .eq("id", section.id);
      if (error) throw error;
    },
    onSuccess: async (_, isPublic) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["document-generation-access-section"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-sections"] }),
        queryClient.invalidateQueries({ queryKey: ["section-access"] }),
        queryClient.invalidateQueries({ queryKey: ["access-rule-sections"] }),
      ]);
      toast.success(isPublic ? "Генерация документов доступна всем клиентам" : "Доступ закрыт по умолчанию");
    },
    onError: (error: Error) => toast.error(`Не удалось изменить доступ: ${error.message}`),
  });

  const section = sectionQuery.data;
  const isPublic = section?.is_public ?? false;
  const isLoading = sectionQuery.isLoading || rulesQuery.isLoading;
  const hasRules = rules.length > 0;

  return (
    <GlassCard className="p-4 space-y-4 border-primary/15">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3 min-w-0">
          <div className="mt-0.5 h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <FileStack className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Доступ к генерации документов</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Здесь задаётся доступ по умолчанию для раздела и всех активных глобальных пакетов.
              Ограниченный доступ выдаётся в настройках конкретного продукта.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("/admin/products-v2")}>
          <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Настроить продукты
        </Button>
      </div>

      {!sectionQuery.isLoading && !section && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Системный раздел «Генерация документов» не найден. Восстановите его в «Разделах платформы».
        </div>
      )}

      {section && !section.is_active && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          Раздел деактивирован в «Разделах платформы». Пока он не активен, пользователи его не увидят при любом режиме доступа.
        </div>
      )}

      <div className="rounded-xl border border-border/70 bg-background/35 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2.5">
          {isPublic ? <Globe2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" /> : <LockKeyhole className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />}
          <div>
            <p className="text-xs font-medium">Доступен всем авторизованным клиентам</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
              {isPublic
                ? "Раздел и все активные глобальные пакеты открыты всем вошедшим в систему пользователям."
                : "По умолчанию раздел скрыт. Его увидят только клиенты с активным правилом доступа у продукта."}
            </p>
          </div>
        </div>
        <Switch
          checked={isPublic}
          disabled={isLoading || !section?.is_active || updateDefaultAccess.isPending}
          aria-label="Доступен всем авторизованным клиентам"
          onCheckedChange={(checked) => {
            if (checked) updateDefaultAccess.mutate(true);
            else setConfirmClose(true);
          }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-medium">Активные выдачи через продукты</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">{rules.length}</Badge>
        </div>

        {rulesQuery.isLoading ? (
          <p className="text-xs text-muted-foreground py-2">Загрузка правил…</p>
        ) : !hasRules ? (
          <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Правил пока нет. Если отключить общий доступ, обычные пользователи не увидят этот раздел, пока правило не будет добавлено к продукту.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => {
              const ids = getPackageIds(rule);
              const fullAccess = rule.conditions?.access_mode !== "partial";
              const target = rule.tariff?.name
                ? `${rule.product?.name ?? "Продукт"} · ${rule.tariff.name}`
                : rule.product?.name ?? "Продукт без названия";
              const packagesLabel = fullAccess
                ? "Все активные пакеты"
                : ids.length === 0
                  ? "Пакеты не выбраны"
                  : ids.map((id) => packageNames.get(id) ?? "Удалённый пакет").join(", ");

              return (
                <button
                  key={rule.id}
                  type="button"
                  onClick={() => rule.product_id && navigate(`/admin/products-v2/${rule.product_id}?tab=access_rules`)}
                  className="w-full rounded-lg border border-border/60 bg-background/25 px-3 py-2 text-left transition-colors hover:bg-muted/50 disabled:cursor-default"
                  disabled={!rule.product_id}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{target}</span>
                    <Badge variant="outline" className="text-[10px]">{fullAccess ? "полный" : "выбранные пакеты"}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground truncate" title={packagesLabel}>{packagesLabel}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Путь настройки: «Продукты» → нужный продукт → «Правила доступа» → «Доступ к контенту» → «Генерация документов».
      </p>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть общий доступ?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasRules
                ? `Генерация документов останется доступной только по ${rules.length} активным правилам продуктов. Пакеты будут отфильтрованы согласно каждому правилу.`
                : "Активных правил продуктов нет. После закрытия раздел останется доступен только администраторам, пока вы не добавите правило к продукту."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => updateDefaultAccess.mutate(false)}>
              Закрыть общий доступ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  );
}
