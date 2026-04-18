import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { supabase } from "@/integrations/supabase/client";
import type { PaymentLinkRow } from "@/hooks/usePaymentLinks";

export function EditPaymentLinkDialog({
  link,
  onOpenChange,
}: {
  link: PaymentLinkRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  useEffect(() => {
    if (link) {
      setOpen(true);
      setDescription(link.description ?? "");
      setMaxUses(link.max_uses != null ? String(link.max_uses) : "");
      setExpiresAt(link.expires_at ? link.expires_at.slice(0, 16) : "");
    } else {
      setOpen(false);
    }
  }, [link]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!link) throw new Error("Нет ссылки");
      const body: Record<string, unknown> = { payment_link_id: link.id };

      body.description = description.trim() || null;

      if (maxUses === "") {
        body.max_uses = null;
      } else {
        const n = parseInt(maxUses, 10);
        if (!Number.isFinite(n) || n < 1) throw new Error("Лимит должен быть целым положительным числом");
        if (n < link.current_uses) throw new Error(`Лимит не может быть меньше уже использованных (${link.current_uses})`);
        body.max_uses = n;
      }

      if (expiresAt === "") {
        body.expires_at = null;
      } else {
        const d = new Date(expiresAt);
        if (isNaN(d.getTime())) throw new Error("Некорректная дата истечения");
        if (d.getTime() <= Date.now()) throw new Error("Дата истечения должна быть в будущем");
        body.expires_at = d.toISOString();
      }

      const { data, error } = await supabase.functions.invoke("admin-update-payment-link", { body });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Не удалось сохранить");
      return data;
    },
    onSuccess: () => {
      toast.success("Ссылка обновлена");
      qc.invalidateQueries({ queryKey: ["payment-links-enriched"] });
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error("Ошибка: " + (e as Error).message);
    },
  });

  const handleClose = (o: boolean) => {
    setOpen(o);
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Изменить ссылку</DialogTitle>
          <DialogDescription>
            Безопасное редактирование. Сумма, продукт, тариф, кнопка и получатель не меняются —
            это защищает целостность связанных заказов.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea
              rows={2}
              placeholder="Внутренняя пометка"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Лимит использований</Label>
              <Input
                type="number" min="1" placeholder="Без лимита"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
              <div className="text-[11px] text-muted-foreground">
                Использовано сейчас: {link?.current_uses ?? 0}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Истекает</Label>
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>Отмена</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить изменения
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
