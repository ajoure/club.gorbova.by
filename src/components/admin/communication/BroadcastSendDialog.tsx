import { useState, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  MessageCircle,
  Mail,
  Loader2,
  Send,
  Users,
  AlertTriangle,
  Info,
  Shield,
  X,
  Video,
  Radio,
  AlertCircle,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BroadcastTemplate } from "./BroadcastTemplateCard";

interface LiveEventForBroadcast {
  id: string;
  slug: string;
  title: string;
  is_published: boolean;
  status: string;
  event_type: string;
  platform_status: string;
  scheduled_at: string | null;
  kinescope_video_id: string | null;
  kinescope_live_event_id: string | null;
  metadata: Record<string, any> | null;
}

function getEventReadiness(event: LiveEventForBroadcast): { ready: boolean; reasons: string[]; label: string } {
  const reasons: string[] = [];
  
  if (!event.is_published) {
    reasons.push("Не опубликован");
  }

  if (event.event_type === "live_stream") {
    if (!event.kinescope_live_event_id) {
      reasons.push("Не создан источник трансляции");
    } else {
      const meta = event.metadata as any;
      const providerStatus = meta?.provider_source_status;
      
      if (providerStatus === "missing") {
        reasons.push("Источник трансляции удалён в Kinescope");
      } else if (providerStatus === "broken") {
        reasons.push("Источник трансляции повреждён");
      } else if (!providerStatus || providerStatus === "ok") {
        const providerCurrent = meta?.provider?.current || meta?.provider || {};
        const hasStream = !!providerCurrent.stream_id || !!providerCurrent.stream_status;
        const hasPlayLink = !!providerCurrent.play_link;
        if (!hasStream && !hasPlayLink) {
          reasons.push("Источник трансляции повреждён");
        }
      }
    }
    if (!event.scheduled_at) {
      reasons.push("Не задана дата и время");
    }
  } else {
    if (!event.kinescope_video_id) {
      reasons.push("Не привязано видео");
    }
  }

  if (reasons.length === 0) {
    return { ready: true, reasons: [], label: "Готов" };
  }
  return { ready: false, reasons, label: reasons[0] };
}

