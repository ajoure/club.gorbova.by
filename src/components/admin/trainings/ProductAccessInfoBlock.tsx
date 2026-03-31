import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ExternalLink, ShieldCheck, AlertTriangle, Info, ChevronDown } from "lucide-react";
import { useState } from "react";

interface ProductAccessInfoBlockProps {
  productId: string;
  moduleId?: string;
  className?: string;
}

/**
 * PATCH A — Enhanced readonly info block for training modules linked to a product.
 * Shows:
 *   Layer 1: linked product info + navigation
 *   Layer 2: placeholder for training_content rules (PATCH B)
 *   Diagnostics: binding_source, legacy badge, conflict info
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

  // Diagnostics: legacy module_access count
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

  // Diagnostics: training_content rules count
  const { data: rulesCount = 0 } = useQuery({
    queryKey: ["module-training-content-rules-count", moduleId],
    queryFn: async () => {
      if (!moduleId) return 0;
      const { count, error } = await supabase
        .from("access_rules")
        .select("id", { count: "exact", head: true })
        .eq("grant_target_type", "training_content")
        .eq("target_ref", moduleId);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!moduleId,
  });

  const bindingSource = productId
    ? (legacyCount > 0 ? "mixed_conflict" : "product_id")
    : (legacyCount > 0 ? "legacy_only" : "none");

  return (
    <Alert className={`border-primary/30 bg-primary/5 ${className || ""}`}>
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

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => navigate(`/admin/products-v2/${productId}`)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Открыть продукт
          </Button>
        </div>

        {/* Layer 2: training_content rules placeholder */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
          <ShieldCheck className="h-3 w-3" />
          <span>Правила гранулярности контента</span>
          {rulesCount > 0 ? (
            <Badge variant="outline" className="text-[9px]">{rulesCount}</Badge>
          ) : (
            <Badge variant="outline" className="text-[9px]">Не настроено</Badge>
          )}
        </div>

        {/* Legacy badge */}
        {legacyCount > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            legacy module_access: {legacyCount} записей
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
              <div>binding_source: {bindingSource}</div>
              <div>training_content rules: {rulesCount}</div>
              <div>legacy module_access: {legacyCount}</div>
              {legacyCount > 0 && productId && (
                <div className="text-amber-600">⚠ Конфликт: legacy + product_id</div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}
