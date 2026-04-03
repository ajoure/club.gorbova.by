import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageCircle,
  Mail,
  Loader2,
  Send,
  Users,
  AlertTriangle,
  Info,
  Shield,
} from "lucide-react";
import type { BroadcastTemplate } from "./BroadcastTemplateCard";

interface BroadcastFilters {
  hasActiveSubscription: boolean;
  hasTelegram: boolean;
  hasEmail: boolean;
  productId: string;
  tariffId: string;
  clubId: string;
}

interface BroadcastSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: BroadcastTemplate | null;
  onSend: (template: BroadcastTemplate, filters: BroadcastFilters) => Promise<void>;
  isSending?: boolean;
}

export function BroadcastSendDialog({
  open,
  onOpenChange,
  template,
  onSend,
  isSending,
}: BroadcastSendDialogProps) {
  const [filters, setFilters] = useState<BroadcastFilters>({
    hasActiveSubscription: false,
    hasTelegram: true,
    hasEmail: false,
    productId: "",
    tariffId: "",
    clubId: "",
  });

  const isTelegram = template?.channel === "telegram";
  const isWebinar = template?.template_type === "webinar_invite";

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ["broadcast-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["broadcast-tariffs", filters.productId],
    queryFn: async () => {
      if (!filters.productId) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name")
        .eq("product_id", filters.productId)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: !!filters.productId,
  });

  // Fetch telegram clubs
  const { data: clubs } = useQuery({
    queryKey: ["broadcast-clubs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_clubs")
        .select("id, club_name")
        .eq("is_active", true)
        .order("club_name");
      return data || [];
    },
  });

  // Fetch live event access rule for webinar templates
  const { data: liveEvent } = useQuery({
    queryKey: ["broadcast-live-event", template?.live_event_id],
    queryFn: async () => {
      if (!template?.live_event_id) return null;
      const { data } = await supabase
        .from("live_events")
        .select("id, title, access_rule, slug")
        .eq("id", template.live_event_id)
        .maybeSingle();
      return data as { id: string; title: string; access_rule: { mode: string; product_id: string | null; tariff_id: string | null }; slug: string } | null;
    },
    enabled: !!template?.live_event_id,
  });

  // Fetch audience count
  const { data: audience, isLoading: audienceLoading } = useQuery({
    queryKey: ["broadcast-send-audience", filters, template?.channel],
    queryFn: async () => {
      let query = supabase
        .from("profiles")
        .select("id, user_id, telegram_user_id, email");

      if (isTelegram) {
        query = query.not("telegram_user_id", "is", null);
      } else {
        query = query.not("email", "is", null);
      }

      const { data: profiles } = await query.limit(10000);

      if (!profiles) return { count: 0 };

      let filteredProfiles = profiles;

      if (filters.hasActiveSubscription) {
        const { data: activeSubs } = await supabase
          .from("subscriptions_v2")
          .select("user_id")
          .eq("status", "active");

        const activeUserIds = new Set(activeSubs?.map((a) => a.user_id) || []);
        filteredProfiles = filteredProfiles.filter((p) =>
          activeUserIds.has(p.user_id)
        );
      }

      if (filters.productId) {
        const subQuery = supabase
          .from("subscriptions_v2")
          .select("user_id")
          .eq("product_id", filters.productId)
          .eq("status", "active");

        if (filters.tariffId) {
          subQuery.eq("tariff_id", filters.tariffId);
        }

        const { data: productSubs } = await subQuery;

        const productUserIds = new Set(productSubs?.map((s) => s.user_id) || []);
        filteredProfiles = filteredProfiles.filter((p) =>
          productUserIds.has(p.user_id)
        );
      }

      if (filters.clubId) {
        const { data: clubAccess } = await supabase
          .from("telegram_access")
          .select("user_id")
          .eq("club_id", filters.clubId)
          .or("active_until.is.null,active_until.gt.now()");

        const clubUserIds = new Set(clubAccess?.map((a) => a.user_id) || []);
        filteredProfiles = filteredProfiles.filter((p) =>
          clubUserIds.has(p.user_id)
        );
      }

      return {
        count: filteredProfiles.length,
      };
    },
    enabled: open && !!template,
  });

  const handleSend = async () => {
    if (!template) return;
    await onSend(template, filters);
  };

  if (!template) return null;

  const preview = isTelegram
    ? template.message_text?.slice(0, 200) +
      (template.message_text && template.message_text.length > 200 ? "..." : "")
    : template.email_subject;

  const accessRulePreview = liveEvent?.access_rule
    ? liveEvent.access_rule.mode === "all"
      ? "Ссылка откроется всем авторизованным пользователям"
      : liveEvent.access_rule.mode === "tariff"
        ? "Только пользователи с определённым тарифом смогут войти"
        : "Только пользователи с доступом к продукту смогут войти"
    : null;

  const canSend = isWebinar ? !!template.live_event_id && (audience?.count || 0) > 0 : (audience?.count || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Отправить рассылку
          </DialogTitle>
          <DialogDescription>
            Выберите аудиторию и подтвердите отправку
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Template Preview */}
          <div className="rounded-lg border p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-2">
              {isTelegram ? (
                <MessageCircle className="h-4 w-4 text-blue-500" />
              ) : (
                <Mail className="h-4 w-4 text-orange-500" />
              )}
              <span className="font-medium">{template.name}</span>
              {isWebinar && (
                <Badge variant="outline" className="text-xs">Вебинар</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{preview}</p>
            {isTelegram && template.button_url && (
              <div className="mt-2 text-xs text-muted-foreground">
                Кнопка: {template.button_text} → {template.button_url}
              </div>
            )}
          </div>

          {/* Access rule preview for webinar */}
          {isWebinar && accessRulePreview && (
            <div className="rounded-lg border p-4 bg-primary/5">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Кому разрешён вход</span>
              </div>
              <p className="text-sm text-muted-foreground">{accessRulePreview}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Эта настройка берётся из эфира и не может быть изменена здесь
              </p>
            </div>
          )}

          <Separator />

          {/* Targeting Filters */}
          <div className="space-y-4">
            <h4 className="font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Кому отправляем (targeting)
            </h4>

            <div className="flex items-center justify-between">
              <Label htmlFor="activeSubscription" className="cursor-pointer">
                Только с активной подпиской
              </Label>
              <Switch
                id="activeSubscription"
                checked={filters.hasActiveSubscription}
                onCheckedChange={(v) =>
                  setFilters((f) => ({ ...f, hasActiveSubscription: v }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Продукт</Label>
              <Select
                value={filters.productId || "all"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, productId: v === "all" ? "" : v, tariffId: "" }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Все продукты" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все продукты</SelectItem>
                  {products?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {filters.productId && (
              <div className="space-y-2">
                <Label>Тариф</Label>
                <Select
                  value={filters.tariffId || "all"}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, tariffId: v === "all" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все тарифы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все тарифы</SelectItem>
                    {tariffs?.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {isTelegram && (
              <div className="space-y-2">
                <Label>Telegram-клуб</Label>
                <Select
                  value={filters.clubId || "all"}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, clubId: v === "all" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все клубы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клубы</SelectItem>
                    {clubs?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.club_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Audience Count */}
          <div className="rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Получатели</span>
              {audienceLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Badge variant="secondary" className="text-base px-3 py-1">
                  {audience?.count || 0}
                </Badge>
              )}
            </div>
          </div>

          {isWebinar && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Фильтры выше определяют, кому будет отправлено сообщение. 
                Доступ к эфиру по ссылке определяется правилом доступа из эфира — это разные настройки.
              </span>
            </div>
          )}

          {(audience?.count || 0) > 500 && (
            <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Большая аудитория. Отправка может занять несколько минут.
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleSend}
            disabled={!canSend || isSending}
            className="gap-2"
          >
            {isSending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Отправить {audience?.count || 0} получателям
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
