import { useState } from "react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  User,
  Mail,
  Phone,
  Package,
  CalendarDays,
  MessageSquare,
  Send,
  Save,
  ExternalLink,
} from "lucide-react";

interface Preregistration {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  product_code: string;
  tariff_name: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  consent: boolean;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  profiles?: {
    id: string;
    full_name: string | null;
    telegram_user_id: number | null;
    telegram_username: string | null;
  } | null;
}

interface PreregistrationDetailSheetProps {
  preregistration: Preregistration | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusOptions = [
  { value: "new", label: "Новая", color: "bg-yellow-500" },
  { value: "confirmed", label: "Подтверждена", color: "bg-blue-500" },
  { value: "contacted", label: "Связались", color: "bg-purple-500" },
  { value: "converted", label: "Оплачено", color: "bg-green-500" },
  { value: "cancelled", label: "Отменена", color: "bg-destructive" },
];

const productNames: Record<string, string> = {
  CB20: "Бухгалтер частной практики 2.0",
  CLUB: "Клуб Буква Закона",
};

export function PreregistrationDetailSheet({
  preregistration,
  open,
  onOpenChange,
}: PreregistrationDetailSheetProps) {
  const queryClient = useQueryClient();
  const [newStatus, setNewStatus] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Reset form when preregistration changes
  useState(() => {
    if (preregistration) {
      setNewStatus(preregistration.status);
      setNotes(preregistration.notes || "");
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ status, notes }: { status: string; notes: string }) => {
      const { error } = await supabase
        .from("course_preregistrations")
        .update({
          status,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq("id", preregistration!.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Предзапись обновлена");
      queryClient.invalidateQueries({ queryKey: ["admin-preregistrations"] });
      queryClient.invalidateQueries({ queryKey: ["preregistration-stats"] });
    },
    onError: (error) => {
      console.error("Update error:", error);
      toast.error("Ошибка обновления");
    },
  });

  const sendNotificationMutation = useMutation({
    mutationFn: async () => {
      if (!preregistration?.profiles?.telegram_user_id) {
        throw new Error("Telegram не привязан");
      }

      const { data, error } = await supabase.functions.invoke("telegram-send-notification", {
        body: {
          telegram_user_id: preregistration.profiles.telegram_user_id,
          message: `Здравствуйте, ${preregistration.name}!\n\nНапоминаем о вашей предзаписи на курс "${productNames[preregistration.product_code] || preregistration.product_code}".\n\nЕсли у вас есть вопросы, напишите нам!`,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Уведомление отправлено");
    },
    onError: (error) => {
      console.error("Notification error:", error);
      toast.error("Ошибка отправки уведомления");
    },
  });

  if (!preregistration) return null;

  const currentStatus = statusOptions.find((s) => s.value === preregistration.status);
  const productName = productNames[preregistration.product_code] || preregistration.product_code;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Детали предзаписи</SheetTitle>
          <SheetDescription>
            Просмотр и управление предзаписью
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <Badge
              variant={preregistration.status === "converted" ? "default" : 
                       preregistration.status === "cancelled" ? "destructive" : "secondary"}
            >
              {currentStatus?.label || preregistration.status}
            </Badge>
            {preregistration.profiles?.telegram_user_id && (
              <Badge variant="outline" className="gap-1">
                <MessageSquare className="h-3 w-3" />
                Telegram
              </Badge>
            )}
          </div>

          {/* Contact Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Контактные данные</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span>{preregistration.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <a href={`mailto:${preregistration.email}`} className="text-primary hover:underline">
                  {preregistration.email}
                </a>
              </div>
              {preregistration.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <a href={`tel:${preregistration.phone}`} className="text-primary hover:underline">
                    {preregistration.phone}
                  </a>
                </div>
              )}
              {preregistration.profiles?.telegram_username && (
                <div className="flex items-center gap-2 text-sm">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <a
                    href={`https://t.me/${preregistration.profiles.telegram_username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline flex items-center gap-1"
                  >
                    @{preregistration.profiles.telegram_username}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Product Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Продукт</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span>{productName}</span>
              </div>
              {preregistration.tariff_name && (
                <p className="text-sm text-muted-foreground pl-6">
                  Тариф: {preregistration.tariff_name}
                </p>
              )}
              <div className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span>
                  {format(new Date(preregistration.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
                </span>
              </div>
              {preregistration.source && (
                <p className="text-sm text-muted-foreground pl-6">
                  Источник: {preregistration.source}
                </p>
              )}
            </div>
          </div>

          <Separator />

          {/* Status Change */}
          <div className="space-y-3">
            <Label>Изменить статус</Label>
            <Select
              value={newStatus || preregistration.status}
              onValueChange={setNewStatus}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-3">
            <Label>Заметки</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Добавить заметку..."
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => updateMutation.mutate({
                status: newStatus || preregistration.status,
                notes,
              })}
              disabled={updateMutation.isPending}
            >
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? "Сохранение..." : "Сохранить изменения"}
            </Button>

            {preregistration.profiles?.telegram_user_id && (
              <Button
                variant="outline"
                onClick={() => sendNotificationMutation.mutate()}
                disabled={sendNotificationMutation.isPending}
              >
                <Send className="h-4 w-4 mr-2" />
                {sendNotificationMutation.isPending ? "Отправка..." : "Отправить напоминание в Telegram"}
              </Button>
            )}

            {preregistration.user_id && (
              <Button
                variant="ghost"
                asChild
              >
                <a href={`/admin/contacts?search=${preregistration.email}`}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Открыть профиль клиента
                </a>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
