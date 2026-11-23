import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
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
  const [channel, setChannel] = useState<"telegram" | "email" | "sms">("telegram");
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [buttonText, setButtonText] = useState("Открыть платформу");
  const [buttonUrl, setButtonUrl] = useState("");
  const [includeButton, setIncludeButton] = useState(true);
  const [smsText, setSmsText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");

  useEffect(() => {
    if (template) {
      setTemplateType((template.template_type as "general" | "webinar_invite") || "general");
      setChannel(template.channel);
      setName(template.name);
      setSmsText(template.metadata?.sms_text || "");
      setMessageText(template.message_text || "");
      setButtonText(template.button_text || "Открыть платформу");
      setButtonUrl(template.button_url || "");
      setIncludeButton(!!template.button_url || template.template_type === "webinar_invite");
      setEmailSubject(template.email_subject || "");
      setEmailBodyHtml(template.email_body_html || "");
    } else {
      setTemplateType("general");
      setChannel("telegram");
      setName("");
      setSmsText("");
      setMessageText("");
      setButtonText("Открыть платформу");
      setButtonUrl("");
      setIncludeButton(true);
      setEmailSubject("");
      setEmailBodyHtml("");
    }
  }, [template, open]);

  const isWebinar = templateType === "webinar_invite";

  const handleSubmit = async () => {
    const data: Partial<BroadcastTemplate> = {
      id: template?.id,
      name,
      channel, channels: [channel], metadata: { ...template?.metadata, sms_text: channel === "sms" ? smsText.trim() : undefined },
      template_type: templateType,
      // Legacy: keep live_event_id if template already had one, otherwise null
      live_event_id: template?.live_event_id || null,
      message_text: channel === "telegram" ? messageText : null,
      button_text: channel === "telegram" && (isWebinar || includeButton) ? buttonText : null,
      // For webinar_invite: URL is computed at send time, save placeholder
      button_url: channel === "telegram" && !isWebinar && includeButton ? buttonUrl : null,
      email_subject: channel === "email" ? emailSubject : null,
      email_body_html: channel === "email" ? emailBodyHtml : null,
      status: template?.status || "draft",
    };
    await onSave(data);
  };

  // Template-level validation: only name + content required
  const isValid =
    name.trim() &&
    ((channel === "telegram" && messageText.trim()) ||
      (channel === "email" && emailSubject.trim() && emailBodyHtml.trim()) || (channel === "sms" && smsText.trim() && smsText.trim().length <= 1000));

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
                <SelectItem value="webinar_invite">Приглашение на эфир</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Info for webinar_invite */}
          {isWebinar && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Конкретный эфир выбирается при отправке рассылки, а не при создании шаблона. 
                Это позволяет переиспользовать один шаблон для разных эфиров.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label>Название шаблона</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isWebinar ? "Например: Приглашение на еженедельный эфир" : "Например: Анонс новой функции"}
            />
          </div>

          <Tabs
            value={channel}
            onValueChange={(v) => setChannel(v as "telegram" | "email" | "sms")}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="telegram" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                Telegram
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
              </TabsTrigger>
              <TabsTrigger value="sms">SMS</TabsTrigger>
            </TabsList>

            <TabsContent value="telegram" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Текст сообщения</Label>
                <TokenizedRichInput
                  value={messageText}
                  onChange={setMessageText}
                  tokenContext="messages"
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
                      <p className="text-xs text-muted-foreground">
                        URL кнопки будет сформирован автоматически из выбранного эфира при отправке рассылки
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

            <TabsContent value="sms" className="space-y-4 mt-4"><Label htmlFor="template-sms-text">Текст SMS</Label><Textarea id="template-sms-text" value={smsText} onChange={e => setSmsText(e.target.value)} maxLength={1000} rows={8}/><p className="text-xs text-muted-foreground">Обычный текст, до 1000 символов. Без изображений и интерактивных кнопок.</p></TabsContent>
            <TabsContent value="email" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Тема письма</Label>
                <TokenizedRichInput
                  value={emailSubject}
                  onChange={setEmailSubject}
                  tokenContext="messages"
                  placeholder="Тема письма..."
                  singleLine
                />
              </div>

              <div className="space-y-2">
                <Label>Текст письма</Label>
                <TokenizedRichInput
                  value={emailBodyHtml}
                  onChange={setEmailBodyHtml}
                  tokenContext="messages"
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
