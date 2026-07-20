import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DOMPurify from "dompurify";
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
  profileId?: string | null;
  companyId?: string | null;
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
  meta?: Record<string, any> | null;
}

function compactEmailPreview(item: Pick<EmailLog, "body_text" | "body_html" | "meta">): string | null {
  const raw = item.body_text || item.meta?.preview_text || item.body_html || "";
  const text = String(raw)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  return text || null;
}

export function ContactEmailHistory({ userId, profileId, companyId, email, clientName }: ContactEmailHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch outgoing email logs - prioritize search by email (most reliable)
  const { data: emails, isLoading: isLoadingLogs } = useQuery({
    queryKey: ["email-logs", userId, profileId, companyId, email],
    queryFn: async () => {
      // Company mail must be scoped by company_id. Never fall back to a plain
      // email match here, otherwise a shared mailbox could leak another
      // entity's correspondence into the company card.
      if (companyId) {
        const { data, error } = await (supabase as any)
          .from("email_logs")
          .select("*")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return (data ?? []) as EmailLog[];
      }

      // PRIMARY: Search by email (most reliable - works even if user_id/profile_id is NULL)
      if (email) {
        const { data: byEmail, error } = await supabase
          .from("email_logs")
          .select("*")
          .or(`to_email.eq.${email},from_email.eq.${email}`)
          .order("created_at", { ascending: false })
          .limit(50);
        
        if (!error && byEmail && byEmail.length > 0) {
          return byEmail as EmailLog[];
        }
      }
      
      // FALLBACK: Search by user_id/profile_id
      const conditions: string[] = [];
      if (userId) conditions.push(`user_id.eq.${userId}`);
      if (profileId) conditions.push(`profile_id.eq.${profileId}`);
      
      if (conditions.length === 0) {
        return [] as EmailLog[];
      }

      const { data, error } = await supabase
        .from("email_logs")
        .select("*")
        .or(conditions.join(','))
        .order("created_at", { ascending: false })
        .limit(50);
        
      if (error) throw error;
      return data as EmailLog[];
    },
    enabled: !!(companyId || userId || profileId || email),
  });

  // Fetch incoming emails from email_inbox
  const { data: inboxEmails, isLoading: isLoadingInbox } = useQuery({
    queryKey: ["email-inbox-contact", profileId, companyId, email],
    queryFn: async () => {
      if (companyId) return [];
      let query = supabase
        .from("email_inbox")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(50);

      if (profileId) {
        query = query.eq("linked_profile_id", profileId);
      } else if (email) {
        query = query.eq("from_email", email);
      }

      const { data, error } = await query;
      if (error) return [];
      return data || [];
    },
    enabled: !!(!companyId && (profileId || email)),
  });

  // Canonical post-payment email audit: product purchase emails are stored here,
  // not in legacy email_logs, so the contact card must read this Source of Truth too.
  const { data: purchaseEmails, isLoading: isLoadingPurchaseEmails } = useQuery({
    queryKey: ["purchase-email-deliveries", userId, profileId, companyId, email],
    queryFn: async () => {
      if (companyId) return [] as EmailLog[];
      const orderFilters: string[] = [];
      if (profileId) orderFilters.push(`profile_id.eq.${profileId}`);
      if (userId) orderFilters.push(`user_id.eq.${userId}`);
      if (email) orderFilters.push(`customer_email.ilike.${email}`);
      if (orderFilters.length === 0) return [] as EmailLog[];

      const { data: orders, error: ordersError } = await supabase
        .from("orders_v2")
        .select("id")
        .or(orderFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(100);
      if (ordersError) return [] as EmailLog[];
      const orderIds = (orders || []).map((o) => o.id).filter(Boolean);
      if (orderIds.length === 0) return [] as EmailLog[];

      const { data, error } = await supabase
        .from("order_notification_deliveries")
        .select("id, order_id, channel, notification_type, status, recipient, provider_message_id, sent_at, created_at, error, metadata")
        .eq("channel", "email")
        .in("order_id", orderIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return [] as EmailLog[];

      return (data || []).map((row: any) => {
        const md = (row.metadata || {}) as Record<string, any>;
        const subject = md.subject || (md.product_name ? `Оплата получена: ${md.product_name}` : "Письмо по покупке");
        return {
          id: `purchase-email-${row.id}`,
          direction: "outgoing" as const,
          from_email: "system",
          to_email: row.recipient || email || "—",
          subject,
          body_html: md.rendered_html || null,
          body_text: md.message_text || md.preview_text || null,
          template_code: md.template_code || row.notification_type || null,
          provider: "order_notification_deliveries",
          status: row.status,
          error_message: row.error || null,
          created_at: row.sent_at || row.created_at,
          opened_at: null,
          clicked_at: null,
          meta: {
            ...md,
            order_id: row.order_id,
            provider_message_id: row.provider_message_id,
            source: "order_notification_deliveries",
          },
        } satisfies EmailLog;
      });
    },
    enabled: !!(!companyId && (userId || profileId || email)),
  });

  const isLoading = isLoadingLogs || isLoadingInbox || isLoadingPurchaseEmails;

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
    enabled: !!(!companyId && email),
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

  // Filter out technical outcome markers from email_logs:
  // 1) Rows explicitly hidden via meta.ui_hidden = true
  // 2) Legacy rows with no subject AND no body AND from_email='system' (no provider) —
  //    these are internal telemetry from subscription-renewal-reminders, not real letters.
  const isPhantomLog = (e: any) => {
    const meta = (e?.meta ?? {}) as Record<string, any>;
    if (meta.ui_hidden === true) return true;
    const noSubject = !e?.subject;
    const noBody = !e?.body_html && !e?.body_text;
    const isSystemSender = e?.from_email === 'system' && !e?.provider;
    return noSubject && noBody && isSystemSender;
  };

  // Combine email logs, inbox emails and contact requests
  const allEmails = [
    ...(purchaseEmails || []).map(e => ({ ...e, _source: 'purchase_delivery' as const })),
    ...((emails || []).filter(e => !isPhantomLog(e))).map(e => ({ ...e, _source: 'log' as const })),
    ...(inboxEmails || []).map((e) => ({
      id: e.id,
      direction: "incoming" as const,
      from_email: e.from_email,
      to_email: e.to_email,
      subject: e.subject,
      body_html: e.body_html,
      body_text: e.body_text,
      template_code: null,
      provider: null,
      status: e.is_read ? "read" : "unread",
      error_message: null,
      created_at: e.received_at || e.created_at,
      opened_at: null,
      clicked_at: null,
      _source: 'inbox' as const,
    })),
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
      _source: 'contact_request' as const,
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
                            {compactEmailPreview(emailItem) && (
                              <p className="mt-1 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                                {compactEmailPreview(emailItem)}
                              </p>
                            )}
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
                              __html: DOMPurify.sanitize(emailItem.body_html, {
                                ALLOWED_TAGS: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'img'],
                                ALLOWED_ATTR: ['href', 'src', 'alt', 'style', 'class', 'target'],
                                ALLOW_DATA_ATTR: false,
                              })
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
