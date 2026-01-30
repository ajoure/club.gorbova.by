import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  Mail,
  Edit2,
  Send,
  Archive,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";

export interface BroadcastTemplate {
  id: string;
  name: string;
  channel: "telegram" | "email";
  message_text: string | null;
  button_text: string | null;
  button_url: string | null;
  email_subject: string | null;
  email_body_html: string | null;
  status: "draft" | "scheduled" | "sent" | "archived";
  scheduled_for: string | null;
  sent_count: number;
  failed_count: number;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

interface BroadcastTemplateCardProps {
  template: BroadcastTemplate;
  onEdit: (template: BroadcastTemplate) => void;
  onSend: (template: BroadcastTemplate) => void;
  onArchive: (template: BroadcastTemplate) => void;
}

export function BroadcastTemplateCard({
  template,
  onEdit,
  onSend,
  onArchive,
}: BroadcastTemplateCardProps) {
  const isTelegram = template.channel === "telegram";
  const preview = isTelegram
    ? template.message_text?.slice(0, 120) + (template.message_text && template.message_text.length > 120 ? "..." : "")
    : template.email_subject;

  const statusBadge = {
    draft: { label: "Черновик", variant: "outline" as const },
    scheduled: { label: "Запланировано", variant: "secondary" as const },
    sent: { label: "Отправлено", variant: "default" as const },
    archived: { label: "Архив", variant: "outline" as const },
  };

  const { label, variant } = statusBadge[template.status];

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                isTelegram
                  ? "bg-blue-100 text-blue-600"
                  : "bg-orange-100 text-orange-600"
              }`}
            >
              {isTelegram ? (
                <MessageCircle className="h-5 w-5" />
              ) : (
                <Mail className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{template.name}</h3>
              <p className="text-xs text-muted-foreground">
                {isTelegram ? "Telegram" : "Email"} •{" "}
                {format(new Date(template.created_at), "dd MMM yyyy", {
                  locale: ru,
                })}
              </p>
            </div>
          </div>
          <Badge variant={variant}>{label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p>

        {template.status === "scheduled" && template.scheduled_for && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            Запланировано:{" "}
            {format(new Date(template.scheduled_for), "dd MMM yyyy, HH:mm", {
              locale: ru,
            })}
          </div>
        )}

        {template.status === "sent" && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>{template.sent_count} отправлено</span>
            </div>
            {template.failed_count > 0 && (
              <div className="flex items-center gap-1">
                <XCircle className="h-4 w-4 text-red-500" />
                <span>{template.failed_count} ошибок</span>
              </div>
            )}
            {template.sent_at && (
              <span className="text-muted-foreground">
                {format(new Date(template.sent_at), "dd MMM, HH:mm", {
                  locale: ru,
                })}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2">
          {template.status !== "archived" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => onEdit(template)}
              >
                <Edit2 className="h-3 w-3" />
                Редактировать
              </Button>
              <Button
                size="sm"
                className="gap-1"
                onClick={() => onSend(template)}
              >
                <Send className="h-3 w-3" />
                Отправить
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 ml-auto text-muted-foreground"
                onClick={() => onArchive(template)}
              >
                <Archive className="h-3 w-3" />
                В архив
              </Button>
            </>
          )}
          {template.status === "archived" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => onEdit(template)}
            >
              <Edit2 className="h-3 w-3" />
              Просмотреть
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
