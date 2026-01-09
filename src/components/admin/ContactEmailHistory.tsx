import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Mail,
  Send,
  Inbox,
  ChevronDown,
  CheckCircle,
  AlertCircle,
  Clock,
  Eye,
  MousePointer,
} from "lucide-react";
import { useState } from "react";

interface ContactEmailHistoryProps {
  userId: string | null;
  email: string | null;
  clientName?: string | null;
}

interface EmailLog {
  id: string;
  direction: "outgoing" | "incoming";
  from_email: string;
  to_email: string;
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  template_code: string | null;
  provider: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  opened_at: string | null;
  clicked_at: string | null;
}

export function ContactEmailHistory({ userId, email, clientName }: ContactEmailHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch email logs
  const { data: emails, isLoading } = useQuery({
    queryKey: ["email-logs", userId, email],
    queryFn: async () => {
      // Query by user_id or email
      let query = supabase
        .from("email_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (userId) {
        query = query.eq("user_id", userId);
      } else if (email) {
        query = query.or(`to_email.eq.${email},from_email.eq.${email}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as EmailLog[];
    },
    enabled: !!(userId || email),
  });

  // Also fetch contact_requests as "incoming" emails
  const { data: contactRequests } = useQuery({
    queryKey: ["contact-requests-email", email],
    queryFn: async () => {
      if (!email) return [];
      const { data, error } = await supabase
        .from("contact_requests")
        .select("*")
        .eq("email", email)
        .order("created_at", { ascending: false });
      if (error) return [];
      return data;
    },
    enabled: !!email,
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <Badge variant="secondary"><CheckCircle className="w-3 h-3 mr-1" />Отправлено</Badge>;
      case "delivered":
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Доставлено</Badge>;
      case "opened":
        return <Badge className="bg-blue-100 text-blue-800"><Eye className="w-3 h-3 mr-1" />Открыто</Badge>;
      case "clicked":
        return <Badge className="bg-purple-100 text-purple-800"><MousePointer className="w-3 h-3 mr-1" />Переход</Badge>;
      case "failed":
      case "bounced":
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Ошибка</Badge>;
      case "pending":
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Ожидает</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Combine email logs and contact requests
  const allEmails = [
    ...(emails || []),
    ...(contactRequests || []).map((cr) => ({
      id: cr.id,
      direction: "incoming" as const,
      from_email: cr.email,
      to_email: "support@ajoure.by",
      subject: cr.subject || "Обращение с сайта",
      body_html: null,
      body_text: cr.message,
      template_code: null,
      provider: null,
      status: "received",
      error_message: null,
      created_at: cr.created_at,
      opened_at: null,
      clicked_at: null,
      _isContactRequest: true,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (!email && !userId) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-8 text-center text-muted-foreground">
          <Mail className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Email не указан</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 pb-2 border-b">
        <Mail className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium">История переписки</span>
        {allEmails.length > 0 && (
          <Badge variant="secondary" className="ml-auto">
            {allEmails.length}
          </Badge>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : !allEmails.length ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Mail className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Нет писем</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 pr-4">
            {allEmails.map((emailItem) => (
              <Collapsible
                key={emailItem.id}
                open={expandedId === emailItem.id}
                onOpenChange={(open) => setExpandedId(open ? emailItem.id : null)}
              >
                <Card className={`transition-all ${expandedId === emailItem.id ? "ring-1 ring-primary" : ""}`}>
                  <CollapsibleTrigger className="w-full text-left">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {emailItem.direction === "outgoing" ? (
                            <Send className="w-4 h-4 text-blue-500 flex-shrink-0" />
                          ) : (
                            <Inbox className="w-4 h-4 text-green-500 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {emailItem.subject || "(Без темы)"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {emailItem.direction === "outgoing" ? "→ " : "← "}
                              {emailItem.direction === "outgoing" 
                                ? emailItem.to_email 
                                : (clientName || emailItem.from_email)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {getStatusBadge(emailItem.status)}
                          <ChevronDown className={`w-4 h-4 transition-transform ${expandedId === emailItem.id ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(emailItem.created_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                      </p>
                    </CardContent>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0 pb-3 px-3">
                      <div className="border-t pt-3">
                        {emailItem.body_text && (
                          <div className="text-sm whitespace-pre-wrap bg-muted/50 p-3 rounded max-h-[200px] overflow-y-auto">
                            {emailItem.body_text}
                          </div>
                        )}
                        {emailItem.body_html && !emailItem.body_text && (
                          <div 
                            className="text-sm bg-muted/50 p-3 rounded max-h-[200px] overflow-y-auto"
                            dangerouslySetInnerHTML={{ 
                              __html: emailItem.body_html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') 
                            }}
                          />
                        )}
                        {emailItem.error_message && (
                          <div className="mt-2 text-sm text-destructive bg-destructive/10 p-2 rounded">
                            Ошибка: {emailItem.error_message}
                          </div>
                        )}
                        {emailItem.opened_at && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Открыто: {format(new Date(emailItem.opened_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                          </p>
                        )}
                        {emailItem.template_code && (
                          <Badge variant="outline" className="mt-2 text-xs">
                            Шаблон: {emailItem.template_code}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
