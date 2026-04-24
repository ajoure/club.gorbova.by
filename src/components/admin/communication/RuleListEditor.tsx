import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, X } from "lucide-react";

export type AudienceMode = "purchased" | "active_access";

export interface AudienceRule {
  product_id: string;
  tariff_ids: string[];
  mode: AudienceMode;
}

interface Props {
  title: string;
  emptyHint: string;
  rules: AudienceRule[];
  products: Array<{ id: string; name: string }>;
  tariffs: Array<{ id: string; name: string; product_id: string }>;
  onChange: (next: AudienceRule[]) => void;
  destructive?: boolean;
}

export function RuleListEditor({
  title,
  emptyHint,
  rules,
  products,
  tariffs,
  onChange,
  destructive,
}: Props) {
  const addRule = () =>
    onChange([...rules, { product_id: "", tariff_ids: [], mode: "purchased" }]);
  const updateRule = (i: number, patch: Partial<AudienceRule>) =>
    onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i: number) => onChange(rules.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{title}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={addRule}
        >
          <Plus className="h-3 w-3" />
          Условие
        </Button>
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule, i) => {
            const productTariffs = tariffs.filter((t) => t.product_id === rule.product_id);
            return (
              <div
                key={i}
                className={`rounded-md border p-2 space-y-2 ${
                  destructive ? "border-destructive/30 bg-destructive/5" : "bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Select
                    value={rule.product_id || "__any__"}
                    onValueChange={(v) =>
                      updateRule(i, {
                        product_id: v === "__any__" ? "" : v,
                        tariff_ids: [],
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Любой продукт</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => removeRule(i)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                <Select
                  value={rule.mode}
                  onValueChange={(v) => updateRule(i, { mode: v as AudienceMode })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchased">Покупал когда-либо</SelectItem>
                    <SelectItem value="active_access">Сейчас активный доступ</SelectItem>
                  </SelectContent>
                </Select>

                {rule.product_id && productTariffs.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-full justify-start font-normal text-xs"
                      >
                        {rule.tariff_ids.length === 0
                          ? "Все тарифы"
                          : `Тарифы: ${rule.tariff_ids.length}`}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60 p-2" align="start">
                      <div className="space-y-1.5">
                        {productTariffs.map((t) => (
                          <label
                            key={t.id}
                            className="flex items-center gap-2 cursor-pointer text-sm"
                          >
                            <Checkbox
                              checked={rule.tariff_ids.includes(t.id)}
                              onCheckedChange={(checked) =>
                                updateRule(i, {
                                  tariff_ids: checked
                                    ? [...rule.tariff_ids, t.id]
                                    : rule.tariff_ids.filter((id) => id !== t.id),
                                })
                              }
                            />
                            {t.name}
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {rule.tariff_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {rule.tariff_ids.map((tid) => {
                      const name = tariffs.find((t) => t.id === tid)?.name;
                      return (
                        <Badge key={tid} variant="outline" className="text-[10px]">
                          {name}
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
