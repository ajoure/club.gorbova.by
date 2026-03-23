import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Loader2, MessageSquare, Send as SendIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TicketChat } from "@/components/support/TicketChat";
import { useGetOrCreateFeedbackTicket } from "@/hooks/useTrainingFeedback";
import { useUpdateTicket } from "@/hooks/useTickets";
import { supabase } from "@/integrations/supabase/client";

interface FeedbackDrawerProps {
  lessonId: string;
  blockId?: string | null;
  studentUserId: string;
  studentName?: string;
  lessonTitle?: string;
  blockTitle?: string;
  moduleId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function FeedbackDrawer({
  lessonId,
  blockId,
  studentUserId,
  studentName,
  lessonTitle,
  blockTitle,
  moduleId,
  open,
  onOpenChange,
}: FeedbackDrawerProps) {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [telegramUserId, setTelegramUserId] = useState<number | null>(null);
  const [resolvedStudentName, setResolvedStudentName] = useState<string | null>(studentName || null);
  const [isClosed, setIsClosed] = useState(false);
  const getOrCreate = useGetOrCreateFeedbackTicket();
  const updateTicket = useUpdateTicket();

  // Reset state when drawer closes
  useEffect(() => {
    if (!open) {
      setTicketId(null);
      setError(null);
      setTelegramUserId(null);
      setIsClosed(false);
    }
  }, [open]);

  // Load student's telegram_user_id and name
  useEffect(() => {
    if (!open || !studentUserId) return;
    supabase
      .from("profiles")
      .select("telegram_user_id, full_name")
      .eq("user_id", studentUserId)
      .single()
      .then(({ data }) => {
        setTelegramUserId(data?.telegram_user_id ?? null);
        if (data?.full_name && !studentName) {
          setResolvedStudentName(data.full_name);
        }
      });
  }, [open, studentUserId, studentName]);

  // Create/find ticket when drawer opens
  useEffect(() => {
    if (!open || ticketId || getOrCreate.isPending) return;

    const subject = blockTitle
      ? `Обратная связь: ${blockTitle}`
      : lessonTitle
        ? `Обратная связь: ${lessonTitle}`
        : "Обратная связь по уроку";

    getOrCreate.mutate(
      {
        studentUserId,
        lessonId,
        blockId: blockId || null,
        moduleId: moduleId || null,
        subject,
        description: "Обратная связь преподавателя",
      },
      {
        onSuccess: (result) => {
          if (result.success && result.ticket_id) {
            setTicketId(result.ticket_id);
          } else {
            setError(result.error || "Не удалось создать тред");
          }
        },
        onError: () => {
          setError("Не удалось создать тред обратной связи");
        },
      }
    );
  }, [open, ticketId, studentUserId, lessonId, blockId]);

  const title = blockTitle
    ? blockTitle
    : lessonTitle || "Обратная связь";

  const handleCloseThread = () => {
    if (!ticketId) return;
    updateTicket.mutate(
      { ticketId, updates: { status: "closed" as const } },
      { onSuccess: () => setIsClosed(true) }
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={cn(SHEET_SHELL_CLASS, "backdrop-blur-xl bg-background/95 dark:bg-background/90 border-border/50")}>
        {/* Glassmorphism header */}
        <SheetHeader className="p-4 pb-3 border-b border-border/50 bg-gradient-to-r from-primary/5 to-primary/10">
          <div className="flex items-start gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                {getInitials(resolvedStudentName)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{title}</span>
              </SheetTitle>
              <div className="flex items-center gap-2 mt-0.5">
                {resolvedStudentName && (
                  <span className="text-xs text-muted-foreground truncate">
                    {resolvedStudentName}
                  </span>
                )}
                {telegramUserId ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 gap-1 shrink-0">
                    <SendIcon className="h-2.5 w-2.5" />
                    TG
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 text-muted-foreground shrink-0">
                    Нет TG
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 min-h-0">
          {getOrCreate.isPending && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground text-sm">Загрузка чата...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-64 text-destructive text-sm p-4 text-center">
              {error}
            </div>
          )}

          {ticketId && (
            <div className="h-full flex flex-col">
              <div className="flex-1 min-h-0 rounded-xl overflow-hidden mx-2 mt-2">
                <TicketChat
                  ticketId={ticketId}
                  isAdmin={true}
                  isClosed={isClosed}
                  telegramUserId={telegramUserId}
                  telegramBridgeEnabled={!!telegramUserId}
                  telegramMode="notify"
                  onBridgeMessage={(ticketMessageId) => {
                    supabase.functions.invoke("telegram-admin-chat", {
                      body: {
                        action: "bridge_ticket_notification",
                        ticket_id: ticketId,
                        ticket_message_id: ticketMessageId,
                      },
                    });
                  }}
                />
              </div>
              {!isClosed && (
                <div className="p-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={handleCloseThread}
                    disabled={updateTicket.isPending}
                  >
                    {updateTicket.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : null}
                    Закрыть тред
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
