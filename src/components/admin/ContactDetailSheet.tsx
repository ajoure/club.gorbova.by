import { useState } from "react";
import { format, addDays, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import {
  User,
  Mail,
  Phone,
  MessageCircle,
  Calendar as CalendarIcon,
  Clock,
  Handshake,
  CreditCard,
  Copy,
  ExternalLink,
  Shield,
  Ban,
  CheckCircle,
  XCircle,
  Key,
  Plus,
  RotateCcw,
  Settings,
  ChevronRight,
  ChevronDown,
  Eye,
  Trash2,
  Send,
  BookOpen,
  History,
  Undo2,
  Download,
  ShieldCheck,
  ShieldX,
  FileText,
  Wallet,
  Pencil,
} from "lucide-react";
import { ContactInstallments } from "@/components/installments/ContactInstallments";
import { toast } from "sonner";
import { DealDetailSheet } from "./DealDetailSheet";
import { RefundDialog } from "./RefundDialog";
import { AccessHistorySheet } from "./AccessHistorySheet";
import { EditContactDialog } from "./EditContactDialog";
import { ContactTelegramChat } from "./ContactTelegramChat";
import { ContactEmailHistory } from "./ContactEmailHistory";

interface Contact {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  telegram_user_id: number | null;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  duplicate_flag: string | null;
  deals_count: number;
  last_deal_at: string | null;
}

interface ContactDetailSheetProps {
  contact: Contact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContactDetailSheet({ contact, open, onOpenChange }: ContactDetailSheetProps) {
  const queryClient = useQueryClient();
  const [selectedSubscription, setSelectedSubscription] = useState<any>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [grantProductId, setGrantProductId] = useState("");
  const [grantTariffId, setGrantTariffId] = useState("");
  const [grantDateRange, setGrantDateRange] = useState<DateRange | undefined>({
    from: new Date(),
    to: addDays(new Date(), 30),
  });
  const [grantComment, setGrantComment] = useState("");
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [dealSheetOpen, setDealSheetOpen] = useState(false);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundDeal, setRefundDeal] = useState<any>(null);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Fetch deals for this contact
  const { data: deals, isLoading: dealsLoading } = useQuery({
    queryKey: ["contact-deals", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return [];
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code),
          payments_v2(id, status, provider_response)
        `)
        .eq("user_id", contact.user_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // Fetch subscriptions for this contact
  const { data: subscriptions, isLoading: subsLoading, refetch: refetchSubs } = useQuery({
    queryKey: ["contact-subscriptions", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return [];
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          *,
          products_v2(id, name, code, telegram_club_id),
          tariffs(id, name, code, getcourse_offer_code, getcourse_offer_id)
        `)
        .eq("user_id", contact.user_id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // Fetch products for grant access
  const { data: products } = useQuery({
    queryKey: ["products-for-grant"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_v2")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  // Fetch tariffs for selected product
  const { data: tariffs } = useQuery({
    queryKey: ["tariffs-for-grant", grantProductId],
    queryFn: async () => {
      if (!grantProductId) return [];
      const { data, error } = await supabase
        .from("tariffs")
        .select("id, name, code")
        .eq("product_id", grantProductId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!grantProductId,
  });

  // Fetch communication history (audit logs for this user) with actor profiles
  const { data: communications, isLoading: commsLoading } = useQuery({
    queryKey: ["contact-communications", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return [];
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("target_user_id", contact.user_id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      
      // Fetch actor profiles
      const actorIds = [...new Set(logs.map(l => l.actor_user_id).filter(Boolean))];
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", actorIds);
        
        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
        return logs.map(log => ({
          ...log,
          actor_profile: profileMap.get(log.actor_user_id) || null
        }));
      }
      
      return logs.map(log => ({ ...log, actor_profile: null }));
    },
    enabled: !!contact?.user_id,
  });

  // Fetch duplicate info
  const { data: duplicateInfo } = useQuery({
    queryKey: ["contact-duplicates", contact?.id],
    queryFn: async () => {
      if (!contact?.duplicate_flag) return null;
      const { data, error } = await supabase
        .from("duplicate_cases")
        .select(`
          *,
          client_duplicates(
            profile_id,
            is_master,
            profiles:profile_id(id, email, full_name, phone)
          )
        `)
        .eq("phone", contact.phone || "")
        .eq("status", "new")
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!contact?.duplicate_flag,
  });

  // Fetch consent data for this contact
  const { data: profileConsent } = useQuery({
    queryKey: ["contact-profile-consent", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("consent_version, consent_given_at, marketing_consent")
        .eq("user_id", contact.user_id)
        .maybeSingle();
      if (error) return null;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // Fetch consent history
  const { data: consentHistory, isLoading: consentLoading } = useQuery({
    queryKey: ["contact-consent-history", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return [];
      const { data, error } = await supabase
        .from("consent_logs")
        .select("*")
        .eq("user_id", contact.user_id)
        .order("created_at", { ascending: false });
      if (error) return [];
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // Admin action mutation
  const adminActionMutation = useMutation({
    mutationFn: async ({ action, subscriptionId, data }: { action: string; subscriptionId: string; data?: Record<string, any> }) => {
      const { data: result, error } = await supabase.functions.invoke("subscription-admin-actions", {
        body: {
          action,
          subscription_id: subscriptionId,
          ...data,
        },
      });
      if (error) throw error;
      if (!result.success) throw new Error(result.error);
      return result;
    },
    onSuccess: (_, variables) => {
      const messages: Record<string, string> = {
        cancel: "Подписка отменена",
        resume: "Подписка восстановлена",
        extend: "Доступ продлён",
        grant_access: "Доступ выдан",
        revoke_access: "Доступ отозван",
        delete: "Подписка удалена",
      };
      toast.success(messages[variables.action] || "Действие выполнено");
      refetchSubs();
      setSelectedSubscription(null);
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  const handleSubscriptionAction = async (action: string, subscriptionId: string, data?: Record<string, any>) => {
    setIsProcessing(true);
    try {
      await adminActionMutation.mutateAsync({ action, subscriptionId, data });
    } finally {
      setIsProcessing(false);
    }
  };

  // Grant new access - performs all the same actions as a regular purchase
  const handleGrantNewAccess = async () => {
    if (!contact?.user_id || !grantProductId || !grantTariffId) {
      toast.error("Выберите продукт и тариф");
      return;
    }

    if (!grantDateRange?.from || !grantDateRange?.to) {
      toast.error("Выберите период доступа");
      return;
    }

    setIsProcessing(true);
    try {
      const currentUser = (await supabase.auth.getUser()).data.user;
      const accessStart = grantDateRange.from;
      const accessEnd = grantDateRange.to;
      const grantDays = differenceInDays(accessEnd, accessStart) + 1;
      const now = new Date();
      
      // Get tariff and product data upfront
      const [{ data: tariff }, { data: product }] = await Promise.all([
        supabase.from("tariffs").select("getcourse_offer_code, getcourse_offer_id, code, name").eq("id", grantTariffId).single(),
        supabase.from("products_v2").select("telegram_club_id, code, name").eq("id", grantProductId).single(),
      ]);

      // 1. Create order_v2 (like bepaid-webhook does)
      const orderNumber = `GIFT-${now.getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;
      const { data: orderV2, error: orderError } = await supabase.from("orders_v2").insert({
        order_number: orderNumber,
        user_id: contact.user_id,
        product_id: grantProductId,
        tariff_id: grantTariffId,
        customer_email: contact.email,
        base_price: 0,
        final_price: 0,
        paid_amount: 0,
        currency: "BYN",
        status: "paid",
        is_trial: false,
        meta: { 
          source: "admin_grant", 
          granted_by: currentUser?.id,
          granted_by_email: currentUser?.email,
          comment: grantComment || null,
          access_start: accessStart.toISOString(),
          access_end: accessEnd.toISOString(),
        },
      }).select().single();

      if (orderError) throw orderError;

      // 2. Create payment_v2 as gift/admin (for history and reports)
      await supabase.from("payments_v2").insert({
        order_id: orderV2.id,
        user_id: contact.user_id,
        amount: 0,
        currency: "BYN",
        status: "succeeded",
        provider: "admin",
        paid_at: now.toISOString(),
        meta: { source: "admin_grant", granted_by: currentUser?.id },
      });

      // 3. Check for existing active subscription and extend or create new
      const { data: existingSub } = await supabase
        .from("subscriptions_v2")
        .select("id, access_end_at")
        .eq("user_id", contact.user_id)
        .eq("product_id", grantProductId)
        .eq("tariff_id", grantTariffId)
        .in("status", ["active", "trial"])
        .is("canceled_at", null)
        .gte("access_end_at", now.toISOString())
        .order("access_end_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let subscriptionId: string;
      if (existingSub) {
        // Extend existing subscription to use the later date
        const currentEnd = new Date(existingSub.access_end_at);
        const newEnd = accessEnd > currentEnd ? accessEnd : new Date(currentEnd.getTime() + grantDays * 24 * 60 * 60 * 1000);
        await supabase.from("subscriptions_v2").update({
          access_end_at: newEnd.toISOString(),
          order_id: orderV2.id,
        }).eq("id", existingSub.id);
        subscriptionId = existingSub.id;
      } else {
        // Create new subscription with custom dates
        const { data: newSub, error: subError } = await supabase.from("subscriptions_v2").insert({
          user_id: contact.user_id,
          order_id: orderV2.id,
          product_id: grantProductId,
          tariff_id: grantTariffId,
          status: "active",
          is_trial: false,
          access_start_at: accessStart.toISOString(),
          access_end_at: accessEnd.toISOString(),
        }).select().single();
        if (subError) throw subError;
        subscriptionId = newSub.id;
      }

      // Track sync results
      const syncResults: Record<string, { success: boolean; error?: string }> = {};

      // 4. Create telegram_access_grants and grant access if product has club
      if (product?.telegram_club_id) {
        try {
          // Create access grant record
          await supabase.from("telegram_access_grants").insert({
            user_id: contact.user_id,
            club_id: product.telegram_club_id,
            source: "admin_grant",
            source_id: orderV2.id,
            start_at: accessStart.toISOString(),
            end_at: accessEnd.toISOString(),
            status: "active",
            meta: {
              product_id: grantProductId,
              tariff_id: grantTariffId,
              granted_by: currentUser?.id,
              granted_by_email: currentUser?.email,
              comment: grantComment || null,
            },
          });

          // Grant Telegram access via edge function
          const { error: tgError } = await supabase.functions.invoke("telegram-grant-access", {
            body: {
              user_id: contact.user_id,
              club_id: product.telegram_club_id,
              duration_days: grantDays,
              source: "admin_grant",
            },
          });
          
          syncResults.telegram = { success: !tgError, error: tgError?.message };
        } catch (err) {
          syncResults.telegram = { success: false, error: (err as Error).message };
        }
      }

      // 5. Sync to GetCourse using the created order (so gc_deal_number is saved for future revoke/cancel)
      const gcOfferId = tariff?.getcourse_offer_id || tariff?.getcourse_offer_code;
      if (gcOfferId) {
        try {
          const { data: gcResult, error: gcError } = await supabase.functions.invoke("test-getcourse-sync", {
            body: {
              orderId: orderV2.id,
              // Fallbacks (function will prefer order/tariff data when orderId is provided)
              email: contact.email,
              offerId: typeof gcOfferId === "string" ? parseInt(gcOfferId) : gcOfferId,
              tariffCode: tariff?.code || "admin_grant",
            },
          });

          if (gcError) {
            syncResults.getcourse = { success: false, error: gcError.message };
          } else if (gcResult?.getcourse?.success) {
            syncResults.getcourse = { success: true };
          } else {
            syncResults.getcourse = { success: false, error: gcResult?.getcourse?.error || "Unknown error" };
          }
        } catch (err) {
          syncResults.getcourse = { success: false, error: (err as Error).message };
        }
      }

      // Update subscription meta with sync results
      if (Object.keys(syncResults).length > 0) {
        await supabase.from("subscriptions_v2").update({
          meta: { sync_results: syncResults, synced_at: now.toISOString() },
        }).eq("id", subscriptionId);
      }

      // 6. Log action with full details
      await supabase.from("audit_logs").insert({
        actor_user_id: currentUser?.id,
        action: "admin.grant_access",
        target_user_id: contact.user_id,
        meta: { 
          product_id: grantProductId,
          product_name: product?.name,
          tariff_id: grantTariffId,
          tariff_name: tariff?.name,
          days: grantDays,
          access_start: accessStart.toISOString(),
          access_end: accessEnd.toISOString(),
          comment: grantComment || null,
          order_id: orderV2.id,
          order_number: orderNumber,
          subscription_id: subscriptionId,
          extended_existing: !!existingSub,
          getcourse_offer_code: tariff?.getcourse_offer_code,
          telegram_club_id: product?.telegram_club_id,
          sync_results: syncResults,
        },
      });

      const dateStr = `${format(accessStart, "dd.MM.yy")} — ${format(accessEnd, "dd.MM.yy")}`;
      toast.success(existingSub 
        ? `Доступ продлён (${dateStr})` 
        : `Доступ выдан (${dateStr})`
      );
      queryClient.invalidateQueries({ queryKey: ["contact-deals", contact.user_id] });
      refetchSubs();
      setGrantProductId("");
      setGrantTariffId("");
      setGrantComment("");
      setGrantDateRange({ from: new Date(), to: addDays(new Date(), 30) });
    } catch (error) {
      console.error("Grant access error:", error);
      toast.error("Ошибка выдачи доступа: " + (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован`);
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: "Черновик",
      pending: "Ожидает оплаты",
      paid: "Оплачен",
      partial: "Частично оплачен",
      cancelled: "Отменён",
      refunded: "Возврат",
      expired: "Истёк",
      failed: "Ошибка",
    };
    return labels[status] || status;
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      "subscription.purchased": "Покупка подписки",
      "subscription.created": "Подписка создана",
      "subscription.activated": "Подписка активирована",
      "subscription.canceled": "Подписка отменена",
      "subscription.expired": "Подписка истекла",
      "admin.subscription.refund": "Возврат средств",
      "admin.subscription.extend": "Продление доступа",
      "admin.subscription.cancel": "Отмена подписки",
      "admin.grant_access": "Выдача доступа",
      "admin.revoke_access": "Отзыв доступа",
      "payment.success": "Успешная оплата",
      "payment.failed": "Ошибка оплаты",
      "trial.started": "Начало триала",
      "trial.ended": "Окончание триала",
      "telegram.access_granted": "Доступ в Telegram",
      "telegram.access_revoked": "Отзыв доступа в Telegram",
    };
    return labels[action] || action;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid": return "bg-green-500/20 text-green-600";
      case "pending": return "bg-amber-500/20 text-amber-600";
      case "refunded": return "bg-orange-500/20 text-orange-600";
      case "cancelled": 
      case "failed": return "bg-red-500/20 text-red-600";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getSubscriptionStatusBadge = (sub: any) => {
    const isExpired = sub.access_end_at && new Date(sub.access_end_at) < new Date();
    const isCanceled = !!sub.canceled_at;
    
    if (isExpired) {
      return <Badge variant="secondary">Истекла</Badge>;
    }
    if (isCanceled) {
      return <Badge variant="outline" className="text-amber-600 border-amber-300">Не продлевается</Badge>;
    }
    if (sub.status === "trial") {
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Триал</Badge>;
    }
    if (sub.status === "active") {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Активна</Badge>;
    }
    return <Badge variant="outline">{sub.status}</Badge>;
  };

  const activeSubscriptions = subscriptions?.filter(s => {
    const isExpired = s.access_end_at && new Date(s.access_end_at) < new Date();
    return !isExpired && (s.status === "active" || s.status === "trial");
  }) || [];

  if (!contact) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden">
        {/* Compact header for mobile - with padding-right for close button */}
        <SheetHeader className="p-4 sm:p-6 pb-3 sm:pb-4 pr-14 sm:pr-16 border-b flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 sm:w-7 sm:h-7 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg sm:text-xl truncate">{contact.full_name || "Без имени"}</SheetTitle>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">{contact.email}</p>
              </div>
            </div>
            <Badge variant={contact.status === "active" ? "default" : "secondary"} className="flex-shrink-0 text-xs mt-1">
              {contact.status === "active" ? (
                <><CheckCircle className="w-3 h-3 mr-1" />Активен</>
              ) : contact.status === "blocked" ? (
                <><Ban className="w-3 h-3 mr-1" />Заблокирован</>
              ) : (
                <><XCircle className="w-3 h-3 mr-1" />{contact.status}</>
              )}
            </Badge>
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)} className="mt-2">
            <Pencil className="w-3 h-3 mr-1" />
            Редактировать
          </Button>
        </SheetHeader>

        <Tabs defaultValue="profile" className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Scrollable tabs for mobile */}
          <div className="flex-shrink-0 border-b overflow-x-auto">
            <TabsList className="mx-4 sm:mx-6 my-2 sm:my-3 inline-flex w-auto whitespace-nowrap">
              <TabsTrigger value="profile" className="text-xs sm:text-sm px-2.5 sm:px-3">Профиль</TabsTrigger>
              <TabsTrigger value="telegram" className="text-xs sm:text-sm px-2.5 sm:px-3">
                <MessageCircle className="w-3 h-3 mr-1" />
                Telegram
              </TabsTrigger>
              <TabsTrigger value="email" className="text-xs sm:text-sm px-2.5 sm:px-3">
                <Mail className="w-3 h-3 mr-1" />
                Письма
              </TabsTrigger>
              <TabsTrigger value="access" className="text-xs sm:text-sm px-2.5 sm:px-3">
                Доступы {activeSubscriptions.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{activeSubscriptions.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="deals" className="text-xs sm:text-sm px-2.5 sm:px-3">
                Сделки {deals && deals.length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{deals.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="communications" className="text-xs sm:text-sm px-2.5 sm:px-3">События</TabsTrigger>
              <TabsTrigger value="consent" className="text-xs sm:text-sm px-2.5 sm:px-3">
                Согласия
                {profileConsent?.consent_version && (
                  <Badge variant="secondary" className="ml-1 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">✓</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="installments" className="text-xs sm:text-sm px-2.5 sm:px-3">
                <Wallet className="w-3 h-3 mr-1" />
                Рассрочки
              </TabsTrigger>
              {contact.duplicate_flag && contact.duplicate_flag !== 'none' && (
                <TabsTrigger value="duplicates" className="text-xs sm:text-sm px-2.5 sm:px-3">Дубли</TabsTrigger>
              )}
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-4 sm:px-6 py-4 pb-24">
            <TabsContent value="profile" className="m-0 space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Контактные данные</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <span>{contact.email || "—"}</span>
                    </div>
                    {contact.email && (
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(contact.email!, "Email")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <span>{contact.phone || "—"}</span>
                    </div>
                    {contact.phone && (
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(contact.phone!, "Телефон")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <MessageCircle className="w-4 h-4 text-blue-500" />
                      {contact.telegram_username ? (
                        <span>@{contact.telegram_username}</span>
                      ) : contact.telegram_user_id ? (
                        <span className="text-muted-foreground">ID: {contact.telegram_user_id}</span>
                      ) : (
                        <span className="text-muted-foreground">Не привязан</span>
                      )}
                    </div>
                    {contact.telegram_username && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`https://t.me/${contact.telegram_username}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Системная информация</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm">
                      <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Регистрация</span>
                    </div>
                    <span className="text-sm">{format(new Date(contact.created_at), "dd MMM yyyy HH:mm", { locale: ru })}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Последний визит</span>
                    </div>
                    <span className="text-sm">
                      {contact.last_seen_at 
                        ? format(new Date(contact.last_seen_at), "dd MMM yyyy HH:mm", { locale: ru })
                        : "—"}
                    </span>
                  </div>
                  <Separator />
                  {contact.user_id && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-sm">
                        <Shield className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">ID пользователя</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(contact.user_id!, "ID")}>
                        <code className="text-xs mr-2">{contact.user_id.slice(0, 8)}...</code>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Telegram Chat Tab */}
            <TabsContent value="telegram" className="m-0">
              <ContactTelegramChat
                userId={contact.user_id || ""}
                telegramUserId={contact.telegram_user_id}
                telegramUsername={contact.telegram_username}
              />
            </TabsContent>

            {/* Email History Tab */}
            <TabsContent value="email" className="m-0">
              <ContactEmailHistory
                userId={contact.user_id}
                email={contact.email}
              />
            </TabsContent>

            {/* Access/Subscriptions Tab */}
            <TabsContent value="access" className="m-0 space-y-4">
              {/* History button */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHistorySheetOpen(true)}
                  className="gap-1.5 text-xs"
                >
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">История действий</span>
                  <span className="sm:hidden">История</span>
                </Button>
              </div>

              {/* Grant new access */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Выдать новый доступ
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Продукт</Label>
                      <Select value={grantProductId} onValueChange={(v) => { setGrantProductId(v); setGrantTariffId(""); }}>
                        <SelectTrigger className="h-10 sm:h-9 text-sm">
                          <SelectValue placeholder="Выбрать..." />
                        </SelectTrigger>
                        <SelectContent>
                          {products?.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Тариф</Label>
                      <Select value={grantTariffId} onValueChange={setGrantTariffId} disabled={!grantProductId}>
                        <SelectTrigger className="h-10 sm:h-9 text-sm">
                          <SelectValue placeholder="Выбрать..." />
                        </SelectTrigger>
                        <SelectContent>
                          {tariffs?.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {/* Date range picker */}
                  <div>
                    <Label className="text-xs">Период доступа</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal h-10 sm:h-9",
                            !grantDateRange && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {grantDateRange?.from ? (
                            grantDateRange.to ? (
                              <>
                                {format(grantDateRange.from, "dd.MM.yy")} — {format(grantDateRange.to, "dd.MM.yy")}
                                <span className="ml-auto text-muted-foreground text-xs">
                                  ({differenceInDays(grantDateRange.to, grantDateRange.from) + 1} дн.)
                                </span>
                              </>
                            ) : (
                              format(grantDateRange.from, "dd.MM.yy")
                            )
                          ) : (
                            <span>Выберите период</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          initialFocus
                          mode="range"
                          defaultMonth={grantDateRange?.from}
                          selected={grantDateRange}
                          onSelect={setGrantDateRange}
                          numberOfMonths={1}
                          locale={ru}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  
                  {/* Comment field */}
                  <div>
                    <Label className="text-xs">Комментарий (необязательно)</Label>
                    <Textarea
                      value={grantComment}
                      onChange={(e) => setGrantComment(e.target.value)}
                      placeholder="Причина выдачи доступа..."
                      className="min-h-[60px] resize-none"
                    />
                  </div>

                  <Button
                    onClick={handleGrantNewAccess}
                    disabled={isProcessing || !grantProductId || !grantTariffId || !grantDateRange?.from || !grantDateRange?.to}
                    className="gap-1 h-10 sm:h-9 w-full"
                  >
                    <Plus className="w-4 h-4" />
                    Выдать доступ
                  </Button>
                </CardContent>
              </Card>

              {/* Existing subscriptions */}
              {subsLoading ? (
                <div className="space-y-3">
                  {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                </div>
              ) : !subscriptions?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Нет подписок</p>
                </div>
              ) : (
                subscriptions.map(sub => {
                  const product = sub.products_v2 as any;
                  const tariff = sub.tariffs as any;
                  const isSelected = selectedSubscription?.id === sub.id;
                  const isCanceled = !!sub.canceled_at;
                  const isExpired = sub.access_end_at && new Date(sub.access_end_at) < new Date();
                  const isActive = !isExpired && (sub.status === "active" || sub.status === "trial");

                  return (
                    <Card key={sub.id} className={`transition-all ${isSelected ? "ring-2 ring-primary" : ""}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-medium">{product?.name || "Продукт"}</div>
                            <div className="text-sm text-muted-foreground">{tariff?.name}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {getSubscriptionStatusBadge(sub)}
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleSubscriptionAction("delete", sub.id)}
                              disabled={isProcessing}
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Access info badges with sync status */}
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {product?.telegram_club_id && (() => {
                            const syncResults = (sub.meta as any)?.sync_results;
                            const tgSync = syncResults?.telegram;
                            const hasSync = tgSync !== undefined;
                            const isSuccess = tgSync?.success === true;
                            
                            return (
                              <Badge 
                                variant="outline" 
                                className={`text-xs gap-1 ${
                                  hasSync 
                                    ? (isSuccess ? "text-blue-600 border-blue-200" : "text-muted-foreground border-muted") 
                                    : "text-blue-600 border-blue-200"
                                }`}
                                title={tgSync?.error || (isSuccess ? "Синхронизировано" : "")}
                              >
                                <Send className="w-3 h-3" />
                                Telegram
                                {hasSync && (
                                  isSuccess 
                                    ? <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                                    : <XCircle className="w-2.5 h-2.5 text-muted-foreground" />
                                )}
                              </Badge>
                            );
                          })()}
                          {(tariff?.getcourse_offer_code || tariff?.getcourse_offer_id) && (() => {
                            const syncResults = (sub.meta as any)?.sync_results;
                            const gcSync = syncResults?.getcourse;
                            const hasSync = gcSync !== undefined;
                            const isSuccess = gcSync?.success === true;
                            
                            return (
                              <Badge 
                                variant="outline" 
                                className={`text-xs gap-1 ${
                                  hasSync 
                                    ? (isSuccess ? "text-purple-600 border-purple-200" : "text-muted-foreground border-muted") 
                                    : "text-purple-600 border-purple-200"
                                }`}
                                title={gcSync?.error || (isSuccess ? "Синхронизировано" : "")}
                              >
                                <BookOpen className="w-3 h-3" />
                                GetCourse
                                {hasSync && (
                                  isSuccess 
                                    ? <CheckCircle className="w-2.5 h-2.5 text-green-500" />
                                    : <XCircle className="w-2.5 h-2.5 text-muted-foreground" />
                                )}
                              </Badge>
                            );
                          })()}
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                          <div>
                            <span className="text-muted-foreground">Начало: </span>
                            <span>{format(new Date(sub.access_start_at), "dd.MM.yy")}</span>
                          </div>
                          {sub.access_end_at && (
                            <div>
                              <span className="text-muted-foreground">До: </span>
                              <span className={isExpired ? "text-destructive" : ""}>{format(new Date(sub.access_end_at), "dd.MM.yy")}</span>
                            </div>
                          )}
                          {sub.next_charge_at && !isCanceled && (
                            <div className="col-span-2">
                              <span className="text-muted-foreground">Списание: </span>
                              <span>{format(new Date(sub.next_charge_at), "dd.MM.yy")}</span>
                            </div>
                          )}
                        </div>

                        {/* Quick actions - mobile friendly */}
                        <div className="flex flex-wrap gap-1.5 sm:gap-2">
                          {/* Extend mode */}
                          {isSelected ? (
                            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center w-full">
                              <div className="flex gap-1 items-center">
                              <Input
                                  type="number"
                                  value={extendDays === 0 ? "" : extendDays}
                                  onChange={(e) => setExtendDays(e.target.value === "" ? 0 : parseInt(e.target.value) || 0)}
                                  onBlur={() => { if (extendDays < 1) setExtendDays(1); }}
                                  className="h-9 sm:h-8 w-20"
                                  min={1}
                                />
                                <span className="text-xs">дней</span>
                              </div>
                              <div className="flex gap-1 flex-1">
                                <Button
                                  size="sm"
                                  onClick={() => handleSubscriptionAction("extend", sub.id, { days: extendDays })}
                                  disabled={isProcessing}
                                  className="h-9 sm:h-8 flex-1 sm:flex-none gap-1 text-xs sm:text-sm"
                                >
                                  <Plus className="w-3 h-3" />
                                  Продлить
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSelectedSubscription(null)}
                                  className="h-9 sm:h-8 px-3"
                                >
                                  ✕
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedSubscription(sub)}
                                className="h-9 sm:h-7 text-xs px-2.5 sm:px-3 gap-1"
                              >
                                <Settings className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                <span className="hidden xs:inline">Управление</span>
                                <span className="xs:hidden">⚙</span>
                              </Button>
                              
                              {isCanceled && isActive ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleSubscriptionAction("resume", sub.id)}
                                  disabled={isProcessing}
                                  className="h-9 sm:h-7 text-xs px-2.5 sm:px-3 gap-1"
                                >
                                  <RotateCcw className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                  Возобновить
                                </Button>
                              ) : isActive ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={isProcessing}
                                      className="h-9 sm:h-7 text-xs px-2.5 sm:px-3 gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                                    >
                                      <Ban className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                                      <span className="hidden sm:inline">Управление доступом</span>
                                      <span className="sm:hidden">Доступ</span>
                                      <ChevronDown className="w-3 h-3 ml-1" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="w-56">
                                    <DropdownMenuItem
                                      onClick={() => handleSubscriptionAction("cancel", sub.id)}
                                      className="gap-2 text-amber-600"
                                    >
                                      <Ban className="w-4 h-4" />
                                      <div>
                                        <div className="font-medium">Отменить автопродление</div>
                                        <div className="text-xs text-muted-foreground">Доступ сохранится до конца периода</div>
                                      </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleSubscriptionAction("revoke_access", sub.id)}
                                      className="gap-2 text-destructive"
                                    >
                                      <XCircle className="w-4 h-4" />
                                      <div>
                                        <div className="font-medium">Заблокировать сейчас</div>
                                        <div className="text-xs text-muted-foreground">Немедленно закрыть доступ</div>
                                      </div>
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">
                                  Для восстановления используйте «Выдать новый доступ»
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>

            {/* Deals Tab */}
            <TabsContent value="deals" className="m-0 space-y-4">
              {dealsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : !deals?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Handshake className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Нет сделок</p>
                </div>
              ) : (
                deals.map(deal => {
                  const isPaid = deal.status === "paid";
                  const payments = (deal as any).payments_v2 as any[] | undefined;
                  const successfulPayment = payments?.find((p: any) => p.status === "succeeded");
                  const receiptUrl = successfulPayment?.provider_response?.transaction?.receipt_url as string | undefined;
                  
                  return (
                    <Card 
                      key={deal.id} 
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => {
                        setSelectedDeal(deal);
                        setDealSheetOpen(true);
                      }}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-medium">{(deal.products_v2 as any)?.name || "Продукт"}</div>
                            {deal.tariffs && (
                              <div className="text-sm text-muted-foreground">{(deal.tariffs as any)?.name}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={getStatusColor(deal.status)}>{getStatusLabel(deal.status)}</Badge>
                            <Eye className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <CalendarIcon className="w-3 h-3" />
                            {format(new Date(deal.created_at), "dd.MM.yy HH:mm")}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium flex items-center gap-1">
                              <CreditCard className="w-3 h-3" />
                              {new Intl.NumberFormat("ru-BY", { style: "currency", currency: deal.currency }).format(Number(deal.final_price))}
                            </span>
                            
                            {receiptUrl && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(receiptUrl, '_blank');
                                }}
                              >
                                <Download className="w-3 h-3" />
                              </Button>
                            )}
                            
                            {isPaid && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs text-purple-600 hover:text-purple-700"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRefundDeal(deal);
                                  setRefundDialogOpen(true);
                                }}
                              >
                                <Undo2 className="w-3 h-3 mr-1" />
                                <span className="hidden sm:inline">Возврат</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </TabsContent>

            {/* Communications Tab */}
            <TabsContent value="communications" className="m-0 space-y-3">
              {commsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : !communications?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Нет событий</p>
                </div>
              ) : (
                communications.map((comm: any) => (
                  <Card key={comm.id}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm">{getActionLabel(comm.action)}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(comm.created_at), "dd.MM.yy HH:mm")}
                        </span>
                      </div>
                      {comm.actor_profile && (
                        <div className="text-xs text-muted-foreground">
                          <span>Выполнил: </span>
                          <button
                            onClick={() => {
                              window.location.href = `/admin/contacts?user=${comm.actor_user_id}`;
                            }}
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            {comm.actor_profile.full_name || comm.actor_profile.email || "Сотрудник"}
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                      {comm.meta && Object.keys(comm.meta).length > 0 && (
                        <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mt-1">
                          {Object.entries(comm.meta).slice(0, 3).map(([key, value]) => (
                            <div key={key} className="truncate">
                              <span className="font-medium">{key}:</span> {String(value)}
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Consent Tab */}
            <TabsContent value="consent" className="m-0 space-y-4">
              {/* Current Status */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Текущий статус</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Privacy Policy */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Политика конфиденциальности</p>
                        {profileConsent?.consent_version ? (
                          <p className="text-xs text-muted-foreground">
                            Версия: {profileConsent.consent_version}
                            {profileConsent.consent_given_at && (
                              <> • {format(new Date(profileConsent.consent_given_at), "dd MMM yyyy, HH:mm:ss", { locale: ru })}</>
                            )}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Согласие не дано</p>
                        )}
                      </div>
                    </div>
                    {profileConsent?.consent_version ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Дано
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 shrink-0">
                        <XCircle className="h-3 w-3 mr-1" />
                        Нет
                      </Badge>
                    )}
                  </div>

                  <Separator />

                  {/* Marketing */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Маркетинговые рассылки</p>
                        <p className="text-xs text-muted-foreground">
                          {profileConsent?.marketing_consent ? "Пользователь разрешил рассылки" : "Рассылки отключены"}
                        </p>
                      </div>
                    </div>
                    {profileConsent?.marketing_consent ? (
                      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Да
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="shrink-0">
                        <XCircle className="h-3 w-3 mr-1" />
                        Нет
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Consent History */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">История изменений</CardTitle>
                </CardHeader>
                <CardContent>
                  {consentLoading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                      ))}
                    </div>
                  ) : !consentHistory || consentHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <ShieldCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>История изменений пуста</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {consentHistory.map((log: any) => (
                        <div key={log.id} className="border rounded-lg p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(log.created_at), "dd MMM yyyy, HH:mm:ss", { locale: ru })}
                              </span>
                            </div>
                            {log.granted ? (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Дано
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 text-xs">
                                <ShieldX className="h-3 w-3 mr-1" />
                                Отозвано
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium">
                            {log.consent_type === "privacy_policy" ? "Политика конфиденциальности" : 
                             log.consent_type === "marketing" ? "Маркетинговые рассылки" : log.consent_type}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Источник: {
                              log.source === "modal" ? "Всплывающее окно" :
                              log.source === "settings" ? "Настройки профиля" :
                              log.source === "registration" ? "При регистрации" :
                              log.source === "signup" ? "При регистрации" : log.source
                            }</span>
                            <span>•</span>
                            <span>Версия: {log.policy_version}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Installments Tab */}
            <TabsContent value="installments" className="m-0">
              <ContactInstallments userId={contact.user_id} />
            </TabsContent>

            {/* Duplicates Tab */}
            {contact.duplicate_flag && (
              <TabsContent value="duplicates" className="m-0 space-y-4">
                {duplicateInfo ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Найденные дубли по телефону {duplicateInfo.phone}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(duplicateInfo.client_duplicates as any[])?.map((dup: any) => (
                        <div key={dup.profile_id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                          <div>
                            <div className="font-medium">{dup.profiles?.full_name || "Без имени"}</div>
                            <div className="text-sm text-muted-foreground">{dup.profiles?.email}</div>
                          </div>
                          {dup.is_master && (
                            <Badge variant="outline">Главный</Badge>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Copy className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Информация о дублях недоступна</p>
                  </div>
                )}
              </TabsContent>
            )}
            </div>
          </div>
        </Tabs>

        {/* Deal Detail Sheet */}
        <DealDetailSheet
          deal={selectedDeal}
          profile={contact}
          open={dealSheetOpen}
          onOpenChange={setDealSheetOpen}
        />

        {/* Refund Dialog */}
        {refundDeal && (
          <RefundDialog
            open={refundDialogOpen}
            onOpenChange={setRefundDialogOpen}
            orderId={refundDeal.id}
            orderNumber={refundDeal.order_number}
            amount={Number(refundDeal.final_price)}
            currency={refundDeal.currency}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["contact-deals", contact.user_id] });
            }}
          />
        )}

        {/* Access History Sheet */}
        <AccessHistorySheet
          open={historySheetOpen}
          onOpenChange={setHistorySheetOpen}
          userId={contact.user_id}
        />

        {/* Edit Contact Dialog */}
        <EditContactDialog
          contact={contact}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-contacts"] })}
        />
      </SheetContent>
    </Sheet>
  );
}
