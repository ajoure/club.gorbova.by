import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, UserPlus, Mail, Phone, Send, MapPin, Briefcase, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  city: "",
  country: "",
  notes: "",
};

export function CreateContactDialog({ open, onOpenChange, onCreated }: CreateContactDialogProps) {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);

  const upd = (k: keyof typeof initialForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const reset = () => setForm(initialForm);

  const submit = async () => {
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
        p_city: form.city || null,
        p_country: form.country || null,
        p_position: form.position || null,
        p_notes: form.notes || null,
      });
      if (error) {
        const msg = error.message || "";
        if (msg.startsWith("duplicate_contact:")) {
          const id = msg.split(":")[1];
          toast.error("Контакт с таким email/телефоном/telegram уже существует", {
            action: { label: "Открыть", onClick: () => onCreated?.(id) },
          });
          onOpenChange(false);
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
    } catch (e: any) {
      toast.error("Ошибка: " + (e?.message ?? "unknown"));
    } finally {
      setSaving(false);
    }
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
              <Field label="Должность" icon={<Briefcase className="h-3.5 w-3.5" />} span={2}>
                <Input value={form.position} onChange={upd("position")} placeholder="Руководитель отдела" />
              </Field>
              <Field label="Город" icon={<MapPin className="h-3.5 w-3.5" />}>
                <Input value={form.city} onChange={upd("city")} placeholder="Минск" />
              </Field>
              <Field label="Страна">
                <Input value={form.country} onChange={upd("country")} placeholder="Беларусь" />
              </Field>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs text-muted-foreground">Заметка</Label>
                <Textarea
                  value={form.notes}
                  onChange={upd("notes") as any}
                  rows={3}
                  placeholder="Контекст, откуда пришёл контакт, договорённости…"
                  className="resize-none"
                />
              </div>
            </div>

            <DialogFooter className="mt-6 gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Отмена
              </Button>
              <Button onClick={submit} disabled={saving} className="min-w-[140px]">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Создать контакт
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
