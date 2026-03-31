import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTrainingContentRulesForProduct, type TrainingContentRule } from "@/hooks/useTrainingContentRules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExternalLink, ShieldCheck, AlertTriangle, Info, ChevronDown, Settings, Plus, CheckCircle2, EyeOff, Pencil } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface ProductAccessInfoBlockProps {
  productId: string;
  moduleId?: string;
  className?: string;
}

/**
 * Actionable info block for training modules linked to a product.
 * Shows linked product, live training_content rules, diagnostics.
 * All navigation uses location.state for deep-linking into access_rules tab.
 */
export function ProductAccessInfoBlock({ productId, moduleId, className }: ProductAccessInfoBlockProps) {
  const navigate = useNavigate();
  const [diagOpen, setDiagOpen] = useState(false);

  const { data: product } = useQuery({
    queryKey: ["product-name-extended", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, public_id")
        .eq("id", productId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
  });

  // Legacy module_access count
  const { data: legacyCount = 0 } = useQuery({
    queryKey: ["module-legacy-access-count", moduleId],
    queryFn: async () => {
      if (!moduleId) return 0;
      const { count, error } = await supabase
        .from("module_access")
        .select("id", { count: "exact", head: true })
        .eq("module_id", moduleId);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!moduleId,
  });

  // Live training_content rules for this product
  const { data: allRules = [] } = useTrainingContentRulesForProduct(productId);

  // Filter rules relevant to this specific module (as target_ref)
  const moduleRules = moduleId ? allRules.filter(r => r.target_ref === moduleId) : [];
  const totalRulesCount = allRules.length;

  const bindingSource = productId
    ? (legacyCount > 0 ? "mixed_conflict" : "product_id")
    : (legacyCount > 0 ? "legacy_only" : "none");

  // Navigation helpers — unified via location.state
  const goToProduct = () => navigate(`/admin/products-v2/${productId}`);

  const goToAccessTab = () =>
    navigate(`/admin/products-v2/${productId}?tab=access_rules`);

  const goToCreateRule = () =>
    navigate(`/admin/products-v2/${productId}?tab=access_rules`, {
      state: { accessRulesAction: { type: "create_training_content", targetRef: moduleId } },
    });

  const goToEditRule = (ruleId: string) =>
    navigate(`/admin/products-v2/${productId}?tab=access_rules`, {
      state: { accessRulesAction: { type: "edit_rule", ruleId } },
    });

  return (
    <Alert className={cn("border-primary/30 bg-primary/5", className)}>
      <ShieldCheck className="h-4 w-4 text-primary" />
      <AlertDescription className="ml-2 space-y-3">
        {/* Layer 1: Linked product */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="border-primary/40 text-primary text-xs">
            Продуктовый контур
          </Badge>
          {product?.public_id && (
            <Badge variant="outline" className="text-[10px] font-mono">{product.public_id}</Badge>
          )}
        </div>
        <p className="text-sm">
          Доступ управляется через продукт:{" "}
          <strong>{product?.name || "Загрузка..."}</strong>
        </p>

        {/* Layer 2: Live training_content rules for this module */}
        {moduleId && (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3 w-3" />
              <span>Правила доступа к контенту</span>
            </div>

            {moduleRules.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-2 py-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                <span>Не настроено — полный доступ по продукту</span>
              </div>
            ) : (
              <div className="space-y-1">
                {moduleRules.map(rule => (
                  <RuleSummaryRow key={rule.id} rule={rule} onEdit={() => goToEditRule(rule.id)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-2" onClick={goToProduct}>
            <ExternalLink className="h-3.5 w-3.5" />
            Открыть продукт
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={goToAccessTab}>
            <Settings className="h-3.5 w-3.5" />
            Вкладка «Доступы»
          </Button>
          {moduleId && moduleRules.length === 0 && (
            <Button variant="outline" size="sm" className="gap-2 text-primary" onClick={goToCreateRule}>
              <Plus className="h-3.5 w-3.5" />
              Создать правило
            </Button>
          )}
          {moduleId && moduleRules.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2 text-primary" onClick={() => goToEditRule(moduleRules[0].id)}>
              <Pencil className="h-3.5 w-3.5" />
              Редактировать правило
            </Button>
          )}
        </div>

        {/* Legacy warning */}
        {legacyCount > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Старые настройки доступа: {legacyCount} записей
          </div>
        )}

        {/* Diagnostics */}
        {moduleId && (
          <Collapsible open={diagOpen} onOpenChange={setDiagOpen}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground mt-1">
                <Info className="h-3 w-3" />
                Диагностика
                <ChevronDown className="h-3 w-3" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 text-[10px] text-muted-foreground space-y-0.5 bg-muted/30 rounded-md px-2 py-1.5">
              <div>product_id: {productId}</div>
              <div>источник привязки: {bindingSource}</div>
              <div>правил доступа к контенту (всего по продукту): {totalRulesCount}</div>
              <div>правил доступа к контенту (для этого тренинга): {moduleRules.length}</div>
              <div>старые настройки (module_access): {legacyCount}</div>
              {legacyCount > 0 && productId && (
                <div className="text-amber-600">⚠ Конфликт: старый контур + продуктовый контур</div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Individual rule summary row */
function RuleSummaryRow({ rule, onEdit }: { rule: TrainingContentRule; onEdit: () => void }) {
  const cond = rule.conditions;
  const mCount = cond.allowed_module_ids?.length || 0;
  const lCount = cond.allowed_lesson_ids?.length || 0;

  return (
    <div className={cn(
      "flex items-center gap-2 p-2 rounded-md border text-xs",
      rule.is_active ? "bg-muted/20" : "bg-muted/10 opacity-60"
    )}>
      <Badge variant="outline" className="text-[9px] shrink-0">
        {rule.tariff_id ? "Тариф" : "Продукт"}
      </Badge>

      <Badge variant="outline" className={cn(
        "text-[9px] shrink-0",
        cond.access_mode === "partial" ? "text-amber-600 border-amber-300" : "text-green-600 border-green-300"
      )}>
        {cond.access_mode === "full" ? "Полный доступ" : `Частичный: ${mCount} мод. ${lCount} ур.`}
      </Badge>

      {!rule.is_active && (
        <Badge variant="outline" className="text-[9px] text-muted-foreground shrink-0">
          <EyeOff className="h-2.5 w-2.5 mr-0.5" />
          Неактивно
        </Badge>
      )}

      <div className="flex-1" />

      <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] gap-1" onClick={onEdit}>
        <Pencil className="h-2.5 w-2.5" />
        Редактировать
      </Button>
    </div>
  );
}
