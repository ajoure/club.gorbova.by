import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cleanTelegramUsername } from "@/utils/telegramUtils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Loader2, AlertTriangle } from "lucide-react";
import { MultiContactInput, ContactItem } from "@/components/ui/MultiContactInput";
import { PhoneInput } from "@/components/ui/phone-input";

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

interface DuplicateProfile {
  id: string;
  full_name: string | null;
  email: string | null;
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
  const [duplicateWarning, setDuplicateWarning] = useState<{
    show: boolean;
    existingProfiles: DuplicateProfile[];
  } | null>(null);
  const [isChecking, setIsChecking] = useState(false);

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

  const saveContact = async (forceDuplicate = false) => {
    if (!contact?.id) throw new Error("No contact ID");
    
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: formData.full_name || null,
        email: formData.email || null,
        phone: formData.phone || null,
        telegram_username: cleanTelegramUsername(formData.telegram_username),
        status: formData.status,
        emails: emails as unknown as null,
        phones: phones as unknown as null,
      })
      .eq("id", contact.id);
    
    if (error) throw error;

    // If we forced a duplicate save, create a duplicate case for later merging
    if (forceDuplicate && duplicateWarning?.existingProfiles.length) {
      try {
        await supabase.functions.invoke("detect-duplicates", {
          body: {
            email: formData.email,
            profileId: contact.id,
          }
        });
      } catch (e) {
        console.error("Failed to create duplicate case:", e);
      }
    }
  };

  const updateMutation = useMutation({
    mutationFn: () => saveContact(false),
    onSuccess: () => {
      toast.success("Контакт обновлён");
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-counts"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const forceUpdateMutation = useMutation({
    mutationFn: () => saveContact(true),
    onSuccess: () => {
      toast.success("Контакт сохранён. Создан кейс для объединения дублей.");
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-counts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-cases"] });
      setDuplicateWarning(null);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleSave = async () => {
    if (!contact) return;

    // Check if email changed to an existing one
    const emailChanged = formData.email && formData.email !== contact.email;
    
    if (emailChanged) {
      setIsChecking(true);
      try {
        const { data: existing } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .eq("email", formData.email)
          .neq("id", contact.id)
          .eq("is_archived", false);

        if (existing && existing.length > 0) {
          setDuplicateWarning({ show: true, existingProfiles: existing });
          setIsChecking(false);
          return;
        }
      } catch (e) {
        console.error("Error checking duplicates:", e);
      }
      setIsChecking(false);
    }

    updateMutation.mutate();
  };

  if (!contact) return null;

  return (
    <>
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
              <PhoneInput
                value={formData.phone}
                onChange={(value) => setFormData(prev => ({ ...prev, phone: value }))}
                placeholder="Номер телефона"
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
            <Button 
              onClick={handleSave} 
              disabled={updateMutation.isPending || isChecking}
            >
              {(updateMutation.isPending || isChecking) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Warning Dialog */}
      <AlertDialog 
        open={duplicateWarning?.show || false} 
        onOpenChange={(open) => !open && setDuplicateWarning(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Обнаружен дубль email
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Email <strong>{formData.email}</strong> уже используется у других контактов:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  {duplicateWarning?.existingProfiles.map(p => (
                    <li key={p.id}>
                      <strong>{p.full_name || "Без имени"}</strong>
                      {p.email && <span className="text-muted-foreground"> ({p.email})</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground">
                  После сохранения будет создан кейс для объединения дублей в разделе "Дубли".
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => forceUpdateMutation.mutate()}
              disabled={forceUpdateMutation.isPending}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {forceUpdateMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Сохранить с дублем
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
