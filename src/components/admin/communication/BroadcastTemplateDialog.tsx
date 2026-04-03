import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageCircle, Mail, Loader2, Save, Video, Info } from "lucide-react";
import type { BroadcastTemplate } from "./BroadcastTemplateCard";

interface BroadcastTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: BroadcastTemplate | null;
  onSave: (data: Partial<BroadcastTemplate>) => Promise<void>;
  isSaving?: boolean;
}

export function BroadcastTemplateDialog({
  open,
  onOpenChange,
  template,
  onSave,
  isSaving,
}: BroadcastTemplateDialogProps) {
  const [templateType, setTemplateType] = useState<"general" | "webinar_invite">("general");
  const [channel, setChannel] = useState<"telegram" | "email">("telegram");
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [buttonText, setButtonText] = useState("Открыть платформу");
  const [buttonUrl, setButtonUrl] = useState("");
  const [includeButton, setIncludeButton] = useState(true);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");
  const [liveEventId, setLiveEventId] = useState("");

  // Fetch live events for webinar type
  const { data: liveEvents } = useQuery({
    queryKey: ["broadcast-live-events"],
    queryFn: async () => {
      const { data } = await supabase
        .from("live_events")
        .select("id, slug, title, is_published, access_rule, status")
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      return (data || []) as Array<{
        id: string;
        slug: string;
        title: string;
        is_published: boolean;
        access_rule: { mode: string; product_id: string | null; tariff_id: string | null };
        status: string;
      }>;
    },
    enabled: open,
  });

  const selectedEvent = liveEvents?.find((e) => e.id === liveEventId);

  // Auto-compute button URL for webinar
  const computedButtonUrl = selectedEvent ? `/live/${selectedEvent.slug}` : "";

  useEffect(() => {
    if (template) {
      setTemplateType((template.template_type as "general" | "webinar_invite") || "general");
      setChannel(template.channel);
      setName(template.name);
      setMessageText(template.message_text || "");
      setButtonText(template.button_text || "Открыть платформу");
      setButtonUrl(template.button_url || "");
      setIncludeButton(!!template.button_url);
      setEmailSubject(template.email_subject || "");
      setEmailBodyHtml(template.email_body_html || "");
      setLiveEventId(template.live_event_id || "");
    } else {
      setTemplateType("general");
      setChannel("telegram");
      setName("");
      setMessageText("");
      setButtonText("Открыть платформу");
      setButtonUrl("");
      setIncludeButton(true);
      setEmailSubject("");
      setEmailBodyHtml("");
      setLiveEventId("");
    }
  }, [template, open]);

  const isWebinar = templateType === "webinar_invite";

  const handleSubmit = async () => {
    const effectiveButtonUrl = isWebinar ? computedButtonUrl : buttonUrl;
    const effectiveIncludeButton = isWebinar ? true : includeButton;

    const data: Partial<BroadcastTemplate> = {
      id: template?.id,
      name,
      channel,
      template_type: templateType,
      live_event_id: isWebinar ? liveEventId || null : null,
      message_text: channel === "telegram" ? messageText : null,
      button_text: channel === "telegram" && effectiveIncludeButton ? buttonText : null,
      button_url: channel === "telegram" && effectiveIncludeButton ? effectiveButtonUrl : null,
      email_subject: channel === "email" ? emailSubject : null,
      email_body_html: channel === "email" ? emailBodyHtml : null,
      status: template?.status || "draft",
    };
    await onSave(data);
  };

  const isValid =
    name.trim() &&
    ((channel === "telegram" && messageText.trim()) ||
      (channel === "email" && emailSubject.trim() && emailBodyHtml.trim())) &&
    (!isWebinar || liveEventId);

  const accessPreview = selectedEvent
    ? selectedEvent.access_rule?.mode === "all"
      ? "Ссылка откроется всем авторизованным пользователям"
      : selectedEvent.access_rule?.mode === "tariff"
        ? "Ссылка откроется только пользователям с определённым тарифом"
        : "Ссылка откроется только пользователям с доступом к продукту"
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Редактировать шаблон" : "Создать шаблон"}
          </DialogTitle>
          <DialogDescription>
            {template
              ? "Измените параметры шаблона рассылки"
              : "Создайте новый шаблон для рассылки"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Template type selector */}
          <div className="space-y-2">
            <Label>Тип шаблона</Label>
            <Select
              value={templateType}
              onValueChange={(v) => setTemplateType(v as "general" | "webinar_invite")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">Обычная рассылка</SelectItem>
                <SelectItem value="webinar_invite">Приглашение на вебинар</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Webinar event selector */}
          {isWebinar && (
            <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-primary" />
                <Label className="font-medium">Эфир</Label>
              </div>
              {liveEvents && liveEvents.length === 0 ? (
                <div className="text-center py-4 space-y-2">
                  <p className="text-sm text-muted-foreground">Нет созданных эфиров</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open("/admin/live-events", "_blank")}
                  >
                    Создать эфир
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    После создания обновите эту страницу, чтобы выбрать эфир
                  </p>
                </div>
              ) : (
                <Select value={liveEventId} onValueChange={setLiveEventId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите эфир" />
                  </SelectTrigger>
                  <SelectContent>
                    {liveEvents?.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedEvent && (
                <>
                  <div className="text-sm text-muted-foreground">
                    Ссылка кнопки: <code className="bg-muted px-1 rounded">{computedButtonUrl}</code>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground bg-background rounded p-2">
                    <p>Статус: <Badge variant="outline" className="text-[10px]">{selectedEvent.status === 'draft' ? 'Черновик' : selectedEvent.is_published ? 'Опубликован' : 'Не опубликован'}</Badge></p>
                    <p>Приглашения: {selectedEvent.access_rule?.mode === 'all' ? 'Все авторизованные' : 'По правилам доступа'}</p>
                  </div>
                  {accessPreview && (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground bg-background rounded p-2">
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                      <span>{accessPreview}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Название шаблона</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isWebinar ? "Например: Приглашение на эфир 15 апреля" : "Например: Анонс новой функции"}
            />
          </div>

          <Tabs
            value={channel}
            onValueChange={(v) => setChannel(v as "telegram" | "email")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="telegram" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                Telegram
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
              </TabsTrigger>
            </TabsList>

            <TabsContent value="telegram" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Текст сообщения</Label>
                <TokenizedRichInput
                  value={messageText}
                  onChange={setMessageText}
                  placeholder="Введите текст сообщения..."
                  rows={8}
                />
              </div>

              {!isWebinar && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="includeButton"
                    checked={includeButton}
                    onCheckedChange={setIncludeButton}
                  />
                  <Label htmlFor="includeButton" className="cursor-pointer">
                    Добавить кнопку-ссылку
                  </Label>
                </div>
              )}

              {(isWebinar || includeButton) && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label>Текст кнопки</Label>
                    <Input
                      value={buttonText}
                      onChange={(e) => setButtonText(e.target.value)}
                      placeholder={isWebinar ? "Смотреть эфир" : "Открыть платформу"}
                    />
                  </div>
                  {isWebinar ? (
                    <div className="space-y-2">
                      <Label>URL кнопки</Label>
                      <Input
                        value={computedButtonUrl}
                        disabled
                        className="bg-muted"
                      />
                      <p className="text-xs text-muted-foreground">
                        URL формируется автоматически из выбранного эфира
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>URL кнопки</Label>
                      <Input
                        value={buttonUrl}
                        onChange={(e) => setButtonUrl(e.target.value)}
                        placeholder="https://club.gorbova.by/knowledge"
                      />
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="email" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Тема письма</Label>
                <TokenizedRichInput
                  value={emailSubject}
                  onChange={setEmailSubject}
                  placeholder="Тема письма..."
                  singleLine
                />
              </div>

              <div className="space-y-2">
                <Label>Текст письма</Label>
                <TokenizedRichInput
                  value={emailBodyHtml}
                  onChange={setEmailBodyHtml}
                  placeholder="Содержимое письма..."
                  rows={12}
                  allowAlign
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isSaving}
            className="gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Сохранение...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Сохранить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
