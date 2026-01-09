import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { MultiContactInput, ContactItem } from "@/components/ui/MultiContactInput";

interface Contact {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  status: string;
  emails?: unknown;
  phones?: unknown;
}

interface EditContactDialogProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const STATUS_OPTIONS = [
  { value: "active", label: "Активен" },
  { value: "blocked", label: "Заблокирован" },
  { value: "deleted", label: "Удалён" },
];

export function EditContactDialog({ contact, open, onOpenChange, onSuccess }: EditContactDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    full_name: "",
    email: "",
    phone: "",
    telegram_username: "",
    status: "",
  });
  const [emails, setEmails] = useState<ContactItem[]>([]);
  const [phones, setPhones] = useState<ContactItem[]>([]);

  useEffect(() => {
    if (contact) {
      setFormData({
        full_name: contact.full_name || "",
        email: contact.email || "",
        phone: contact.phone || "",
        telegram_username: contact.telegram_username || "",
        status: contact.status || "active",
      });
      setEmails(Array.isArray(contact.emails) ? contact.emails as ContactItem[] : []);
      setPhones(Array.isArray(contact.phones) ? contact.phones as ContactItem[] : []);
    }
  }, [contact]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!contact?.id) throw new Error("No contact ID");
      
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: formData.full_name || null,
          email: formData.email || null,
          phone: formData.phone || null,
          telegram_username: formData.telegram_username || null,
          status: formData.status,
          emails: emails as unknown as null,
          phones: phones as unknown as null,
        })
        .eq("id", contact.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Контакт обновлён");
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  if (!contact) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактирование контакта</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Полное имя</Label>
            <Input
              value={formData.full_name}
              onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
              placeholder="Имя Фамилия"
            />
          </div>

          <div className="space-y-2">
            <Label>Основной Email</Label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder="email@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label>Основной телефон</Label>
            <Input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="+375..."
            />
          </div>

          <div className="space-y-2">
            <Label>Telegram username</Label>
            <Input
              value={formData.telegram_username}
              onChange={(e) => setFormData(prev => ({ ...prev, telegram_username: e.target.value }))}
              placeholder="@username"
            />
          </div>

          <div className="space-y-2">
            <Label>Статус</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData(prev => ({ ...prev, status: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите статус" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Multiple phones */}
          <MultiContactInput
            type="phone"
            value={phones}
            onChange={setPhones}
          />

          {/* Multiple emails */}
          <MultiContactInput
            type="email"
            value={emails}
            onChange={setEmails}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
