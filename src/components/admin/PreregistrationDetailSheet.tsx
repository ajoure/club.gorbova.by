import { useState, useEffect } from "react";
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
  Globe,
  CreditCard,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { getProductName } from "@/lib/product-names";

interface PreregistrationBilling {
  billing_status?: 'pending' | 'paid' | 'no_card' | 'failed' | 'overdue';
  attempts_count?: number;
  last_attempt_at?: string;
  last_attempt_status?: 'success' | 'failed' | 'skipped';
  last_attempt_error?: string;
  has_active_card?: boolean;
  notified?: {
    tomorrow_charge_at?: string;
    no_card_at?: string;
    failed_at?: string;
  };
}

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
  meta?: {
    billing?: PreregistrationBilling;
  } | null;
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
  { value: "new", label: "Новая", variant: "secondary" as const },
  { value: "confirmed", label: "Подтверждена", variant: "default" as const },
  { value: "contacted", label: "Связались", variant: "outline" as const },
  { value: "converted", label: "Оплачено", variant: "default" as const },
  { value: "paid", label: "Оплачено", variant: "default" as const },
  { value: "cancelled", label: "Отменена", variant: "destructive" as const },
];

const billingStatusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Ожидает", variant: "secondary" },
  paid: { label: "Оплачено", variant: "default" },
  no_card: { label: "Нет карты", variant: "destructive" },
  failed: { label: "Ошибка", variant: "destructive" },
  overdue: { label: "Просрочено", variant: "destructive" },
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
  useEffect(() => {
    if (preregistration) {
      setNewStatus(preregistration.status);
      setNotes(preregistration.notes || "");
    }
  }, [preregistration]);

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
      if (!preregistration?.user_id || !preregistration?.profiles?.telegram_user_id) {
        throw new Error("Telegram не привязан");
      }

      const productName = getProductName(preregistration.product_code);

      const { data, error } = await supabase.functions.invoke("telegram-send-notification", {
        body: {
          user_id: preregistration.user_id,
          message_type: "custom",
          custom_message: `Здравствуйте, ${preregistration.name}!\n\nНапоминаем о вашей предзаписи на курс "${productName}".\n\nЕсли у вас есть вопросы, напишите нам!`,
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
  const productName = getProductName(preregistration.product_code);
  const hasTelegram = !!preregistration.profiles?.telegram_user_id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-xl">{preregistration.name}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          {/* Status Badges */}
          <div className="flex flex-wrap gap-2">
            <Badge variant={currentStatus?.variant || "secondary"}>
              {currentStatus?.label || preregistration.status}
            </Badge>
            {hasTelegram && (
              <Badge variant="outline" className="gap-1.5 bg-[#0088cc]/10 text-[#0088cc] border-[#0088cc]/30">
                <MessageSquare className="h-3 w-3" />
                Telegram
              </Badge>
            )}
          </div>

          {/* Contact Info Card */}
          <div className="bg-muted/30 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
              <User className="h-4 w-4" />
              Контактные данные
            </h3>
            <div className="space-y-2.5 pl-1">
              <div className="flex items-center gap-3 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <a href={`mailto:${preregistration.email}`} className="text-primary hover:underline truncate">
                  {preregistration.email}
                </a>
              </div>
              {preregistration.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                  <a href={`tel:${preregistration.phone}`} className="text-primary hover:underline">
                    {preregistration.phone}
                  </a>
                </div>
              )}
              {preregistration.profiles?.telegram_username && (
                <div className="flex items-center gap-3 text-sm">
                  <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
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

          {/* Product Info Card */}
          <div className="bg-muted/30 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
              <Package className="h-4 w-4" />
              Продукт
            </h3>
            <div className="space-y-2.5 pl-1">
              <div className="text-sm font-medium">{productName}</div>
              {preregistration.tariff_name && (
                <div className="text-sm text-muted-foreground">
                  Тариф: {preregistration.tariff_name}
                </div>
              )}
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4 shrink-0" />
                <span>
                  {format(new Date(preregistration.created_at), "d MMMM yyyy, HH:mm", { locale: ru })}
                </span>
              </div>
              {preregistration.source && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Globe className="h-4 w-4 shrink-0" />
                  <span>Источник: {preregistration.source}</span>
                </div>
              )}
            </div>
          </div>

          {/* Billing Info Card */}
          {preregistration.meta?.billing && (
            <div className="bg-muted/30 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                Биллинг
              </h3>
              <div className="space-y-2.5 pl-1">
                {/* Billing Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Статус:</span>
                  <Badge 
                    variant={billingStatusLabels[preregistration.meta.billing.billing_status || 'pending']?.variant || 'secondary'}
                  >
                    {billingStatusLabels[preregistration.meta.billing.billing_status || 'pending']?.label || 'Ожидает'}
                  </Badge>
                </div>
                
                {/* Card Status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Карта:</span>
                  {preregistration.meta.billing.has_active_card ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/30">
                      <CheckCircle className="h-3 w-3 mr-1" /> Привязана
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/30">
                      <XCircle className="h-3 w-3 mr-1" /> Нет карты
                    </Badge>
                  )}
                </div>
                
                {/* Attempts */}
                {(preregistration.meta.billing.attempts_count || 0) > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Попытки:</span>
                    <span className="text-sm font-medium">{preregistration.meta.billing.attempts_count}</span>
                  </div>
                )}
                
                {/* Last Attempt */}
                {preregistration.meta.billing.last_attempt_at && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Посл. попытка:</span>
                    <span className="text-sm flex items-center gap-1">
                      {format(new Date(preregistration.meta.billing.last_attempt_at), "dd.MM HH:mm", { locale: ru })}
                      {preregistration.meta.billing.last_attempt_status === 'failed' && (
                        <XCircle className="h-3 w-3 text-red-500" />
                      )}
                      {preregistration.meta.billing.last_attempt_status === 'success' && (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      )}
                    </span>
                  </div>
                )}
                
                {/* Error */}
                {preregistration.meta.billing.last_attempt_error && (
                  <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded">
                    {preregistration.meta.billing.last_attempt_error}
                  </div>
                )}
                
                {/* Notifications */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                  <span className="text-xs text-muted-foreground">Уведомления:</span>
                  {preregistration.meta.billing.notified?.tomorrow_charge_at && (
                    <Badge variant="outline" className="text-xs">
                      TG: списание ✓
                    </Badge>
                  )}
                  {preregistration.meta.billing.notified?.no_card_at && (
                    <Badge variant="outline" className="text-xs">
                      TG: нет карты ✓
                    </Badge>
                  )}
                  {preregistration.meta.billing.notified?.failed_at && (
                    <Badge variant="outline" className="text-xs">
                      TG: ошибка ✓
                    </Badge>
                  )}
                  {!preregistration.meta.billing.notified?.tomorrow_charge_at && 
                   !preregistration.meta.billing.notified?.no_card_at &&
                   !preregistration.meta.billing.notified?.failed_at && (
                    <span className="text-xs text-muted-foreground">нет</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Status Change */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Изменить статус</Label>
            <Select
              value={newStatus || preregistration.status}
              onValueChange={setNewStatus}
            >
              <SelectTrigger className="bg-background">
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
          <div className="space-y-2">
            <Label className="text-sm font-medium">Заметки</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Добавить заметку..."
              rows={3}
              className="bg-background resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={() => updateMutation.mutate({
                status: newStatus || preregistration.status,
                notes,
              })}
              disabled={updateMutation.isPending}
              className="w-full"
            >
              <Save className="h-4 w-4 mr-2" />
              {updateMutation.isPending ? "Сохранение..." : "Сохранить изменения"}
            </Button>

            {hasTelegram && (
              <Button
                variant="outline"
                onClick={() => sendNotificationMutation.mutate()}
                disabled={sendNotificationMutation.isPending}
                className="w-full"
              >
                <Send className="h-4 w-4 mr-2" />
                {sendNotificationMutation.isPending ? "Отправка..." : "Отправить напоминание в Telegram"}
              </Button>
            )}

            {preregistration.user_id && (
              <Button
                variant="ghost"
                asChild
                className="w-full"
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
