import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Pencil, Trash2, Check, X, Star, CreditCard } from "lucide-react";
import type { PaymentMethod } from "@/hooks/useTariffOffers";

interface OfferRowCompactProps {
  offer: {
    id: string;
    offer_type: "pay_now" | "trial";
    button_label: string;
    amount: number;
    trial_days: number | null;
    auto_charge_after_trial: boolean;
    auto_charge_amount: number | null;
    is_active: boolean;
    is_primary?: boolean;
    payment_method?: PaymentMethod;
    installment_count?: number | null;
    installment_interval_days?: number | null;
  };
  onToggleActive: (id: string, isActive: boolean) => void;
  onUpdateLabel: (id: string, label: string) => void;
  onSetPrimary?: (id: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  hasPrimaryInTariff?: boolean;
}

export function OfferRowCompact({
  offer,
  onToggleActive,
  onUpdateLabel,
  onSetPrimary,
  onEdit,
  onDelete,
  hasPrimaryInTariff = false,
}: OfferRowCompactProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(offer.button_label);

  const handleSave = () => {
    if (editValue.trim() && editValue !== offer.button_label) {
      onUpdateLabel(offer.id, editValue.trim());
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditValue(offer.button_label);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleCancel();
  };

  const isPrimary = offer.is_primary && offer.offer_type === "pay_now";
  const canBePrimary = offer.offer_type === "pay_now" && offer.is_active && !isPrimary;
  const isInstallment = offer.payment_method === "internal_installment";
  const isBankInstallment = offer.payment_method === "bank_installment";

  // Calculate installment info
  const getInstallmentInfo = () => {
    if (!isInstallment || !offer.installment_count) return null;
    const perPayment = offer.amount / offer.installment_count;
    return {
      count: offer.installment_count,
      perPayment: perPayment.toFixed(2),
      intervalDays: offer.installment_interval_days || 30,
    };
  };

  const installmentInfo = getInstallmentInfo();

  return (
    <div className={`flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors ${
      isPrimary 
        ? "bg-primary/5 border-primary/30" 
        : "bg-card/50 border-border/50 hover:bg-card"
    }`}>
      {/* Left: Type badge + Label */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge 
            variant={offer.offer_type === "trial" ? "secondary" : "default"}
            className="shrink-0"
          >
            {offer.offer_type === "trial" ? "Trial" : "Оплата"}
          </Badge>
          {isPrimary && (
            <Badge variant="outline" className="shrink-0 border-primary text-primary gap-1">
              <Star className="h-3 w-3" />
              Основная
            </Badge>
          )}
          {isInstallment && (
            <Badge variant="outline" className="shrink-0 border-amber-500 text-amber-600 gap-1">
              <CreditCard className="h-3 w-3" />
              Рассрочка
            </Badge>
          )}
          {isBankInstallment && (
            <Badge variant="outline" className="shrink-0 border-blue-500 text-blue-600 gap-1">
              <CreditCard className="h-3 w-3" />
              Банк
            </Badge>
          )}
        </div>
        
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-7 text-sm"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave}>
                <Check className="h-4 w-4 text-green-500" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancel}>
                <X className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ) : (
            <div 
              onClick={() => setIsEditing(true)}
              className="cursor-pointer hover:text-primary transition-colors"
            >
              <div className="font-medium truncate">{offer.button_label}</div>
              <div className="text-xs text-muted-foreground">
                {offer.amount} BYN
                {offer.offer_type === "trial" && (
                  <>
                    {" "}• {offer.trial_days} дней
                    {offer.auto_charge_after_trial && (
                      <span className="text-amber-600">
                        {" "}→ {offer.auto_charge_amount} BYN
                      </span>
                    )}
                  </>
                )}
                {installmentInfo && (
                  <span className="text-amber-600">
                    {" "}• {installmentInfo.count}×{installmentInfo.perPayment} BYN / {installmentInfo.intervalDays} дн.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Primary toggle + Active toggle + Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Set as Primary button - only for pay_now offers */}
        {canBePrimary && onSetPrimary && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-8 text-xs text-muted-foreground hover:text-primary"
            onClick={() => onSetPrimary(offer.id)}
          >
            Сделать основной
          </Button>
        )}
        
        <Switch
          checked={offer.is_active}
          onCheckedChange={(checked) => onToggleActive(offer.id, checked)}
        />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}
