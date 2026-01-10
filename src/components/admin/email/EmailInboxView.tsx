import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Mail,
  MailOpen,
  Star,
  StarOff,
  Archive,
  Trash2,
  RefreshCw,
  Search,
  User,
  Paperclip,
  Reply,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { EmailReplyDialog } from "./EmailReplyDialog";

interface EmailItem {
  id: string;
  from_email: string;
  from_name: string | null;
  to_email: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  is_archived: boolean;
  attachments: any[];
  linked_profile_id: string | null;
  email_account?: {
    email: string;
    display_name: string | null;
  };
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
    user_id: string;
  };
}

interface EmailInboxViewProps {
  onContactClick?: (userId: string) => void;
}

export function EmailInboxView({ onContactClick }: EmailInboxViewProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);
  const [filter, setFilter] = useState<"all" | "unread" | "starred">("all");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyToEmail, setReplyToEmail] = useState<EmailItem | null>(null);

  // Fetch emails
  const { data: emails = [], isLoading, refetch } = useQuery({
    queryKey: ["admin-email-inbox", filter],
    queryFn: async () => {
      let query = supabase
        .from("email_inbox")
        .select(`
          *,
          email_account:email_accounts(email, display_name),
          profile:profiles!email_inbox_linked_profile_id_fkey(id, full_name, email, user_id)
        `)
        .eq("is_archived", false)
        .order("received_at", { ascending: false })
        .limit(100);

      if (filter === "unread") {
        query = query.eq("is_read", false);
      } else if (filter === "starred") {
        query = query.eq("is_starred", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as EmailItem[];
    },
  });

  // Filter by search
  const filteredEmails = emails.filter(email => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      email.from_email.toLowerCase().includes(search) ||
      email.from_name?.toLowerCase().includes(search) ||
      email.subject?.toLowerCase().includes(search) ||
      email.profile?.full_name?.toLowerCase().includes(search)
    );
  });

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async ({ id, isRead }: { id: string; isRead: boolean }) => {
      const { error } = await supabase
        .from("email_inbox")
        .update({ is_read: isRead })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["unread-email-count"] });
    },
  });

  // Toggle star mutation
  const toggleStarMutation = useMutation({
    mutationFn: async ({ id, isStarred }: { id: string; isStarred: boolean }) => {
      const { error } = await supabase
        .from("email_inbox")
        .update({ is_starred: isStarred })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-inbox"] });
    },
  });

  // Archive mutation
  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_inbox")
        .update({ is_archived: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-inbox"] });
      setSelectedEmail(null);
      toast.success("Письмо архивировано");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_inbox")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-inbox"] });
      setSelectedEmail(null);
      toast.success("Письмо удалено");
    },
  });

  // Fetch new emails mutation
  const fetchNewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("email-fetch-inbox");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-email-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["unread-email-count"] });
      const total = data.results?.reduce((sum: number, r: any) => sum + (r.fetched || 0), 0) || 0;
      if (total > 0) {
        toast.success(`Получено ${total} новых писем`);
      } else {
        toast.info("Новых писем нет");
      }
    },
    onError: (error: any) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const handleSelectEmail = (email: EmailItem) => {
    setSelectedEmail(email);
    if (!email.is_read) {
      markAsReadMutation.mutate({ id: email.id, isRead: true });
    }
  };

  const handleReply = (email: EmailItem) => {
    setReplyToEmail(email);
    setReplyOpen(true);
  };

  const unreadCount = emails.filter(e => !e.is_read).length;

  return (
    <div className="flex h-full">
      {/* Email List */}
      <div className={cn(
        "flex flex-col w-full md:w-[380px] md:min-w-[320px] shrink-0 border-r border-border/50",
        selectedEmail ? "hidden md:flex" : "flex"
      )}>
        {/* Header */}
        <div className="p-3 space-y-2 border-b border-border/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Почта</h3>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="h-5 px-1.5 text-xs">
                  {unreadCount}
                </Badge>
              )}
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => fetchNewMutation.mutate()}
              disabled={fetchNewMutation.isPending}
            >
              <RefreshCw className={cn("h-4 w-4", fetchNewMutation.isPending && "animate-spin")} />
            </Button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 bg-muted/50 border-0 rounded-xl"
            />
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1">
            {(["all", "unread", "starred"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "Все" : f === "unread" ? "Непрочитанные" : "Избранные"}
              </Button>
            ))}
          </div>
        </div>

        {/* Email list */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <Mail className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">Нет писем</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredEmails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => handleSelectEmail(email)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-colors",
                    "hover:bg-accent/50",
                    selectedEmail?.id === email.id && "bg-accent",
                    !email.is_read && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarFallback className={cn(
                        "text-xs",
                        email.profile ? "bg-primary/10 text-primary" : "bg-muted"
                      )}>
                        {email.from_name?.[0] || email.from_email[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          "text-sm truncate",
                          !email.is_read && "font-semibold"
                        )}>
                          {email.profile?.full_name || email.from_name || email.from_email}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {email.received_at && formatDistanceToNow(new Date(email.received_at), { 
                            addSuffix: false, 
                            locale: ru 
                          })}
                        </span>
                      </div>
                      <p className={cn(
                        "text-sm truncate",
                        !email.is_read ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {email.subject || "(Без темы)"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {email.body_text?.slice(0, 100) || ""}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {email.is_starred && (
                          <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        )}
                        {email.attachments && email.attachments.length > 0 && (
                          <Paperclip className="h-3 w-3 text-muted-foreground" />
                        )}
                        {email.profile && (
                          <Badge variant="outline" className="h-4 text-[10px] px-1">
                            Контакт
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Email Content */}
      {selectedEmail ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Email header */}
          <div className="p-4 border-b border-border/30 space-y-3">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 md:hidden"
                onClick={() => setSelectedEmail(null)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold truncate">
                  {selectedEmail.subject || "(Без темы)"}
                </h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => toggleStarMutation.mutate({ 
                    id: selectedEmail.id, 
                    isStarred: !selectedEmail.is_starred 
                  })}
                >
                  {selectedEmail.is_starred ? (
                    <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  ) : (
                    <StarOff className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => archiveMutation.mutate(selectedEmail.id)}
                >
                  <Archive className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => deleteMutation.mutate(selectedEmail.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className={cn(
                    selectedEmail.profile ? "bg-primary/10 text-primary" : "bg-muted"
                  )}>
                    {selectedEmail.from_name?.[0] || selectedEmail.from_email[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {selectedEmail.from_name || selectedEmail.from_email}
                    </span>
                    {selectedEmail.profile && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs text-primary"
                        onClick={() => onContactClick?.(selectedEmail.profile!.user_id)}
                      >
                        <User className="h-3 w-3 mr-1" />
                        Открыть контакт
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {selectedEmail.from_email}
                  </p>
                </div>
              </div>
              <div className="text-right text-sm text-muted-foreground shrink-0">
                {selectedEmail.received_at && format(
                  new Date(selectedEmail.received_at), 
                  "dd MMM yyyy, HH:mm", 
                  { locale: ru }
                )}
              </div>
            </div>
          </div>

          {/* Email body */}
          <ScrollArea className="flex-1 p-4">
            {selectedEmail.body_html ? (
              <div 
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: selectedEmail.body_html }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans text-sm">
                {selectedEmail.body_text}
              </pre>
            )}
          </ScrollArea>

          {/* Reply button */}
          <div className="p-4 border-t border-border/30">
            <Button onClick={() => handleReply(selectedEmail)} className="gap-2">
              <Reply className="h-4 w-4" />
              Ответить
            </Button>
          </div>
        </div>
      ) : (
        <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Mail className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p>Выберите письмо для просмотра</p>
          </div>
        </div>
      )}

      {/* Reply dialog */}
      <EmailReplyDialog
        email={replyToEmail}
        open={replyOpen}
        onOpenChange={setReplyOpen}
        onSuccess={() => {
          setReplyOpen(false);
          queryClient.invalidateQueries({ queryKey: ["admin-email-inbox"] });
        }}
      />
    </div>
  );
}
