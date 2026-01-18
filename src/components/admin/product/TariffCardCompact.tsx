import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Pencil, Trash2, Copy, ExternalLink, ChevronDown,
  CreditCard, Zap, Tag, Clock
} from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/GlassCard";

interface TariffOffer {
  id: string;
  offer_type: "pay_now" | "trial" | "preregistration";
  button_label: string;
  amount: number;
  trial_days: number | null;
  auto_charge_after_trial: boolean;
  auto_charge_amount: number | null;
  is_active: boolean;
  is_primary?: boolean;
}

interface TariffCardCompactProps {
  tariff: {
    id: string;
    code: string;
    name: string;
    subtitle?: string;
    access_days: number;
    is_active: boolean;
    is_popular?: boolean;
    badge?: string;
  };
  offers: TariffOffer[];
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onViewOnSite?: () => void;
}

export function TariffCardCompact({
  tariff,
  offers,
  onEdit,
  onDelete,
  onDuplicate,
  onViewOnSite,
}: TariffCardCompactProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Primary offer takes precedence, fallback to first active pay_now
  const mainOffer = offers.find(o => o.offer_type === "pay_now" && o.is_active && o.is_primary) 
    || offers.find(o => o.offer_type === "pay_now" && o.is_active);
  const trialOffer = offers.find(o => o.offer_type === "trial" && o.is_active);
  // Has main price if there's any active pay_now offer
  const hasMainPayOffer = offers.some(o => o.offer_type === "pay_now" && o.is_active);

  const copyCode = () => {
    navigator.clipboard.writeText(tariff.code);
    toast.success("Код скопирован");
  };

  return (
    <GlassCard className="p-4">
      {/* Header Row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground">{tariff.name}</h3>
            <Badge variant={tariff.is_active ? "default" : "secondary"} className="shrink-0">
              {tariff.is_active ? "Активен" : "Неактивен"}
            </Badge>
            {tariff.is_popular && (
              <Badge variant="outline" className="border-primary text-primary shrink-0">
                Популярный
              </Badge>
            )}
            {trialOffer && (
              <Badge variant="outline" className="shrink-0">
                Trial {trialOffer.trial_days} дн.
              </Badge>
            )}
            {!hasMainPayOffer && (
              <Badge variant="destructive" className="shrink-0 text-xs">
                Нет основной цены
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
            <button 
              onClick={copyCode}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Tag className="h-3 w-3" />
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{tariff.code}</code>
            </button>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {tariff.access_days} дней
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {onViewOnSite && (
            <Button variant="ghost" size="icon" onClick={onViewOnSite} title="Смотреть на сайте">
              <ExternalLink className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onEdit} title="Редактировать">
            <Pencil className="h-4 w-4" />
          </Button>
          {onDuplicate && (
            <Button variant="ghost" size="icon" onClick={onDuplicate} title="Дублировать">
              <Copy className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onDelete} title="Удалить">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Collapsible Details */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full mt-3 flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 hover:bg-primary/5 border border-transparent hover:border-primary/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 group">
          <span className="text-muted-foreground text-sm group-hover:text-foreground transition-colors">
            Подробности
          </span>
          <ChevronDown className={`h-4 w-4 text-muted-foreground group-hover:text-foreground transition-all duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3 space-y-3">
          {/* Main Price */}
          {mainOffer ? (
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <CreditCard className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="font-medium">{mainOffer.amount} BYN</div>
                  <div className="text-xs text-muted-foreground">
                    {mainOffer.button_label}
                  </div>
                </div>
              </div>
              <Badge variant={mainOffer.is_active ? "default" : "secondary"}>
                {mainOffer.is_active ? "Активна" : "Неактивна"}
              </Badge>
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-muted/50 text-center text-sm text-muted-foreground">
              Нет кнопки оплаты
            </div>
          )}

          {/* Trial */}
          {trialOffer && (
            <div className="flex items-center justify-between p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <Zap className="h-4 w-4 text-amber-500" />
                </div>
                <div>
                  <div className="font-medium">
                    {trialOffer.amount} BYN / {trialOffer.trial_days} дней
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {trialOffer.auto_charge_after_trial && (
                      <span className="text-amber-600">
                        → автосписание {trialOffer.auto_charge_amount} BYN
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Badge variant={trialOffer.is_active ? "default" : "secondary"}>
                {trialOffer.is_active ? "Активен" : "Неактивен"}
              </Badge>
            </div>
          )}

          {/* Payment Plans placeholder */}
          <div className="text-xs text-muted-foreground text-center py-2">
            Планы рассрочки: {offers.length > 2 ? offers.length - 2 : 0}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </GlassCard>
  );
}
