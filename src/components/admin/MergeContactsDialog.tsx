import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Combine, AlertTriangle } from "lucide-react";

interface Contact {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  avatar_url: string | null;
  status: string;
  deals_count: number;
}

interface MergeContactsDialogProps {
  contacts: Contact[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function MergeContactsDialog({
  contacts,
  open,
  onOpenChange,
  onSuccess,
}: MergeContactsDialogProps) {
  const queryClient = useQueryClient();
  const [masterId, setMasterId] = useState<string>(contacts[0]?.id || "");

  // Reset master when dialog opens / selection changes
  useEffect(() => {
    if (!open) return;
    if (contacts.length === 0) return;

    if (!contacts.some((c) => c.id === masterId)) {
      setMasterId(contacts[0].id);
    }
  }, [open, contacts, masterId]);

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const mergedIds = contacts.filter(c => c.id !== masterId).map(c => c.id);
      
      // First, create a duplicate case for this merge
      const { data: caseData, error: caseError } = await supabase
        .from("duplicate_cases")
        .insert({
          phone: contacts[0]?.phone || contacts[0]?.email || "manual-merge",
          duplicate_type: "manual",
          status: "new",
          profile_count: contacts.length,
        })
        .select()
        .single();

      if (caseError) throw caseError;

      // Link all profiles to the case
      for (const contact of contacts) {
        await supabase
          .from("client_duplicates")
          .insert({
            case_id: caseData.id,
            profile_id: contact.id,
            is_master: contact.id === masterId,
          });
      }

      // Call merge function
      const { data, error } = await supabase.functions.invoke("merge-clients", {
        body: {
          caseId: caseData.id,
          masterId,
          mergedIds,
        },
      });

      if (error) throw error;
      
      // Handle Telegram conflict (409)
      if (data?.error === "Telegram conflict") {
        const conflictInfo = data.conflictingProfiles?.map((p: any) => 
          `${p.telegram_username || p.telegram_user_id}`
        ).join(", ");
        throw new Error(`Telegram конфликт: ${conflictInfo}. Решите вручную.`);
      }
      
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: () => {
      toast.success(`Объединено ${contacts.length} контактов`);
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["duplicate-cases"] });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      const msg = (error as Error).message;
      if (msg.includes("Telegram конфликт")) {
        toast.error("Невозможно объединить: разные Telegram аккаунты", {
          description: msg,
          duration: 10000,
        });
      } else {
        toast.error("Ошибка объединения: " + msg);
      }
    },
  });

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  if (contacts.length < 2) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Combine className="h-5 w-5" />
            Объединить контакты
          </DialogTitle>
          <DialogDescription>
            Выберите главный контакт, в который будут объединены остальные. 
            Все заказы, подписки и данные будут перенесены в главный контакт.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <AlertTriangle className="h-4 w-4 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-700 dark:text-blue-400">
              Все данные будут перенесены в главный контакт. В истории событий появится запись о слиянии с возможностью разъединения.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Выберите главный контакт</Label>
            <RadioGroup value={masterId} onValueChange={setMasterId}>
              <div className="space-y-2">
                {contacts.map((contact) => (
                  <label
                    key={contact.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      masterId === contact.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <RadioGroupItem value={contact.id} />
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={contact.avatar_url || undefined} />
                      <AvatarFallback>{getInitials(contact.full_name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {contact.full_name || "Без имени"}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {contact.email || contact.phone || "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {contact.deals_count > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {contact.deals_count} сделок
                        </Badge>
                      )}
                      {contact.status === "active" && (
                        <Badge variant="default" className="text-xs bg-green-500/20 text-green-600 border-green-500/30">
                          Активен
                        </Badge>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </RadioGroup>
          </div>

          <div className="text-sm text-muted-foreground">
            <p><strong>Что будет перенесено в главный контакт:</strong></p>
            <ul className="list-disc pl-5 mt-1 space-y-1">
              <li>Все заказы и платежи</li>
              <li>Подписки и рассрочки</li>
              <li>Права доступа (entitlements)</li>
              <li>Дополнительные email и телефоны</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => mergeMutation.mutate()}
            disabled={mergeMutation.isPending || !masterId}
          >
            {mergeMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            )}
            Объединить {contacts.length} контактов
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