interface BroadcastFilters {
  hasActiveSubscription: boolean;
  hasTelegram: boolean;
  hasEmail: boolean;
  productIds: string[];
  tariffIds: string[];
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
    productIds: [],
    tariffIds: [],
    clubId: "",
  });

  // Event picker state for webinar_invite templates
  const [selectedEventId, setSelectedEventId] = useState("");
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [eventSearch, setEventSearch] = useState("");

  const isTelegram = template?.channel === "telegram";
  const isWebinar = template?.template_type === "webinar_invite";

  // For webinar_invite: use legacy live_event_id from template OR selected event
  const effectiveEventId = isWebinar ? (selectedEventId || template?.live_event_id || "") : "";

  // Fetch live events for webinar picker
  const { data: liveEvents } = useQuery({
    queryKey: ["broadcast-send-live-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("live_events")
        .select("id, slug, title, is_published, status, event_type, platform_status, scheduled_at, kinescope_video_id, kinescope_live_event_id, metadata")
        .order("created_at", { ascending: false });
      return (data || []) as unknown as LiveEventForBroadcast[];
    },
    enabled: open && isWebinar,
  });

  const filteredEvents = useMemo(() => {
    if (!liveEvents) return [];
    if (!eventSearch.trim()) return liveEvents;
    const q = eventSearch.toLowerCase();
    return liveEvents.filter((e) => e.title?.toLowerCase().includes(q));
  }, [liveEvents, eventSearch]);

  const selectedEvent = liveEvents?.find((e) => e.id === effectiveEventId);
  const selectedReadiness = selectedEvent ? getEventReadiness(selectedEvent) : null;
  const computedButtonUrl = selectedEvent ? `/live/${selectedEvent.slug}` : "";

  // Initialize selectedEventId from legacy template.live_event_id
  // Reset when dialog opens/template changes
  // Using a ref-like pattern to avoid extra effect
  const templateId = template?.id;
  const legacyEventId = template?.live_event_id;
  const [lastTemplateId, setLastTemplateId] = useState("");
  if (templateId && templateId !== lastTemplateId) {
    setLastTemplateId(templateId);
    setSelectedEventId(legacyEventId || "");
    setEventSearch("");
  }

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

  // Fetch tariffs for selected products
  const { data: tariffs } = useQuery({
    queryKey: ["broadcast-tariffs", filters.productIds],
    queryFn: async () => {
      if (filters.productIds.length === 0) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, product_id")
        .in("product_id", filters.productIds)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: filters.productIds.length > 0,
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

  // Fetch live event access rule for the selected event
  const { data: liveEventAccess } = useQuery({
    queryKey: ["broadcast-live-event", effectiveEventId],
    queryFn: async () => {
      if (!effectiveEventId) return null;
      const { data } = await supabase
        .from("live_events")
        .select("id, title, access_rule, slug")
        .eq("id", effectiveEventId)
        .maybeSingle();
      return data as { id: string; title: string; access_rule: { mode: string; product_id: string | null; tariff_id: string | null }; slug: string } | null;
    },
    enabled: !!effectiveEventId,
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

      if (filters.productIds.length > 0) {
        let subQuery = supabase
          .from("subscriptions_v2")
          .select("user_id")
          .in("product_id", filters.productIds)
          .eq("status", "active");

        if (filters.tariffIds.length > 0) {
          subQuery = subQuery.in("tariff_id", filters.tariffIds);
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
    
    // For webinar_invite, override button_url with computed URL
    const sendTemplate = isWebinar && computedButtonUrl
      ? { ...template, button_url: computedButtonUrl, live_event_id: effectiveEventId }
      : template;
    
    await onSend(sendTemplate, filters);
  };

  if (!template) return null;

  const preview = isTelegram
    ? template.message_text?.slice(0, 200) +
      (template.message_text && template.message_text.length > 200 ? "..." : "")
    : template.email_subject;

  const accessRulePreview = liveEventAccess?.access_rule
    ? liveEventAccess.access_rule.mode === "all"
      ? "Ссылка откроется всем авторизованным пользователям"
      : liveEventAccess.access_rule.mode === "tariff"
        ? "Только пользователи с определённым тарифом смогут войти"
        : "Только пользователи с доступом к продукту смогут войти"
    : null;

  const canSend = isWebinar
    ? !!effectiveEventId && selectedReadiness?.ready && (audience?.count || 0) > 0
    : (audience?.count || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Отправить рассылку
          </DialogTitle>
          <DialogDescription>
            {isWebinar ? "Выберите эфир, аудиторию и подтвердите отправку" : "Выберите аудиторию и подтвердите отправку"}
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
                <Badge variant="outline" className="text-xs">Приглашение на эфир</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{preview}</p>
            {isTelegram && template.button_text && (
              <div className="mt-2 text-xs text-muted-foreground">
                Кнопка: {template.button_text} {computedButtonUrl ? `→ ${computedButtonUrl}` : "(URL будет из эфира)"}
              </div>
            )}
          </div>

          {/* Event picker for webinar_invite */}
          {isWebinar && (
            <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-primary" />
                <Label className="font-medium">Выберите эфир для рассылки</Label>
              </div>

              <Popover open={eventPickerOpen} onOpenChange={setEventPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={eventPickerOpen}
                    className={cn(
                      "w-full justify-between font-normal h-9 text-sm",
                      !effectiveEventId && "text-muted-foreground"
                    )}
                  >
                    {selectedEvent?.title || "Выберите эфир"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[460px] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Поиск по названию..."
                      value={eventSearch}
                      onValueChange={setEventSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Эфир не найден</CommandEmpty>
                      <CommandGroup>
                        {filteredEvents.map((e) => {
                          const readiness = getEventReadiness(e);
                          return (
                            <CommandItem
                              key={e.id}
                              value={e.id}
                              onSelect={() => {
                                if (!readiness.ready) return;
                                setSelectedEventId(e.id);
                                setEventPickerOpen(false);
                                setEventSearch("");
                              }}
                              className={cn(
                                !readiness.ready && "opacity-60 cursor-not-allowed"
                              )}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4 shrink-0",
                                  effectiveEventId === e.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="truncate flex-1 mr-2">{e.title}</span>
                              <Badge
                                variant={e.event_type === "live_stream" ? "default" : "secondary"}
                                className="text-[9px] shrink-0 ml-1"
                              >
                                {e.event_type === "live_stream" ? (
                                  <><Radio className="h-2.5 w-2.5 mr-0.5" />Живой</>
                                ) : (
                                  <><Video className="h-2.5 w-2.5 mr-0.5" />Видео</>
                                )}
                              </Badge>
                              {readiness.ready ? (
                                <Badge variant="outline" className="text-[9px] text-primary border-primary/30 shrink-0">
                                  ✓ Готов
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground shrink-0">
                                  <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                                  {readiness.label}
                                </Badge>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {selectedEvent && (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Ссылка кнопки: <code className="bg-muted px-1 rounded">{computedButtonUrl}</code>
                  </div>
                  {!selectedReadiness?.ready && selectedReadiness?.reasons && selectedReadiness.reasons.length > 0 && (
                    <div className="flex items-start gap-1.5 text-destructive bg-destructive/5 rounded p-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        {selectedReadiness.reasons.map((r, i) => (
                          <p key={i} className="text-xs">• {r}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

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
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start font-normal">
                    {filters.productIds.length === 0
                      ? "Все продукты"
                      : `Выбрано: ${filters.productIds.length}`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3" align="start">
                  <div className="space-y-2">
                    {products?.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={filters.productIds.includes(p.id)}
                          onCheckedChange={(checked) => {
                            setFilters((f) => {
                              const next = checked
                                ? [...f.productIds, p.id]
                                : f.productIds.filter((id) => id !== p.id);
                              const validTariffIds = f.tariffIds.filter((tid) =>
                                tariffs?.some((t) => t.id === tid && next.includes(t.product_id))
                              );
                              return { ...f, productIds: next, tariffIds: validTariffIds };
                            });
                          }}
                        />
                        <span className="text-sm">{p.name}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {filters.productIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {filters.productIds.map((pid) => {
                    const name = products?.find((p) => p.id === pid)?.name;
                    return (
                      <Badge key={pid} variant="secondary" className="text-xs gap-1">
                        {name}
                        <button
                          onClick={() =>
                            setFilters((f) => ({
                              ...f,
                              productIds: f.productIds.filter((id) => id !== pid),
                              tariffIds: f.tariffIds.filter((tid) =>
                                tariffs?.some((t) => t.id === tid && t.product_id !== pid)
                              ),
                            }))
                          }
                          className="ml-0.5 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>

            {filters.productIds.length > 0 && tariffs && tariffs.length > 0 && (
              <div className="space-y-2">
                <Label>Тариф</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start font-normal">
                      {filters.tariffIds.length === 0
                        ? "Все тарифы"
                        : `Выбрано: ${filters.tariffIds.length}`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="start">
                    <ScrollArea className="max-h-60">
                      <div className="space-y-3">
                        {filters.productIds.map((pid) => {
                          const productName = products?.find((p) => p.id === pid)?.name;
                          const productTariffs = tariffs?.filter((t) => t.product_id === pid) || [];
                          if (productTariffs.length === 0) return null;
                          return (
                            <div key={pid}>
                              {filters.productIds.length > 1 && (
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  {productName}
                                </p>
                              )}
                              <div className="space-y-2">
                                {productTariffs.map((t) => (
                                  <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                                    <Checkbox
                                      checked={filters.tariffIds.includes(t.id)}
                                      onCheckedChange={(checked) => {
                                        setFilters((f) => ({
                                          ...f,
                                          tariffIds: checked
                                            ? [...f.tariffIds, t.id]
                                            : f.tariffIds.filter((id) => id !== t.id),
                                        }));
                                      }}
                                    />
                                    <span className="text-sm">{t.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
                {filters.tariffIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {filters.tariffIds.map((tid) => {
                      const name = tariffs?.find((t) => t.id === tid)?.name;
                      return (
                        <Badge key={tid} variant="outline" className="text-xs gap-1">
                          {name}
                          <button
                            onClick={() =>
                              setFilters((f) => ({
                                ...f,
                                tariffIds: f.tariffIds.filter((id) => id !== tid),
                              }))
                            }
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                )}
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
