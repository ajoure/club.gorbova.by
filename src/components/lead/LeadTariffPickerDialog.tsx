/**
 * LeadTariffPickerDialog — compact picker shown when a product-level lead CTA
 * fires while more than one active lead offer exists. Displays the tariff name
 * (+ button_label as secondary hint) and returns the selected {tariff_id,
 * offer_id} to the caller. The caller is responsible for re-validating the
 * pair against the latest product data before opening LeadRequestDialog.
 *
 * The picker itself does NOT open LeadRequestDialog — separation of concerns
 * keeps re-validation in the site-action handler where product data lives.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface LeadPickerOption {
  tariff_id: string;
  tariff_name: string;
  offer_id: string;
  button_label: string;
}

interface LeadTariffPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: LeadPickerOption[];
  onSelect: (option: LeadPickerOption) => void;
  productName?: string;
}

export function LeadTariffPickerDialog({
  open,
  onOpenChange,
  options,
  onSelect,
  productName,
}: LeadTariffPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Выберите тариф</DialogTitle>
          <DialogDescription>
            {productName
              ? `Заявка на ${productName}. Уточните интересующий тариф — от этого зависит содержание заявки.`
              : "Уточните интересующий тариф — от этого зависит содержание заявки."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 pt-2">
          {options.map((opt) => (
            <Button
              key={opt.offer_id}
              variant="outline"
              className="w-full justify-start h-auto py-3 px-4 whitespace-normal text-left"
              onClick={() => onSelect(opt)}
              data-testid={`lead-picker-option-${opt.tariff_id}`}
            >
              <div className="flex flex-col items-start gap-0.5">
                <span className="font-medium">{opt.tariff_name}</span>
                {opt.button_label && opt.button_label !== opt.tariff_name && (
                  <span className="text-xs text-muted-foreground">{opt.button_label}</span>
                )}
              </div>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
