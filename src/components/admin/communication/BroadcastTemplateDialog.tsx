import { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { MessageCircle, Mail, Loader2, Save } from "lucide-react";
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
  const [channel, setChannel] = useState<"telegram" | "email">("telegram");
  const [name, setName] = useState("");
  const [messageText, setMessageText] = useState("");
  const [buttonText, setButtonText] = useState("Открыть платформу");
  const [buttonUrl, setButtonUrl] = useState("");
  const [includeButton, setIncludeButton] = useState(true);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyHtml, setEmailBodyHtml] = useState("");

  useEffect(() => {
    if (template) {
      setChannel(template.channel);
      setName(template.name);
      setMessageText(template.message_text || "");
      setButtonText(template.button_text || "Открыть платформу");
      setButtonUrl(template.button_url || "");
      setIncludeButton(!!template.button_url);
      setEmailSubject(template.email_subject || "");
      setEmailBodyHtml(template.email_body_html || "");
    } else {
      setChannel("telegram");
      setName("");
      setMessageText("");
      setButtonText("Открыть платформу");
      setButtonUrl("");
      setIncludeButton(true);
      setEmailSubject("");
      setEmailBodyHtml("");
    }
  }, [template, open]);

  const handleSubmit = async () => {
    const data: Partial<BroadcastTemplate> = {
      id: template?.id,
      name,
      channel,
      message_text: channel === "telegram" ? messageText : null,
      button_text: channel === "telegram" && includeButton ? buttonText : null,
      button_url: channel === "telegram" && includeButton ? buttonUrl : null,
      email_subject: channel === "email" ? emailSubject : null,
      email_body_html: channel === "email" ? emailBodyHtml : null,
      status: template?.status || "draft",
    };
    await onSave(data);
  };

  const isValid =
    name.trim() &&
    ((channel === "telegram" && messageText.trim()) ||
      (channel === "email" && emailSubject.trim() && emailBodyHtml.trim()));

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
          <div className="space-y-2">
            <Label>Название шаблона</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Анонс новой функции"
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
                <Textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Введите текст сообщения..."
                  rows={8}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Поддерживается Markdown: *жирный*, _курсив_, `код`
                </p>
              </div>

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

              {includeButton && (
                <div className="space-y-4 pl-4 border-l-2 border-muted">
                  <div className="space-y-2">
                    <Label>Текст кнопки</Label>
                    <Input
                      value={buttonText}
                      onChange={(e) => setButtonText(e.target.value)}
                      placeholder="Открыть платформу"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>URL кнопки</Label>
                    <Input
                      value={buttonUrl}
                      onChange={(e) => setButtonUrl(e.target.value)}
                      placeholder="https://club.gorbova.by/knowledge"
                    />
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="email" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Тема письма</Label>
                <Input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Тема письма..."
                />
              </div>

              <div className="space-y-2">
                <Label>Текст письма (HTML)</Label>
                <Textarea
                  value={emailBodyHtml}
                  onChange={(e) => setEmailBodyHtml(e.target.value)}
                  placeholder="<h1>Заголовок</h1><p>Текст письма...</p>"
                  rows={12}
                  className="resize-none font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Поддерживается HTML-разметка
                </p>
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
