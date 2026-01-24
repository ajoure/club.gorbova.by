import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cleanTelegramUsername } from "@/utils/telegramUtils";
import { parseFullName } from "@/lib/nameUtils";
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
import { Loader2, AlertTriangle, Ghost } from "lucide-react";
import { MultiContactInput, ContactItem } from "@/components/ui/MultiContactInput";
import { PhoneInput } from "@/components/ui/phone-input";
import { Badge } from "@/components/ui/badge";

interface Contact {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
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
  { value: "active", label: "Активен", requiresAuth: true },
  { value: "blocked", label: "Заблокирован", requiresAuth: false },
  { value: "deleted", label: "Удалён", requiresAuth: false },
];

export function EditContactDialog({ contact, open, onOpenChange, onSuccess }: EditContactDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
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

  // Check if this is a ghost profile (no auth user)
  const isGhost = !contact?.user_id;

  useEffect(() => {
    if (contact) {
      // For ghost profiles, set status to blocked if it was active
      const effectiveStatus = isGhost && contact.status === 'active' ? 'blocked' : (contact.status || 'active');
      
      // Parse name: prioritize first_name/last_name, fallback to parsing full_name
      let firstName = contact.first_name || "";
      let lastName = contact.last_name || "";
      
      if (!firstName && !lastName && contact.full_name) {
        const parsed = parseFullName(contact.full_name);
        firstName = parsed.firstName;
        lastName = parsed.lastName;
      }
      
      setFormData({
        first_name: firstName,
        last_name: lastName,
        email: contact.email || "",
        phone: contact.phone || "",
        telegram_username: contact.telegram_username || "",
        status: effectiveStatus,
      });
      setEmails(Array.isArray(contact.emails) ? contact.emails as ContactItem[] : []);
      setPhones(Array.isArray(contact.phones) ? contact.phones as ContactItem[] : []);
    }
  }, [contact, isGhost]);

  const saveContact = async (forceDuplicate = false) => {
    if (!contact?.id) throw new Error("No contact ID");
    
    // Sync all name fields
    const fullName = `${formData.first_name} ${formData.last_name}`.trim();
    
    // Check if email changed for non-ghost contacts
    const emailChanged = formData.email && formData.email !== contact.email;
    
    // If email changed AND user has auth account → sync auth.users
    if (emailChanged && contact.user_id) {
      const { error: authError } = await supabase.functions.invoke("users-admin-actions", {
        body: {
          action: "change_email",
          targetUserId: contact.user_id,
          newEmail: formData.email,
        }
      });
      
      if (authError) {
        throw new Error(`Ошибка смены email для входа: ${authError.message}`);
      }
    }
    
    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: formData.first_name || null,
        last_name: formData.last_name || null,
        full_name: fullName || null,
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
      const emailChanged = formData.email && formData.email !== contact?.email;
      if (emailChanged && contact?.user_id) {
        toast.success("Контакт обновлён. Email для входа также изменён.");
      } else {
        toast.success("Контакт обновлён");
      }
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
            <DialogTitle className="flex items-center gap-2">
              Редактирование контакта
              {isGhost && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Ghost className="h-3 w-3" />
                  Ghost
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Имя</Label>
                <Input
                  value={formData.first_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                  placeholder="Имя"
                />
              </div>
              <div className="space-y-2">
                <Label>Фамилия</Label>
                <Input
                  value={formData.last_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                  placeholder="Фамилия"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Основной Email</Label>
              <Input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="email@example.com"
              />
              {!isGhost && formData.email !== contact?.email && formData.email && (
                <p className="text-xs text-amber-600">
                  ⚠️ Email для входа также будет изменён
                </p>
              )}
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
                  {STATUS_OPTIONS.filter(opt => !opt.requiresAuth || !isGhost).map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isGhost && (
                <p className="text-xs text-muted-foreground">
                  Ghost-контакты не могут иметь статус "Активен" — только зарегистрированные пользователи
                </p>
              )}
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
