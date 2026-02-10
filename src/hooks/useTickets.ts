import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface SupportTicket {
  id: string;
  ticket_number: string;
  profile_id: string;
  user_id: string | null;
  assigned_to: string | null;
  subject: string;
  description: string;
  category: string;
  status: "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  has_unread_user: boolean;
  has_unread_admin: boolean;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  profiles?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
  };
  assigned_profile?: {
    full_name: string | null;
  };
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  author_id: string | null;
  author_type: "user" | "support" | "system";
  author_name: string | null;
  message: string;
  attachments: string[];
  is_internal: boolean;
  is_read: boolean;
  created_at: string;
}

export interface CreateTicketData {
  subject: string;
  description: string;
  category?: string;
}

export interface CreateMessageData {
  ticket_id: string;
  message: string;
  attachments?: string[];
  is_internal?: boolean;
  author_type?: "user" | "support" | "system";
}

// Hook for user's tickets
export function useUserTickets(status?: string) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-tickets", user?.id, status],
    queryFn: async () => {
      let query = supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false });

      if (status === "open") {
        query = query.in("status", ["open", "in_progress", "waiting_user"]);
      } else if (status === "closed") {
        query = query.in("status", ["resolved", "closed"]);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as SupportTicket[];
    },
    enabled: !!user?.id,
  });
}

// Hook for admin tickets
export function useAdminTickets(filters?: {
  status?: string;
  assignedToMe?: boolean;
  starred?: boolean;
}) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["admin-tickets", filters],
    queryFn: async () => {
      let query = supabase
        .from("support_tickets")
        .select(`
          *,
          profiles:profile_id (
            full_name,
            email,
            phone,
            avatar_url
          )
        `)
        .order("updated_at", { ascending: false });

      if (filters?.status === "open") {
        query = query.in("status", ["open", "in_progress", "waiting_user"]);
      } else if (filters?.status === "closed") {
        query = query.in("status", ["resolved", "closed"]);
      }

      if (filters?.assignedToMe && user?.id) {
        query = query.eq("assigned_to", user.id);
      }

      if (filters?.starred) {
        query = query.eq("is_starred", true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as SupportTicket[];
    },
    enabled: !!user?.id,
  });
}

// Hook for single ticket
export function useTicket(ticketId: string | undefined) {
  return useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select(`
          *,
          profiles:profile_id (
            full_name,
            email,
            phone,
            avatar_url
          )
        `)
        .eq("id", ticketId!)
        .single();

      if (error) throw error;
      return data as SupportTicket;
    },
    enabled: !!ticketId,
  });
}

// Hook for ticket messages
export function useTicketMessages(ticketId: string | undefined, isAdmin: boolean = false) {
  return useQuery({
    queryKey: ["ticket-messages", ticketId, isAdmin],
    queryFn: async () => {
      let query = supabase
        .from("ticket_messages")
        .select("*")
        .eq("ticket_id", ticketId!)
        .order("created_at", { ascending: true });

      // Defense-in-depth: filter internal notes for non-admin views
      // (RLS also enforces this, but we add app-level protection)
      if (!isAdmin) {
        query = query.eq("is_internal", false);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as TicketMessage[];
    },
    enabled: !!ticketId,
  });
}

// Hook for unread tickets count (client side, with realtime)
export function useUnreadTicketsCount() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const result = useQuery({
    queryKey: ["unread-tickets-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("support_tickets")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user!.id)
        .eq("has_unread_user", true);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user?.id,
    refetchInterval: 30000,
  });

  // Realtime subscription for live unread updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel("client-unread-tickets")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets", filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["unread-tickets-count", user.id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  return result;
}

// Hook to create ticket
export function useCreateTicket() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTicketData) => {
      // Используем серверную функцию для атомарного создания тикета
      const { data: result, error } = await supabase.rpc('create_support_ticket', {
        p_subject: data.subject,
        p_description: data.description,
        p_category: data.category || null,
      });

      if (error) {
        console.error('[useCreateTicket] RPC error:', {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        });
        throw error;
      }

      // Функция возвращает JSONB с success/error
      const response = result as { success: boolean; ticket_id?: string; ticket_number?: string; error?: string; error_code?: string };
      
      if (!response.success) {
        console.error('[useCreateTicket] Server error:', response);
        
        // Преобразуем серверные ошибки в понятные сообщения
        let userMessage = 'Не удалось создать обращение';
        if (response.error?.includes('not_authenticated')) {
          userMessage = 'Необходимо войти в аккаунт';
        } else if (response.error?.includes('profile_not_found')) {
          userMessage = 'Профиль не найден. Попробуйте перезайти в аккаунт.';
        } else if (response.error) {
          userMessage = response.error;
        }
        
        throw new Error(userMessage);
      }

      return { id: response.ticket_id, ticket_number: response.ticket_number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-tickets"] });
      toast({
        title: "Обращение создано",
        description: "Мы ответим в ближайшее время",
      });
    },
    onError: (error: Error) => {
      console.error('[useCreateTicket] Mutation error:', error);
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось создать обращение",
        variant: "destructive",
      });
    },
  });
}

// Hook to send message
export function useSendMessage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMessageData) => {
      // Get user's full name for author_name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", user!.id)
        .single();

      const { data: message, error } = await supabase
        .from("ticket_messages")
        .insert({
          ticket_id: data.ticket_id,
          author_id: user!.id,
          author_type: data.author_type || "user",
          author_name: profile?.full_name,
          message: data.message,
          attachments: data.attachments || [],
          is_internal: data.is_internal || false,
        })
        .select()
        .single();

      if (error) throw error;

      // Update ticket flags
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (data.author_type === "support") {
        updateData.has_unread_user = true;
        updateData.has_unread_admin = false;
      } else {
        updateData.has_unread_admin = true;
        updateData.has_unread_user = false;
      }

      await supabase
        .from("support_tickets")
        .update(updateData)
        .eq("id", data.ticket_id);

      return message;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ticket-messages", variables.ticket_id] });
      queryClient.invalidateQueries({ queryKey: ["ticket", variables.ticket_id] });
      queryClient.invalidateQueries({ queryKey: ["user-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (error) => {
      console.error("Error sending message:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение",
        variant: "destructive",
      });
    },
  });
}

// Hook to update ticket
export function useUpdateTicket() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      updates,
    }: {
      ticketId: string;
      updates: Partial<SupportTicket>;
    }) => {
      const { data, error } = await supabase
        .from("support_tickets")
        .update(updates)
        .eq("id", ticketId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ticket", data.id] });
      queryClient.invalidateQueries({ queryKey: ["user-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (error) => {
      console.error("Error updating ticket:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось обновить обращение",
        variant: "destructive",
      });
    },
  });
}

// Hook to mark ticket as read
export function useMarkTicketRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ticketId,
      isAdmin,
    }: {
      ticketId: string;
      isAdmin: boolean;
    }) => {
      const updateData = isAdmin
        ? { has_unread_admin: false }
        : { has_unread_user: false };

      const { error } = await supabase
        .from("support_tickets")
        .update(updateData)
        .eq("id", ticketId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ticket", variables.ticketId] });
      queryClient.invalidateQueries({ queryKey: ["unread-tickets-count"] });
      queryClient.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
  });
}
