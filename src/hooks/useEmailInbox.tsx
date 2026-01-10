import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface EmailInboxItem {
  id: string;
  email_account_id: string;
  message_uid: string;
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
  folder: string;
  attachments: any[];
  headers: Record<string, string>;
  linked_profile_id: string | null;
  created_at: string;
  email_account?: {
    email: string;
    display_name: string | null;
  };
  profile?: {
    id: string;
    full_name: string | null;
    email: string | null;
  };
}

interface UseEmailInboxOptions {
  isRead?: boolean;
  isStarred?: boolean;
  isArchived?: boolean;
  accountId?: string;
  searchQuery?: string;
  limit?: number;
}

export function useEmailInbox(options: UseEmailInboxOptions = {}) {
  const queryClient = useQueryClient();
  const { isRead, isStarred, isArchived = false, accountId, searchQuery, limit = 50 } = options;

  const query = useQuery({
    queryKey: ["email-inbox", options],
    queryFn: async () => {
      let q = supabase
        .from("email_inbox")
        .select(`
          *,
          email_account:email_accounts(email, display_name),
          profile:profiles(id, full_name, email)
        `)
        .eq("is_archived", isArchived)
        .order("received_at", { ascending: false })
        .limit(limit);

      if (typeof isRead === "boolean") {
        q = q.eq("is_read", isRead);
      }
      if (typeof isStarred === "boolean") {
        q = q.eq("is_starred", isStarred);
      }
      if (accountId) {
        q = q.eq("email_account_id", accountId);
      }
      if (searchQuery) {
        q = q.or(`subject.ilike.%${searchQuery}%,from_email.ilike.%${searchQuery}%,from_name.ilike.%${searchQuery}%`);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as EmailInboxItem[];
    },
  });

  const markAsReadMutation = useMutation({
    mutationFn: async ({ id, isRead }: { id: string; isRead: boolean }) => {
      const { error } = await supabase
        .from("email_inbox")
        .update({ is_read: isRead })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["unread-email-count"] });
    },
  });

  const toggleStarMutation = useMutation({
    mutationFn: async ({ id, isStarred }: { id: string; isStarred: boolean }) => {
      const { error } = await supabase
        .from("email_inbox")
        .update({ is_starred: isStarred })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-inbox"] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, isArchived }: { id: string; isArchived: boolean }) => {
      const { error } = await supabase
        .from("email_inbox")
        .update({ is_archived: isArchived })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-inbox"] });
      toast.success("Письмо перемещено");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_inbox")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-inbox"] });
      toast.success("Письмо удалено");
    },
  });

  const fetchNewMutation = useMutation({
    mutationFn: async (accountId?: string) => {
      const { data, error } = await supabase.functions.invoke("email-fetch-inbox", {
        body: { account_id: accountId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-inbox"] });
      queryClient.invalidateQueries({ queryKey: ["unread-email-count"] });
      const total = data.results?.reduce((sum: number, r: any) => sum + (r.fetched || 0), 0) || 0;
      if (total > 0) {
        toast.success(`Получено ${total} новых писем`);
      } else {
        toast.info("Новых писем нет");
      }
    },
    onError: (error: any) => {
      toast.error("Ошибка получения почты: " + error.message);
    },
  });

  return {
    emails: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    markAsRead: markAsReadMutation.mutate,
    toggleStar: toggleStarMutation.mutate,
    archive: archiveMutation.mutate,
    deleteEmail: deleteMutation.mutate,
    fetchNew: fetchNewMutation.mutate,
    isFetching: fetchNewMutation.isPending,
  };
}

export function useUnreadEmailCount() {
  return useQuery({
    queryKey: ["unread-email-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("email_inbox")
        .select("*", { count: "exact", head: true })
        .eq("is_read", false)
        .eq("is_archived", false);
      if (error) throw error;
      return count || 0;
    },
  });
}

export function useEmailById(id: string | null) {
  return useQuery({
    queryKey: ["email-inbox", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("email_inbox")
        .select(`
          *,
          email_account:email_accounts(email, display_name),
          profile:profiles(id, full_name, email)
        `)
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as EmailInboxItem;
    },
    enabled: !!id,
  });
}