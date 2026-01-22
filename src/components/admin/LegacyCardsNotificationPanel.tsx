import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  CreditCard,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  MessageCircle,
  Loader2,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface LegacyCardUser {
  user_id: string;
  profile_id: string;
  full_name: string | null;
  email: string | null;
  telegram_user_id: string | null;
  card_last4: string;
  card_brand: string;
  revoked_at: string;
  notification_sent: boolean;
  notification_date: string | null;
}

export function LegacyCardsNotificationPanel() {
  const queryClient = useQueryClient();
  const [sendingUserId, setSendingUserId] = useState<string | null>(null);

  // Fetch legacy card users with notification status
  const { data: users, isLoading } = useQuery({
    queryKey: ["legacy-card-users"],
    queryFn: async () => {
      // Get revoked legacy cards
      const { data: cards, error: cardsError } = await supabase
        .from("payment_methods")
        .select("id, user_id, last4, brand, updated_at")
        .eq("supports_recurring", false)
        .eq("status", "revoked")
        .order("updated_at", { ascending: false });

      if (cardsError) throw cardsError;

      // Get profiles for these users
      const userIds = [...new Set(cards?.map(c => c.user_id) || [])];
      
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email, telegram_user_id")
        .in("user_id", userIds);

      // Get notification logs
      const { data: notifications } = await supabase
        .from("telegram_logs")
        .select("user_id, created_at")
        .eq("action", "legacy_card_notification")
        .in("user_id", userIds);

      const notificationMap = new Map(
        notifications?.map(n => [n.user_id, n.created_at]) || []
      );

      const profileMap = new Map(
        profiles?.map(p => [p.user_id, p]) || []
      );

      // Combine data
      const result: LegacyCardUser[] = [];
      const seenUsers = new Set<string>();

      for (const card of cards || []) {
        if (seenUsers.has(card.user_id)) continue;
        seenUsers.add(card.user_id);

        const profile = profileMap.get(card.user_id);
        if (!profile) continue;

        result.push({
          user_id: card.user_id,
          profile_id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          telegram_user_id: profile.telegram_user_id ? String(profile.telegram_user_id) : null,
          card_last4: card.last4,
          card_brand: card.brand,
          revoked_at: card.updated_at,
          notification_sent: notificationMap.has(card.user_id),
          notification_date: notificationMap.get(card.user_id) || null,
        });
      }

      return result;
    },
  });

  // Send notification mutation
  const sendNotificationMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "telegram-send-notification",
        {
          body: {
            user_id: userId,
            message_type: "legacy_card_notification",
          },
        }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to send");
      return data;
    },
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({ queryKey: ["legacy-card-users"] });
      toast.success("Уведомление отправлено");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Send all notifications
  const sendAllMutation = useMutation({
    mutationFn: async () => {
      const usersToNotify = users?.filter(u => !u.notification_sent && u.telegram_user_id) || [];
      const results = { sent: 0, failed: 0 };

      for (const user of usersToNotify) {
        try {
          const { data, error } = await supabase.functions.invoke(
            "telegram-send-notification",
            {
              body: {
                user_id: user.user_id,
                message_type: "legacy_card_notification",
              },
            }
          );

          if (error || !data?.success) {
            results.failed++;
          } else {
            results.sent++;
          }

          // Small delay
          await new Promise(r => setTimeout(r, 150));
        } catch {
          results.failed++;
        }
      }

      return results;
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["legacy-card-users"] });
      toast.success(`Отправлено: ${results.sent}, ошибок: ${results.failed}`);
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  const handleSendOne = async (userId: string) => {
    setSendingUserId(userId);
    try {
      await sendNotificationMutation.mutateAsync(userId);
    } finally {
      setSendingUserId(null);
    }
  };

  const stats = {
    total: users?.length || 0,
    sent: users?.filter(u => u.notification_sent).length || 0,
    pending: users?.filter(u => !u.notification_sent && u.telegram_user_id).length || 0,
    noTelegram: users?.filter(u => !u.telegram_user_id).length || 0,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Пользователи с отозванными legacy-картами
          </CardTitle>
          {stats.pending > 0 && (
            <Button
              size="sm"
              onClick={() => sendAllMutation.mutate()}
              disabled={sendAllMutation.isPending}
            >
              {sendAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Отправить всем ({stats.pending})
            </Button>
          )}
        </div>
        
        <div className="flex gap-2 mt-2 flex-wrap">
          <Badge variant="outline">Всего: {stats.total}</Badge>
          <Badge className="bg-green-100 text-green-800">
            <CheckCircle className="w-3 h-3 mr-1" />
            Уведомлены: {stats.sent}
          </Badge>
          <Badge className="bg-yellow-100 text-yellow-800">
            <Clock className="w-3 h-3 mr-1" />
            Ожидают: {stats.pending}
          </Badge>
          <Badge variant="secondary">
            <XCircle className="w-3 h-3 mr-1" />
            Без Telegram: {stats.noTelegram}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : !users?.length ? (
          <p className="text-center text-muted-foreground py-8">
            Нет пользователей с отозванными legacy-картами
          </p>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2 pr-4">
              {users.map((user) => (
                <div
                  key={user.user_id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {user.full_name || "Без имени"}
                      </span>
                      {user.notification_sent ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Отправлено
                        </Badge>
                      ) : user.telegram_user_id ? (
                        <Badge className="bg-yellow-100 text-yellow-800">
                          <Clock className="w-3 h-3 mr-1" />
                          Ожидает
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <XCircle className="w-3 h-3 mr-1" />
                          Нет TG
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {user.email} • {user.card_brand} ****{user.card_last4}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Карта отозвана:{" "}
                      {format(new Date(user.revoked_at), "dd MMM yyyy, HH:mm", {
                        locale: ru,
                      })}
                      {user.notification_date && (
                        <>
                          {" "}
                          • Уведомлен:{" "}
                          {format(
                            new Date(user.notification_date),
                            "dd MMM yyyy, HH:mm",
                            { locale: ru }
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-2">
                    {user.telegram_user_id && (
                      <MessageCircle className="w-4 h-4 text-blue-500" />
                    )}
                    {!user.notification_sent && user.telegram_user_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendOne(user.user_id)}
                        disabled={sendingUserId === user.user_id}
                      >
                        {sendingUserId === user.user_id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
