import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalLink, ShieldCheck } from "lucide-react";

interface ProductAccessInfoBlockProps {
  productId: string;
  className?: string;
}

/**
 * PATCH v23.1.6 — readonly info block for training modules linked to a product.
 * Shows product name, badge, and navigation to product access settings.
 * Replaces ProductTariffAccessSelector for modules with product_id.
 */
export function ProductAccessInfoBlock({ productId, className }: ProductAccessInfoBlockProps) {
  const navigate = useNavigate();

  const { data: product } = useQuery({
    queryKey: ["product-name", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("id", productId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!productId,
  });

  return (
    <Alert className={`border-primary/30 bg-primary/5 ${className || ""}`}>
      <ShieldCheck className="h-4 w-4 text-primary" />
      <AlertDescription className="ml-2 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="border-primary/40 text-primary text-xs">
            Новый контур доступа
          </Badge>
        </div>
        <p className="text-sm">
          Доступ управляется через продукт:{" "}
          <strong>{product?.name || "Загрузка..."}</strong>
        </p>
        <p className="text-xs text-muted-foreground">
          Для изменения доступа используйте вкладку «Доступы» в настройках продукта
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => navigate(`/admin/products-v2/${productId}`)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Открыть продукт
        </Button>
      </AlertDescription>
    </Alert>
  );
}
