import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

interface PricingBlockEditorProps {
  content: Record<string, unknown>;
  onChange: (content: Record<string, unknown>) => void;
}

interface ProductOption {
  id: string;
  name: string;
}

export function PricingBlockEditor({ content, onChange }: PricingBlockEditorProps) {
  const [products, setProducts] = useState<ProductOption[]>([]);

  useEffect(() => {
    supabase
      .from("products_v2")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setProducts(data);
      });
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Продукт</Label>
        <Select
          value={(content.product_id as string) || ""}
          onValueChange={(v) => onChange({ ...content, product_id: v })}
        >
          <SelectTrigger><SelectValue placeholder="Выберите продукт" /></SelectTrigger>
          <SelectContent>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Заголовок секции</Label>
        <RichTextarea
          inline
          value={(content.title as string) || ""}
          onChange={(v) => onChange({ ...content, title: v })}
          placeholder="Тарифы"
        />
      </div>
      <div>
        <Label className="text-xs">Подзаголовок</Label>
        <RichTextarea
          inline
          value={(content.subtitle as string) || ""}
          onChange={(v) => onChange({ ...content, subtitle: v })}
          placeholder="Выберите подходящий тариф"
        />
      </div>
    </div>
  );
}
