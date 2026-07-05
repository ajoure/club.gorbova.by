import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Loader2 } from "lucide-react";

interface LeadRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  offerLabel?: string;
  commentPlaceholder?: string;
  successMessage?: string;
}

interface FormState {
  name: string;
  phone: string;
  email: string;
  comment: string;
  website: string; // honeypot
}

const emptyForm: FormState = {
  name: "",
  phone: "",
  email: "",
  comment: "",
  website: "",
};

export function LeadRequestDialog({
  open,
  onOpenChange,
  offerId,
  offerLabel,
  commentPlaceholder,
  successMessage,
}: LeadRequestDialogProps) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const openedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      setDone(false);
      setForm(emptyForm);
    }
  }, [open]);

  const canSubmit = useMemo(
    () =>
      form.name.trim().length > 0 &&
      form.phone.trim().length >= 5 &&
      /^\S+@\S+\.\S+$/.test(form.email.trim()),
    [form.name, form.phone, form.email],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "submit-lead-request",
        {
          body: {
            offer_id: offerId,
            name: form.name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim().toLowerCase(),
            comment: form.comment.trim() || null,
            website: form.website,
            form_opened_at: openedAtRef.current,
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDone(true);
    } catch (err) {
      console.error("[LeadRequestDialog] submit failed", err);
      toast.error(
        "Не удалось отправить заявку. Попробуйте ещё раз или напишите нам напрямую.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <div className="py-6 text-center space-y-4">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <DialogTitle>Заявка отправлена</DialogTitle>
            <DialogDescription>
              {successMessage ||
                "Спасибо! Мы свяжемся с вами в ближайшее время."}
            </DialogDescription>
            <Button onClick={() => onOpenChange(false)} className="w-full">
              Закрыть
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{offerLabel || "Оставить заявку"}</DialogTitle>
              <DialogDescription>
                Заполните форму — наш менеджер свяжется с вами.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* honeypot */}
              <input
                type="text"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={form.website}
                onChange={(e) =>
                  setForm({ ...form, website: e.target.value })
                }
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: 1,
                  height: 1,
                  opacity: 0,
                }}
              />
              <div className="space-y-2">
                <Label htmlFor="lead-name">Имя *</Label>
                <Input
                  id="lead-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={100}
                  required
                  autoComplete="name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-phone">Телефон *</Label>
                <Input
                  id="lead-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+375291234567"
                  maxLength={20}
                  required
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-email">Email *</Label>
                <Input
                  id="lead-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  maxLength={255}
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lead-comment">Комментарий</Label>
                <Textarea
                  id="lead-comment"
                  value={form.comment}
                  onChange={(e) =>
                    setForm({ ...form, comment: e.target.value })
                  }
                  maxLength={1000}
                  rows={3}
                  placeholder={commentPlaceholder}
                />
              </div>
              <Button
                type="submit"
                disabled={!canSubmit || submitting}
                className="w-full"
              >
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Отправить заявку
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
