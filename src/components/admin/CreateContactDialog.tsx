import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, UserPlus, Mail, Phone, Send, Briefcase, User, AlertCircle, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface CreateContactDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (profileId: string) => void;
}

const initialForm = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  telegram_username: "",
  position: "",
};

interface DuplicateInfo {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  telegram_username: string | null;
  matched_field: "email" | "phone" | "telegram";
}

const FIELD_LABEL: Record<DuplicateInfo["matched_field"], string> = {
  email: "email",
  phone: "телефоном",
  telegram: "Telegram",
};

export function CreateContactDialog({ open, onOpenChange, onCreated }: CreateContactDialogProps) {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const debouncedEmail = useDebouncedValue(form.email, 500);
  const debouncedPhone = useDebouncedValue(form.phone, 500);
  const debouncedTg = useDebouncedValue(form.telegram_username, 500);
  const lookupSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const email = debouncedEmail.trim();
    const phone = debouncedPhone.trim();
    const tg = debouncedTg.trim();
    if (!email && !phone && !tg) {
      setDuplicate(null);
      setChecking(false);
      return;
    }
    const seq = ++lookupSeq.current;
    setChecking(true);
    (async () => {
      const { data, error } = await supabase.rpc("admin_lookup_contact_duplicate", {
        p_email: email || null,
        p_phone: phone || null,
        p_telegram_username: tg || null,
      });
      if (seq !== lookupSeq.current) return; // stale
      setChecking(false);
      if (error) {
        setDuplicate(null);
        return;
      }
      setDuplicate((data as unknown as DuplicateInfo | null) ?? null);
    })();
  }, [open, debouncedEmail, debouncedPhone, debouncedTg]);

  const upd = (k: keyof typeof initialForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const reset = () => {
    setForm(initialForm);
    setDuplicate(null);
    setChecking(false);
    lookupSeq.current++;
  };

  const submit = async () => {
    if (duplicate) {
      toast.error("Сначала откройте существующий контакт или измените данные");
      return;
    }
    const hasAny = form.first_name || form.last_name || form.email || form.phone || form.telegram_username;
    if (!hasAny) {
      toast.error("Заполните хотя бы имя, email, телефон или Telegram");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("admin_create_contact", {
        p_first_name: form.first_name || null,
        p_last_name: form.last_name || null,
        p_full_name: null,
        p_email: form.email || null,
        p_phone: form.phone || null,
        p_telegram_username: form.telegram_username || null,
        p_position: form.position || null,
      });
      if (error) {
        const msg = error.message || "";
        if (msg.startsWith("duplicate_contact:")) {
          const id = msg.split(":")[1];
          setDuplicate({
            id,
            full_name: null,
            email: form.email || null,
            phone: form.phone || null,
            telegram_username: form.telegram_username || null,
            matched_field: form.email ? "email" : form.phone ? "phone" : "telegram",
          });
          return;
        }
        if (msg === "forbidden") toast.error("Нет прав на создание контактов");
        else if (msg === "empty_contact") toast.error("Заполните хотя бы одно поле контакта");
        else toast.error("Ошибка: " + msg);
        return;
      }
      toast.success("Контакт создан");
      reset();
      onOpenChange(false);
      if (data) onCreated?.(data as string);
    } catch (error: unknown) {
      toast.error("Ошибка: " + (error instanceof Error ? error.message : "unknown"));
    } finally {
      setSaving(false);
    }
  };

  const openDuplicate = () => {
    if (!duplicate) return;
    reset();
    onOpenChange(false);
    onCreated?.(duplicate.id);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="sm:max-w-[560px] p-0 overflow-hidden border-white/20 bg-background/80 backdrop-blur-2xl shadow-2xl">
        <div className="relative">
          {/* decorative gradient */}
          <div className="absolute inset-x-0 -top-16 h-40 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent blur-2xl pointer-events-none" />
          <div className="relative p-6">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                  <UserPlus className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <DialogTitle className="text-lg">Новый контакт</DialogTitle>
                  <DialogDescription className="text-xs">
                    Добавьте контакт вручную. Достаточно любого одного канала связи.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Field label="Имя" icon={<User className="h-3.5 w-3.5" />}>
                <Input value={form.first_name} onChange={upd("first_name")} placeholder="Иван" autoFocus />
              </Field>
              <Field label="Фамилия">
                <Input value={form.last_name} onChange={upd("last_name")} placeholder="Иванов" />
              </Field>
              <Field label="Email" icon={<Mail className="h-3.5 w-3.5" />} span={2}>
                <Input type="email" value={form.email} onChange={upd("email")} placeholder="ivan@example.com" />
              </Field>
              <Field label="Телефон" icon={<Phone className="h-3.5 w-3.5" />}>
                <Input value={form.phone} onChange={upd("phone")} placeholder="+375 29 …" />
              </Field>
              <Field label="Telegram" icon={<Send className="h-3.5 w-3.5" />}>
                <Input value={form.telegram_username} onChange={upd("telegram_username")} placeholder="@username" />
              </Field>

              {duplicate && (
                <div className="col-span-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      Контакт с таким {FIELD_LABEL[duplicate.matched_field]} уже существует
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {duplicate.full_name || "Без имени"}
                      {duplicate.email ? ` · ${duplicate.email}` : ""}
                      {duplicate.phone ? ` · ${duplicate.phone}` : ""}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-xs"
                      onClick={openDuplicate}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Открыть контакт
                    </Button>
                  </div>
                </div>
              )}

              <Field label="Должность" icon={<Briefcase className="h-3.5 w-3.5" />} span={2}>
                <Input value={form.position} onChange={upd("position")} placeholder="Руководитель отдела" />
              </Field>
            </div>

            <DialogFooter className="mt-6 gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Отмена
              </Button>
              <Button
                onClick={submit}
                disabled={saving || !!duplicate || checking}
                className="min-w-[140px]"
                title={duplicate ? "Уже есть контакт с такими данными" : undefined}
              >
                {saving || checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                {checking ? "Проверка…" : "Создать контакт"}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  icon,
  span = 1,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  span?: 1 | 2;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${span === 2 ? "col-span-2" : ""}`}>
      <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </Label>
      {children}
    </div>
  );
}
