import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Mail,
  MessageCircle,
  Send,
  Inbox,
  ChevronDown,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Reply,
} from "lucide-react";
import { EmailReplyDialog } from "./EmailReplyDialog";
import { ComposeEmailDialog } from "../ComposeEmailDialog";

interface CommunicationItem {
  id: string;
  type: "email_in" | "email_out" | "telegram_in" | "telegram_out";
  timestamp: string;
  from?: string;
  to?: string;
  subject?: string;
  body: string;
  status?: string;
  meta?: Record<string, any>;
  originalData?: any;
}

interface UnifiedCommunicationHistoryProps {
  userId?: string;
  email?: string;
  className?: string;
  showHeader?: boolean;
  onReply?: (item: CommunicationItem) => void;
}

export function UnifiedCommunicationHistory({
  userId,
  email,
  className,
  showHeader = true,
  onReply,
}: UnifiedCommunicationHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "email" | "telegram">("all");
  const [replyEmailOpen, setReplyEmailOpen] = useState(false);
  const [replyEmail, setReplyEmail] = useState<any>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  // Fetch email logs (outgoing)
  const { data: emailLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["contact-email-logs", userId, email],
    queryFn: async () => {
      let query = supabase
        .from("email_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (userId) {
        query = query.or(`user_id.eq.${userId},profile_id.eq.${userId}`);
      } else if (email) {
        query = query.eq("to_email", email);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!(userId || email),
  });

  // Fetch incoming emails
  const { data: incomingEmails = [], isLoading: inboxLoading } = useQuery({
    queryKey: ["contact-incoming-emails", userId, email],
    queryFn: async () => {
      let query = supabase
        .from("email_inbox")
        .select("*")
        .order("received_at", { ascending: false });

      if (userId) {
        query = query.eq("linked_profile_id", userId);
      } else if (email) {
        query = query.eq("from_email", email);
      }

      const { data, error } = await query.limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!(userId || email),
  });

  // Fetch Telegram messages
  const { data: telegramMessages = [], isLoading: telegramLoading } = useQuery({
    queryKey: ["contact-telegram-messages", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("telegram_messages")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  // Combine all communications
  const allCommunications = useMemo(() => {
    const items: CommunicationItem[] = [];

    // Add outgoing emails
    emailLogs.forEach(log => {
      items.push({
        id: `email_out_${log.id}`,
        type: "email_out",
        timestamp: log.created_at,
        from: log.from_email,
        to: log.to_email,
        subject: log.subject || undefined,
        body: log.body_text || log.body_html || "",
        status: log.status,
        meta: log.meta as Record<string, any> || undefined,
        originalData: log,
      });
    });

    // Add incoming emails
    incomingEmails.forEach(email => {
      items.push({
        id: `email_in_${email.id}`,
        type: "email_in",
        timestamp: email.received_at || email.created_at,
        from: email.from_email,
        to: email.to_email,
        subject: email.subject || undefined,
        body: email.body_text || email.body_html || "",
        status: email.is_read ? "read" : "unread",
        originalData: email,
      });
    });

    // Add Telegram messages
    telegramMessages.forEach(msg => {
      items.push({
        id: `telegram_${msg.id}`,
        type: msg.direction === "incoming" ? "telegram_in" : "telegram_out",
        timestamp: msg.created_at,
        body: msg.message_text || "",
        status: msg.is_read ? "read" : "unread",
        originalData: msg,
      });
    });

    // Sort by timestamp
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply filter
    if (filter === "email") {
      return items.filter(i => i.type.startsWith("email"));
    } else if (filter === "telegram") {
      return items.filter(i => i.type.startsWith("telegram"));
    }

    return items;
  }, [emailLogs, incomingEmails, telegramMessages, filter]);

  const isLoading = logsLoading || inboxLoading || telegramLoading;

  const getStatusBadge = (item: CommunicationItem) => {
    if (item.type === "email_out") {
      const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
        sent: { label: "Отправлено", color: "bg-blue-500/20 text-blue-600", icon: CheckCircle },
        delivered: { label: "Доставлено", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
        opened: { label: "Прочитано", color: "bg-emerald-500/20 text-emerald-600", icon: Eye },
        failed: { label: "Ошибка", color: "bg-red-500/20 text-red-600", icon: XCircle },
        pending: { label: "Отправляется", color: "bg-amber-500/20 text-amber-600", icon: Clock },
      };
      const config = statusConfig[item.status || "pending"] || statusConfig.pending;
      const Icon = config.icon;
      return (
        <Badge variant="secondary" className={config.color}>
          <Icon className="h-3 w-3 mr-1" />
          {config.label}
        </Badge>
      );
    }
    return null;
  };

  const getIcon = (type: CommunicationItem["type"]) => {
    switch (type) {
      case "email_in": return <Inbox className="h-4 w-4 text-blue-500" />;
      case "email_out": return <Send className="h-4 w-4 text-green-500" />;
      case "telegram_in": return <MessageCircle className="h-4 w-4 text-sky-500" />;
      case "telegram_out": return <Send className="h-4 w-4 text-emerald-500" />;
    }
  };

  const getLabel = (type: CommunicationItem["type"]) => {
    switch (type) {
      case "email_in": return "Входящее письмо";
      case "email_out": return "Исходящее письмо";
      case "telegram_in": return "Сообщение от клиента";
      case "telegram_out": return "Сообщение клиенту";
    }
  };

  const handleReplyEmail = (item: CommunicationItem) => {
    if (item.type === "email_in" && item.originalData) {
      setReplyEmail(item.originalData);
      setReplyEmailOpen(true);
    }
  };

  if (!userId && !email) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">Укажите пользователя или email</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {showHeader && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">История общения</h3>
            <Badge variant="secondary">{allCommunications.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs h-7 px-2">Все</TabsTrigger>
                <TabsTrigger value="email" className="text-xs h-7 px-2 gap-1">
                  <Mail className="h-3 w-3" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="telegram" className="text-xs h-7 px-2 gap-1">
                  <MessageCircle className="h-3 w-3" />
                  Telegram
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {email && (
              <Button variant="outline" size="sm" onClick={() => setComposeOpen(true)}>
                <Mail className="h-3 w-3 mr-1" />
                Написать
              </Button>
            )}
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : allCommunications.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Нет сообщений</p>
          </div>
        ) : (
          <div className="space-y-2">
            {allCommunications.map((item) => (
              <Collapsible
                key={item.id}
                open={expandedId === item.id}
                onOpenChange={() => setExpandedId(expandedId === item.id ? null : item.id)}
              >
                <CollapsibleTrigger asChild>
                  <div className={cn(
                    "p-3 rounded-lg border cursor-pointer transition-colors hover:bg-accent/50",
                    item.type.includes("_in") && "border-l-2 border-l-blue-500"
                  )}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="mt-0.5">{getIcon(item.type)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {getLabel(item.type)}
                            </span>
                            {getStatusBadge(item)}
                          </div>
                          {item.subject && (
                            <p className="text-sm font-medium truncate mt-0.5">
                              {item.subject}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground truncate">
                            {item.body.slice(0, 100)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true, locale: ru })}
                        </span>
                        <ChevronDown className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform",
                          expandedId === item.id && "rotate-180"
                        )} />
                      </div>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-1 p-4 rounded-lg bg-muted/50 border space-y-3">
                    {item.from && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">От: </span>
                        <span>{item.from}</span>
                      </div>
                    )}
                    {item.to && (
                      <div className="text-xs">
                        <span className="text-muted-foreground">Кому: </span>
                        <span>{item.to}</span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(item.timestamp), "dd MMMM yyyy, HH:mm", { locale: ru })}
                    </div>
                    <div className="pt-2 border-t">
                      <p className="text-sm whitespace-pre-wrap">{item.body}</p>
                    </div>
                    {item.type === "email_in" && (
                      <div className="pt-2 border-t">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleReplyEmail(item)}
                        >
                          <Reply className="h-3 w-3 mr-1" />
                          Ответить
                        </Button>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Reply dialog */}
      <EmailReplyDialog
        email={replyEmail}
        open={replyEmailOpen}
        onOpenChange={setReplyEmailOpen}
      />

      {/* Compose dialog */}
      <ComposeEmailDialog
        recipientEmail={email || null}
        open={composeOpen}
        onOpenChange={setComposeOpen}
      />
    </div>
  );
}
