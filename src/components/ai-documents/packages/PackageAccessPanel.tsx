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
import { Globe2, LockKeyhole, PackageOpen, Settings2 } from "lucide-react";
import { toast } from "sonner";

interface AccessRuleRow {
  id: string;
  product_id: string | null;
  tariff_id: string | null;
  target_label: string | null;
  conditions: Record<string, unknown> | null;
  product: { id: string; name: string } | null;
  tariff: { id: string; name: string } | null;
}

interface PackageAccessPanelProps {
  packageId: string;
  packageName: string;
  isActive: boolean;
  isAvailableToAll: boolean;
}

function getPackageIds(rule: AccessRuleRow): string[] {
  const value = rule.conditions?.allowed_package_ids;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function ruleGrantsPackage(rule: AccessRuleRow, packageId: string): boolean {
  return rule.conditions?.access_mode !== "partial" || getPackageIds(rule).includes(packageId);
}

/**
 * Access is deliberately scoped to one package. Product rules stay canonical;
 * this panel only shows the rules that grant the currently selected package.
 */
export function PackageAccessPanel({
  packageId,
  packageName,
  isActive,
  isAvailableToAll,
}: PackageAccessPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);

  const rulesQuery = useQuery({
    queryKey: ["document-package-access-rules", packageId],
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

  const matchingRules = useMemo(
    () => (rulesQuery.data ?? []).filter((rule) => ruleGrantsPackage(rule, packageId)),
    [rulesQuery.data, packageId],
  );

  const updateDefaultAccess = useMutation({
    mutationFn: async (availableToAll: boolean) => {
      const { error } = await supabase.rpc("set_global_document_package_default_access", {
        _package_id: packageId,
        _is_available_to_all: availableToAll,
      });
      if (error) throw error;
    },
    onSuccess: async (_, availableToAll) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace-package-templates"] }),
        queryClient.invalidateQueries({ queryKey: ["pkg-admin-packages"] }),
        queryClient.invalidateQueries({ queryKey: ["access-rule-document-packages"] }),
        queryClient.invalidateQueries({ queryKey: ["section-access"] }),
        queryClient.invalidateQueries({ queryKey: ["document-package-access-rules", packageId] }),
      ]);
      toast.success(availableToAll
        ? `Пакет «${packageName}» открыт всем авторизованным клиентам`
        : `Пакет «${packageName}» закрыт по умолчанию`);
    },
    onError: (error: Error) => toast.error(`Не удалось изменить доступ: ${error.message}`),
  });

  return (
    <GlassCard className="p-4 space-y-4 border-primary/15">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3 min-w-0">
          <div className="mt-0.5 h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <PackageOpen className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Доступ к пакету «{packageName}»</h3>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Настройка действует только на этот пакет. Доступ остальных пакетов не меняется.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("/admin/products-v2")}>
          <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Настроить продукты
        </Button>
      </div>

      {!isActive && (
        <div className="rounded-lg border border-amber-400/40 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          Пакет деактивирован. Сначала активируйте его в меню пакета, затем откройте доступ клиентам.
        </div>
      )}

      <div className="rounded-xl border border-border/70 bg-background/35 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2.5">
          {isAvailableToAll
            ? <Globe2 className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
            : <LockKeyhole className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />}
          <div>
            <p className="text-xs font-medium">Доступен всем авторизованным клиентам</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">
              {isAvailableToAll
                ? "Пакет увидит каждый вошедший клиент. Остальные пакеты останутся закрытыми."
                : "Пакет увидят только клиенты, которым он выдан через правила доступа продукта."}
            </p>
          </div>
        </div>
        <Switch
          checked={isAvailableToAll}
          disabled={!isActive || updateDefaultAccess.isPending}
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
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-xs font-medium">Выдачи через продукты</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">{matchingRules.length}</Badge>
        </div>

        {rulesQuery.isLoading ? (
          <p className="text-xs text-muted-foreground py-2">Загрузка правил…</p>
        ) : matchingRules.length === 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground">
            Активных выдач этого пакета через продукты пока нет. Добавьте правило в нужном продукте или включите общий доступ выше.
          </div>
        ) : (
          <div className="space-y-2">
            {matchingRules.map((rule) => {
              const fullAccess = rule.conditions?.access_mode !== "partial";
              const target = rule.tariff?.name
                ? `${rule.product?.name ?? "Продукт"} · ${rule.tariff.name}`
                : rule.product?.name ?? "Продукт без названия";
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
                    <Badge variant="outline" className="text-[10px]">{fullAccess ? "все пакеты" : "выбранный пакет"}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {fullAccess ? "Правило открывает все активные пакеты документов." : "Правило включает этот пакет по его постоянному UUID."}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Путь настройки выдачи: «Продукты» → нужный продукт → «Правила доступа» → «Доступ к контенту» → «Генерация документов».
      </p>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Закрыть доступ для всех?</AlertDialogTitle>
            <AlertDialogDescription>
              Обычные клиенты смогут видеть «{packageName}» только по активным правилам продуктов. Это не затронет другие пакеты документов.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => updateDefaultAccess.mutate(false)}>
              Закрыть доступ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </GlassCard>
  );
}
