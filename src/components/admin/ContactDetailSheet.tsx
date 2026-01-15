import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  LogIn,
  Loader2,
  ArrowLeft,
  UserX,
  DollarSign,
  Sparkles,
  Ghost,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ContactInstallments } from "@/components/installments/ContactInstallments";
import { toast } from "sonner";
import { DealDetailSheet } from "./DealDetailSheet";
import { RefundDialog } from "./RefundDialog";
import { AccessHistorySheet } from "./AccessHistorySheet";
import { EditContactDialog } from "./EditContactDialog";
import { ContactTelegramChat } from "./ContactTelegramChat";
import { ContactEmailHistory } from "./ContactEmailHistory";
import { EditSubscriptionDialog } from "./EditSubscriptionDialog";
import { EditDealDialog } from "./EditDealDialog";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { AdminChargeDialog } from "./AdminChargeDialog";
import { AvatarZoomDialog } from "./AvatarZoomDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useAdminUsers } from "@/hooks/useAdminUsers";

// Helper function to format contact name as "Фамилия Имя"
function formatContactName(contact: { 
  first_name?: string | null; 
  last_name?: string | null; 
  full_name?: string | null;
}): string {
  if (contact.last_name && contact.first_name) {
    return `${contact.last_name} ${contact.first_name}`;
  }
  if (contact.last_name) return contact.last_name;
  if (contact.first_name) return contact.first_name;
  if (contact.full_name) return contact.full_name;
  return "Без имени";
}

interface Contact {
  id: string;
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  telegram_username: string | null;
  telegram_user_id: number | null;
  avatar_url: string | null;
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
  returnTo?: string;
}

export function ContactDetailSheet({ contact, open, onOpenChange, returnTo }: ContactDetailSheetProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, isSuperAdmin } = usePermissions();
  const { startImpersonation, resetPassword } = useAdminUsers();
  const [selectedSubscription, setSelectedSubscription] = useState<any>(null);
  const [extendDays, setExtendDays] = useState(30);
  const [isProcessing, setIsProcessing] = useState(false);
  const [grantProductId, setGrantProductId] = useState("");
  const [grantTariffId, setGrantTariffId] = useState("");
  const [grantOfferId, setGrantOfferId] = useState("");
  const [grantDays, setGrantDays] = useState(30);
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
  const [editSubscriptionOpen, setEditSubscriptionOpen] = useState(false);
  const [subscriptionToEdit, setSubscriptionToEdit] = useState<any>(null);
  const [editDealOpen, setEditDealOpen] = useState(false);
  const [dealToEdit, setDealToEdit] = useState<any>(null);
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isFetchingPhoto, setIsFetchingPhoto] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [createDealOnly, setCreateDealOnly] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when tab changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  // Reset tab when sheet opens with new contact
  useEffect(() => {
    if (open) {
      setActiveTab("profile");
    }
  }, [open, contact?.id]);

  // Fetch profile photo from Telegram
  const fetchPhotoFromTelegram = async () => {
    if (!contact?.user_id) return;
    
    setIsFetchingPhoto(true);
    try {
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "fetch_profile_photo", user_id: contact.user_id },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Failed to fetch photo");
      
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
      toast.success("Фото профиля обновлено");
    } catch (error) {
      toast.error("Ошибка: " + (error as Error).message);
    } finally {
      setIsFetchingPhoto(false);
    }
  };

  // Sync days input with date range
  const handleDaysChange = (days: number) => {
    setGrantDays(days);
    setGrantDateRange({
      from: new Date(),
      to: addDays(new Date(), days - 1),
    });
  };

  // Sync date range with days
  const handleDateRangeChange = (range: DateRange | undefined) => {
    setGrantDateRange(range);
    if (range?.from && range?.to) {
      setGrantDays(differenceInDays(range.to, range.from) + 1);
    }
  };

  // Fetch full profile data for Telegram info
  const { data: profileData } = useQuery({
    queryKey: ["contact-profile-details", contact?.id],
    queryFn: async () => {
      if (!contact?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("telegram_linked_at, telegram_link_status")
        .eq("id", contact.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id,
  });

  // Fetch Telegram user info (bio, etc.) from Telegram API
  const { data: telegramUserInfo } = useQuery({
    queryKey: ["contact-telegram-info", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id || !contact?.telegram_user_id) return null;
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "get_user_info", user_id: contact.user_id },
      });
      if (error) throw error;
      if (!data.success) return null;
      return data.user_info;
    },
    enabled: !!contact?.user_id && !!contact?.telegram_user_id,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Fetch deals for this contact - check both profile_id and user_id (for ghost contacts)
  const { data: deals, isLoading: dealsLoading } = useQuery({
    queryKey: ["contact-deals", contact?.id, contact?.user_id],
    queryFn: async () => {
      if (!contact?.id) return [];
      
      // Build array of IDs to search (profile.id and optionally user_id)
      const userIds = [contact.id];
      if (contact.user_id && contact.user_id !== contact.id) {
        userIds.push(contact.user_id);
      }
      
      // Query deals by profile_id OR user_id to catch ghost contact deals
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code),
          tariffs(id, name, code),
          payments_v2(id, status, provider_response)
        `)
        .or(`profile_id.eq.${contact.id},user_id.in.(${userIds.join(',')})`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id,
  });

  // Fetch subscriptions for this contact - check both profile.id and user_id
  const { data: subscriptions, isLoading: subsLoading, refetch: refetchSubs } = useQuery({
    queryKey: ["contact-subscriptions", contact?.id, contact?.user_id],
    queryFn: async () => {
      if (!contact?.id) return [];
      
      // Build array of IDs to search
      const userIds = [contact.id];
      if (contact.user_id && contact.user_id !== contact.id) {
        userIds.push(contact.user_id);
      }
      
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          *,
          products_v2(id, name, code, telegram_club_id),
          tariffs(id, name, code, getcourse_offer_code, getcourse_offer_id)
        `)
        .in("user_id", userIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id,
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

  // Fetch offers for selected tariff (including inactive for history)
  const { data: grantOffers } = useQuery({
    queryKey: ["offers-for-grant", grantTariffId],
    queryFn: async () => {
      if (!grantTariffId) return [];
      const { data, error } = await supabase
        .from("tariff_offers")
        .select("id, offer_type, button_label, amount, is_active")
        .eq("tariff_id", grantTariffId)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
    enabled: !!grantTariffId,
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

  // Fetch payment methods
  const { data: paymentMethods, isLoading: cardsLoading } = useQuery({
    queryKey: ["contact-payment-methods", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return [];
      const { data, error } = await supabase
        .from("payment_methods")
        .select("id, brand, last4, exp_month, exp_year, is_default, status")
        .eq("user_id", contact.user_id)
        .eq("status", "active")
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // Fetch trial history for this contact
  const { data: trialHistory } = useQuery({
    queryKey: ["contact-trial-history", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return null;
      
      // Build array of IDs to search
      const userIds = [contact.id];
      if (contact.user_id && contact.user_id !== contact.id) {
        userIds.push(contact.user_id);
      }
      
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          id, is_trial, status, trial_end_at, created_at,
          products_v2:product_id(id, name, code)
        `)
        .in("user_id", userIds)
        .eq("is_trial", true)
        .order("created_at", { ascending: false });
      if (error) return null;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // Fetch reentry (former club member) status
  const { data: reentryStatus, refetch: refetchReentry } = useQuery({
    queryKey: ["contact-reentry-status", contact?.user_id],
    queryFn: async (): Promise<{
      was_club_member: boolean | null;
      club_exit_at: string | null;
      club_exit_reason: string | null;
      reentry_penalty_waived: boolean | null;
      reentry_penalty_waived_by: string | null;
      reentry_penalty_waived_at: string | null;
    } | null> => {
      if (!contact?.user_id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("was_club_member, club_exit_at, club_exit_reason, reentry_penalty_waived, reentry_penalty_waived_by, reentry_penalty_waived_at")
        .eq("user_id", contact.user_id)
        .single();
      if (error) return null;
      return data as any;
    },
    enabled: !!contact?.user_id,
  });

  // Update reentry penalty status
  const updateReentryMutation = useMutation({
    mutationFn: async ({ action }: { action: 'waive' | 'restore' | 'reset' | 'mark_as_former' }) => {
      if (!contact?.user_id) throw new Error("No user ID");
      const currentUser = (await supabase.auth.getUser()).data.user;
      
      let updates: Record<string, any> = {};
      
      if (action === 'waive') {
        updates = {
          reentry_penalty_waived: true,
          reentry_penalty_waived_by: currentUser?.id,
          reentry_penalty_waived_at: new Date().toISOString(),
        };
      } else if (action === 'restore') {
        updates = {
          reentry_penalty_waived: false,
          reentry_penalty_waived_by: null,
          reentry_penalty_waived_at: null,
        };
      } else if (action === 'reset') {
        updates = {
          was_club_member: false,
          club_exit_at: null,
          club_exit_reason: null,
          reentry_penalty_waived: false,
          reentry_penalty_waived_by: null,
          reentry_penalty_waived_at: null,
        };
      } else if (action === 'mark_as_former') {
        updates = {
          was_club_member: true,
          club_exit_at: new Date().toISOString(),
          club_exit_reason: 'manual_admin',
        };
      }
      
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("user_id", contact.user_id);
      
      if (error) throw error;
      
      // Log audit
      await supabase.from("audit_logs").insert({
        actor_user_id: currentUser?.id,
        action: `reentry_penalty.${action}`,
        target_user_id: contact.user_id,
        meta: { action },
      });
      
      return action;
    },
    onSuccess: (action) => {
      const messages: Record<string, string> = {
        waive: "Повышенные тарифы отменены",
        restore: "Повышенные тарифы восстановлены",
        reset: "Статус бывшего участника сброшен",
        mark_as_former: "Контакт отмечен как бывший участник клуба",
      };
      toast.success(messages[action]);
      // Force refetch with invalidation
      queryClient.invalidateQueries({ queryKey: ["contact-reentry-status", contact?.user_id] });
      queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
    },
    onError: (error) => {
      toast.error("Ошибка: " + (error as Error).message);
    },
  });

  // Handle impersonation
  const handleImpersonate = async () => {
    if (!contact?.user_id) return;
    setIsImpersonating(true);
    try {
      // Store current session before impersonating
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Use consistent keys with ImpersonationBar and add timestamp for session expiry
        localStorage.setItem("admin_session_backup", JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        }));
        localStorage.setItem("admin_return_url", window.location.pathname);
        localStorage.setItem("impersonation_start_time", Date.now().toString());
      }

      const result = await startImpersonation(contact.user_id);
      if (result) {
        // Use verifyOtp with token_hash only (email must not be provided with token_hash)
        const { error } = await supabase.auth.verifyOtp({
          token_hash: result.tokenHash,
          type: "magiclink",
        });
        
        if (error) {
          console.error("verifyOtp error:", error);
          throw error;
        }
        
        toast.success(`Вход от имени ${formatContactName(contact) || contact.email}`);
        onOpenChange(false);
        window.location.href = "/?impersonating=true";
      }
    } catch (error) {
      console.error("Impersonation error:", error);
      toast.error("Ошибка входа от имени пользователя");
    } finally {
      setIsImpersonating(false);
    }
  };
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
    const isGhostContact = !contact?.user_id;
    
    // For ghost contacts, require "deal only" mode
    if (isGhostContact && !createDealOnly) {
      toast.error("Для Ghost-контакта включите режим 'Только сделка (без доступа)'");
      return;
    }
    
    if (!grantProductId || !grantTariffId) {
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
      // For ghost contacts, use profile.id as user_id, for regular - use user_id
      const orderUserId = isGhostContact ? contact.id : contact.user_id;
      const orderNumber = `GIFT-${now.getFullYear().toString().slice(-2)}-${Date.now().toString(36).toUpperCase()}`;
      const { data: orderV2, error: orderError } = await supabase.from("orders_v2").insert({
        order_number: orderNumber,
        user_id: orderUserId,
        profile_id: contact.id,
        product_id: grantProductId,
        tariff_id: grantTariffId,
        customer_email: contact.email,
        base_price: 0,
        final_price: 0,
        paid_amount: 0,
        currency: "BYN",
        status: "paid",
        is_trial: false,
        created_at: accessStart.toISOString(), // Use access start date as deal date
        meta: { 
          source: createDealOnly ? "admin_deal_only" : "admin_grant", 
          granted_by: currentUser?.id,
          granted_by_email: currentUser?.email,
          comment: grantComment || null,
          access_start: accessStart.toISOString(),
          access_end: accessEnd.toISOString(),
          offer_id: grantOfferId && grantOfferId !== "__none__" ? grantOfferId : undefined,
          is_ghost: isGhostContact,
          deal_only: createDealOnly,
        },
      }).select().single();

      if (orderError) throw orderError;

      // 2. Create payment_v2 as gift/admin (for history and reports)
      await supabase.from("payments_v2").insert({
        order_id: orderV2.id,
        user_id: orderUserId,
        amount: 0,
        currency: "BYN",
        status: "succeeded",
        provider: "admin",
        paid_at: accessStart.toISOString(), // Use access start date as payment date
        created_at: accessStart.toISOString(), // Use access start date as deal date
        meta: { source: createDealOnly ? "admin_deal_only" : "admin_grant", granted_by: currentUser?.id },
      });

      // Skip subscription, entitlements, and integrations for "deal only" mode
      let subscriptionId: string | null = null;
      const syncResults: Record<string, { success: boolean; error?: string }> = {};

      if (!createDealOnly && !isGhostContact) {
        // 3. Check for existing active subscription and extend or create new
        const { data: existingSub } = await supabase
          .from("subscriptions_v2")
          .select("id, access_end_at")
          .eq("user_id", contact.user_id!)
          .eq("product_id", grantProductId)
          .eq("tariff_id", grantTariffId)
          .in("status", ["active", "trial"])
          .is("canceled_at", null)
          .gte("access_end_at", now.toISOString())
          .order("access_end_at", { ascending: false })
          .limit(1)
          .maybeSingle();

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
            user_id: contact.user_id!,
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

        // 4. Create telegram_access_grants and grant access if product has club
        if (product?.telegram_club_id) {
          try {
            // Create access grant record
            await supabase.from("telegram_access_grants").insert({
              user_id: contact.user_id!,
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
        if (subscriptionId && Object.keys(syncResults).length > 0) {
          await supabase.from("subscriptions_v2").update({
            meta: { sync_results: syncResults, synced_at: now.toISOString() },
          }).eq("id", subscriptionId);
        }
      }

      // 6. Log action with full details
      const dateStr = `${format(accessStart, "dd.MM.yy")} — ${format(accessEnd, "dd.MM.yy")}`;
      await supabase.from("audit_logs").insert({
        actor_user_id: currentUser?.id,
        action: createDealOnly ? "admin.create_deal_only" : "admin.grant_access",
        target_user_id: isGhostContact ? null : contact.user_id,
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
          profile_id: contact.id,
          is_ghost: isGhostContact,
          deal_only: createDealOnly,
          getcourse_offer_code: tariff?.getcourse_offer_code,
          telegram_club_id: product?.telegram_club_id,
          sync_results: syncResults,
        },
      });

      // 7. Notify super admins via Telegram about the new order
      try {
        const giftMessage = createDealOnly 
          ? `📝 Создана сделка (без доступа)\n\n` +
            `👤 <b>Клиент:</b> ${formatContactName(contact)}${isGhostContact ? ' 👻' : ''}\n` +
            `📧 Email: ${contact.email || 'Не указан'}\n` +
            `📱 Телефон: ${contact.phone || 'Не указан'}\n` +
            (contact.telegram_username ? `💬 Telegram: @${contact.telegram_username}\n` : '') +
            `\n📦 <b>Продукт:</b> ${product?.name || 'Не указан'}\n` +
            `📋 Тариф: ${tariff?.name || 'Не указан'}\n` +
            `📅 Период: ${dateStr}\n` +
            `🆔 Заказ: ${orderNumber}\n` +
            `👨‍💼 Создал: ${currentUser?.email || 'Неизвестно'}`
          : `🎁 Выдан доступ\n\n` +
            `👤 <b>Клиент:</b> ${formatContactName(contact)}\n` +
            `📧 Email: ${contact.email || 'Не указан'}\n` +
            `📱 Телефон: ${contact.phone || 'Не указан'}\n` +
            (contact.telegram_username ? `💬 Telegram: @${contact.telegram_username}\n` : '') +
            `\n📦 <b>Продукт:</b> ${product?.name || 'Не указан'}\n` +
            `📋 Тариф: ${tariff?.name || 'Не указан'}\n` +
            `📅 Период: ${dateStr}\n` +
            `🆔 Заказ: ${orderNumber}\n` +
            `👨‍💼 Выдал: ${currentUser?.email || 'Неизвестно'}`;

        supabase.functions.invoke("telegram-notify-admins", {
          body: { message: giftMessage },
        }).catch((err) => console.error("Failed to notify admins:", err));
      } catch (notifyErr) {
        console.error("Error preparing admin notification:", notifyErr);
      }

      toast.success(createDealOnly 
        ? `Сделка создана (${dateStr})` 
        : subscriptionId 
          ? `Доступ выдан (${dateStr})` 
          : `Доступ продлён (${dateStr})`
      );
      queryClient.invalidateQueries({ queryKey: ["contact-deals", contact.id] });
      refetchSubs();
      setGrantProductId("");
      setGrantTariffId("");
      setGrantOfferId("");
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
              <AvatarZoomDialog
                avatarUrl={contact.avatar_url}
                fallbackText={formatContactName(contact)?.[0]?.toUpperCase() || contact.email?.[0]?.toUpperCase() || "?"}
                name={formatContactName(contact)}
                onFetchFromTelegram={contact.telegram_user_id ? fetchPhotoFromTelegram : undefined}
                isFetchingPhoto={isFetchingPhoto}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-lg sm:text-xl truncate">{formatContactName(contact)}</SheetTitle>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">{contact.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 mt-1">
              {!contact.user_id && (
                <Badge variant="outline" className="text-xs gap-1">
                  <Ghost className="w-3 h-3" />
                  Ghost
                </Badge>
              )}
              <Badge 
                variant={!contact.user_id ? "secondary" : contact.status === "active" ? "default" : "secondary"} 
                className="text-xs"
              >
                {!contact.user_id ? (
                  <><Ban className="w-3 h-3 mr-1" />Заблокирован</>
                ) : contact.status === "active" ? (
                  <><CheckCircle className="w-3 h-3 mr-1" />Активен</>
                ) : contact.status === "blocked" ? (
                  <><Ban className="w-3 h-3 mr-1" />Заблокирован</>
                ) : (
                  <><XCircle className="w-3 h-3 mr-1" />{contact.status}</>
                )}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2">
            {returnTo && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/admin/${returnTo}`);
                }}
              >
                <ArrowLeft className="w-3 h-3 mr-1" />
                {returnTo === "deals" ? "К сделкам" : "Назад"}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="w-3 h-3 mr-1" />
              Редактировать
            </Button>
          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
                Сделки {deals && deals.filter(d => d.status === "paid").length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{deals.filter(d => d.status === "paid").length}</Badge>}
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

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
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
                  
                  {/* Send email button */}
                  {contact.email && (
                    <>
                      <Separator />
                      <div className="pt-2">
                        <Button
                          variant="outline"
                          className="w-full gap-2"
                          onClick={() => setComposeEmailOpen(true)}
                        >
                          <Mail className="w-4 h-4" />
                          Написать письмо
                        </Button>
                      </div>
                    </>
                  )}
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
                    <span className="text-sm">
                      {contact.created_at 
                        ? format(new Date(contact.created_at), "dd MMM yyyy HH:mm", { locale: ru })
                        : "—"}
                    </span>
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

              {/* Telegram Info Card */}
              {contact.telegram_user_id && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <MessageCircle className="w-4 h-4 text-blue-500" />
                      Telegram
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">ID пользователя</span>
                      <span className="text-sm font-mono">{contact.telegram_user_id}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Username</span>
                      {contact.telegram_username ? (
                        <a 
                          href={`https://t.me/${contact.telegram_username}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-blue-500 hover:underline flex items-center gap-1"
                        >
                          @{contact.telegram_username}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                    {profileData?.telegram_linked_at && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Привязан</span>
                          <span className="text-sm">
                            {format(new Date(profileData.telegram_linked_at), "dd MMM yyyy HH:mm", { locale: ru })}
                          </span>
                        </div>
                      </>
                    )}
                    {!contact.avatar_url && (
                      <>
                        <Separator />
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={fetchPhotoFromTelegram}
                          disabled={isFetchingPhoto}
                        >
                          {isFetchingPhoto ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <User className="w-4 h-4" />
                          )}
                          Загрузить фото из Telegram
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}

              {contact.user_id && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <CreditCard className="w-4 h-4" />
                      Привязанные карты
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {cardsLoading ? (
                      <Skeleton className="h-12 w-full" />
                    ) : paymentMethods && paymentMethods.length > 0 ? (
                      <>
                        {paymentMethods.map((method) => (
                          <div key={method.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                            <div className="flex items-center gap-3">
                              <CreditCard className="w-4 h-4 text-muted-foreground" />
                              <div>
                                <span className="font-medium">{method.brand?.toUpperCase() || "Карта"} •••• {method.last4}</span>
                                {method.exp_month && method.exp_year && (
                                  <p className="text-xs text-muted-foreground">
                                    До {String(method.exp_month).padStart(2, "0")}/{String(method.exp_year).slice(-2)}
                                  </p>
                                )}
                              </div>
                            </div>
                            {method.is_default && (
                              <Badge variant="secondary" className="text-xs">Основная</Badge>
                            )}
                          </div>
                        ))}
                        {/* Charge button for super admin */}
                        {isSuperAdmin() && (
                          <Button
                            variant="outline"
                            className="w-full gap-2 mt-2"
                            onClick={() => setChargeDialogOpen(true)}
                          >
                            <CreditCard className="w-4 h-4" />
                            Списать деньги
                          </Button>
                        )}
                      </>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">
                        <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Нет привязанных карт</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Club Member Status Card - show for all contacts with user_id */}
              {contact.user_id && (
                <Card className={reentryStatus?.was_club_member ? "border-amber-200 dark:border-amber-800" : ""}>
                  <CardHeader className="pb-2">
                    <CardTitle className={`text-sm flex items-center gap-2 ${reentryStatus?.was_club_member ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                      <UserX className="w-4 h-4" />
                      {reentryStatus?.was_club_member ? "Бывший участник клуба" : "Статус участия в клубе"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Trial Status Section */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3" />
                        Пробный период
                      </h4>
                      {trialHistory && trialHistory.length > 0 ? (
                        <div className="space-y-2">
                          {trialHistory.map((trial: any) => {
                            const isActive = trial.status === 'active' && trial.trial_end_at && new Date(trial.trial_end_at) > new Date();
                            const productName = trial.products_v2?.name || 'Неизвестный продукт';
                            
                            return (
                              <div 
                                key={trial.id} 
                                className={cn(
                                  "p-2 rounded-lg text-sm",
                                  isActive 
                                    ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" 
                                    : "bg-muted/50"
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {isActive ? (
                                      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 shrink-0">
                                        <Sparkles className="w-3 h-3 mr-1" />
                                        На триале
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 shrink-0">
                                        <CheckCircle className="w-3 h-3 mr-1" />
                                        Использован
                                      </Badge>
                                    )}
                                    <span className="truncate text-muted-foreground">{productName}</span>
                                  </div>
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {isActive && trial.trial_end_at 
                                      ? `до ${format(new Date(trial.trial_end_at), "dd.MM.yyyy", { locale: ru })}`
                                      : format(new Date(trial.created_at), "dd.MM.yyyy", { locale: ru })
                                    }
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">Триал не использовался</p>
                      )}
                    </div>

                    <Separator />

                    {/* Former Member Status Section */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Членство в клубе
                      </h4>
                      {!reentryStatus?.was_club_member ? (
                        <div className="text-center py-2">
                          <p className="text-sm text-muted-foreground mb-3">Не отмечен как бывший участник</p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full gap-2"
                            onClick={() => updateReentryMutation.mutate({ action: 'mark_as_former' })}
                            disabled={updateReentryMutation.isPending}
                          >
                            {updateReentryMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <UserX className="w-4 h-4" />
                            )}
                            Пометить как бывшего участника
                          </Button>
                        </div>
                      ) : (
                        <>
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 space-y-2">
                      {reentryStatus.club_exit_at && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Дата выхода</span>
                          <span>{format(new Date(reentryStatus.club_exit_at), "dd MMM yyyy HH:mm", { locale: ru })}</span>
                        </div>
                      )}
                      {reentryStatus.club_exit_reason && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Причина</span>
                          <span className="capitalize">{reentryStatus.club_exit_reason}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Повышенные тарифы</span>
                        {reentryStatus.reentry_penalty_waived ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Отменены
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            <DollarSign className="w-3 h-3 mr-1" />
                            Активны
                          </Badge>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      {!reentryStatus.reentry_penalty_waived ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={() => updateReentryMutation.mutate({ action: 'waive' })}
                          disabled={updateReentryMutation.isPending}
                        >
                          {updateReentryMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CheckCircle className="w-4 h-4" />
                          )}
                          Отменить повышенные тарифы
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full gap-2"
                          onClick={() => updateReentryMutation.mutate({ action: 'restore' })}
                          disabled={updateReentryMutation.isPending}
                        >
                          {updateReentryMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <RotateCcw className="w-4 h-4" />
                          )}
                          Восстановить повышенные тарифы
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full gap-2 text-muted-foreground"
                        onClick={() => updateReentryMutation.mutate({ action: 'reset' })}
                        disabled={updateReentryMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                        Сбросить статус бывшего участника
                      </Button>
                    </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Admin Actions Card */}
              {contact.user_id && (hasPermission("users.impersonate") || hasPermission("users.reset_password")) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      Действия администратора
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {hasPermission("users.impersonate") && (
                      <Button
                        variant="outline"
                        className="w-full gap-2"
                        onClick={handleImpersonate}
                        disabled={isImpersonating}
                      >
                        {isImpersonating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <LogIn className="w-4 h-4" />
                        )}
                        Войти от имени клиента
                      </Button>
                    )}
                    {hasPermission("users.reset_password") && contact.email && (
                      <Button
                        variant="outline"
                        className="w-full gap-2"
                        onClick={async () => {
                          setIsResettingPassword(true);
                          try {
                            await resetPassword(contact.email!, contact.user_id!);
                          } finally {
                            setIsResettingPassword(false);
                          }
                        }}
                        disabled={isResettingPassword}
                      >
                        {isResettingPassword ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Key className="w-4 h-4" />
                        )}
                        Сбросить пароль
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Telegram Chat Tab */}
            <TabsContent value="telegram" className="m-0 space-y-4">
              {/* Telegram Profile Info Card */}
              {contact.telegram_user_id ? (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">ID:</span>
                          <span className="font-mono">{contact.telegram_user_id}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              navigator.clipboard.writeText(String(contact.telegram_user_id));
                              toast.success("ID скопирован");
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        {contact.telegram_username && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Username:</span>
                            <a
                              href={`https://t.me/${contact.telegram_username}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              @{contact.telegram_username}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        )}
                        {profileData?.telegram_linked_at && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Привязан:</span>
                            <span>{format(new Date(profileData.telegram_linked_at), "dd.MM.yyyy HH:mm", { locale: ru })}</span>
                          </div>
                        )}
                        {profileData?.telegram_link_status && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Статус:</span>
                            <Badge variant={profileData.telegram_link_status === "active" ? "default" : "secondary"}>
                              {profileData.telegram_link_status === "active" ? "Активен" : profileData.telegram_link_status}
                            </Badge>
                          </div>
                        )}
                        {telegramUserInfo && (
                          <>
                            {telegramUserInfo.first_name && (
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">Имя в TG:</span>
                                <span>{[telegramUserInfo.first_name, telegramUserInfo.last_name].filter(Boolean).join(" ")}</span>
                              </div>
                            )}
                            {telegramUserInfo.bio && (
                              <div className="text-sm">
                                <span className="text-muted-foreground">Bio:</span>
                                <p className="text-xs mt-1 italic text-muted-foreground">{telegramUserInfo.bio}</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={fetchPhotoFromTelegram}
                        disabled={isFetchingPhoto}
                        className="gap-1"
                      >
                        {isFetchingPhoto ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        Загрузить фото
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="p-4 text-center text-muted-foreground">
                    <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Telegram не привязан</p>
                  </CardContent>
                </Card>
              )}
              
              {/* Chat - flex-1 to fill remaining space */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <ContactTelegramChat
                  userId={contact.user_id || ""}
                  telegramUserId={contact.telegram_user_id}
                  telegramUsername={contact.telegram_username}
                  clientName={contact.full_name}
                />
              </div>
            </TabsContent>

            {/* Email History Tab */}
            <TabsContent value="email" className="m-0 space-y-4">
              <ContactEmailHistory
                userId={contact.user_id}
                email={contact.email}
                clientName={contact.full_name}
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
                      <Select value={grantTariffId} onValueChange={(v) => { setGrantTariffId(v); setGrantOfferId(""); }} disabled={!grantProductId}>
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
                  
                  {/* Offer selection */}
                  {grantTariffId && grantOffers && grantOffers.length > 0 && (
                    <div>
                      <Label className="text-xs">Оффер (кнопка оплаты)</Label>
                      <Select value={grantOfferId} onValueChange={setGrantOfferId}>
                        <SelectTrigger className="h-10 sm:h-9 text-sm">
                          <SelectValue placeholder="Выбрать оффер (опционально)..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Без оффера</SelectItem>
                          {grantOffers.map(offer => (
                            <SelectItem key={offer.id} value={offer.id}>
                              {offer.offer_type === "trial" ? "🎁 " : "💳 "}
                              {offer.button_label} ({offer.amount} BYN)
                              {!offer.is_active && " (неактивен)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Определяет getcourse_offer_id для интеграции
                      </p>
                    </div>
                  )}
                  {/* Days input + Date range picker */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Дней (от сегодня)</Label>
                      <Input
                        type="number"
                        value={grantDays}
                        onChange={(e) => handleDaysChange(parseInt(e.target.value) || 30)}
                        min={1}
                        className="h-10 sm:h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Или период</Label>
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
                            {grantDateRange?.from && grantDateRange.to ? (
                              <span className="truncate">
                                {format(grantDateRange.from, "dd.MM")} — {format(grantDateRange.to, "dd.MM")}
                              </span>
                            ) : (
                              <span>📅</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            initialFocus
                            mode="range"
                            defaultMonth={grantDateRange?.from}
                            selected={grantDateRange}
                            onSelect={handleDateRangeChange}
                            numberOfMonths={1}
                            locale={ru}
                            className={cn("p-3 pointer-events-auto")}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
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

                  {/* Deal only option for ghost contacts */}
                  {!contact.user_id && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                      <Checkbox 
                        id="dealOnly" 
                        checked={createDealOnly} 
                        onCheckedChange={(checked) => setCreateDealOnly(checked === true)}
                        className="mt-0.5"
                      />
                      <div className="space-y-1">
                        <Label htmlFor="dealOnly" className="text-sm cursor-pointer font-medium">
                          Только сделка (без доступа)
                        </Label>
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Для Ghost-контактов выдача доступа невозможна. Будет создана только сделка для учёта.
                        </p>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleGrantNewAccess}
                    disabled={isProcessing || !grantProductId || !grantTariffId || !grantDateRange?.from || !grantDateRange?.to || (!contact.user_id && !createDealOnly)}
                    className="gap-1 h-10 sm:h-9 w-full"
                  >
                    <Plus className="w-4 h-4" />
                    {createDealOnly ? "Создать сделку" : "Выдать доступ"}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                setSubscriptionToEdit(sub);
                                setEditSubscriptionOpen(true);
                              }}
                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
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
                        
                        {/* Auto-renewal status */}
                        {isActive && !isCanceled && (
                          <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-muted/50 text-xs">
                            {sub.payment_token && paymentMethods && paymentMethods.length > 0 ? (
                              <>
                                <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                                <span className="text-green-700">Автопродление включено</span>
                                {sub.charge_attempts > 0 && (
                                  <Badge variant="outline" className="text-amber-600 border-amber-200 text-xs ml-auto">
                                    Попыток: {sub.charge_attempts}/3
                                  </Badge>
                                )}
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-muted-foreground">
                                  {!paymentMethods || paymentMethods.length === 0 
                                    ? "Нет привязанной карты" 
                                    : "Автопродление отключено"}
                                </span>
                              </>
                            )}
                          </div>
                        )}

                        {/* Quick actions - mobile friendly - only show for active subscriptions */}
                        {isActive && (
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
                                
                                {isCanceled ? (
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
                                ) : (
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
                                )}
                              </>
                            )}
                          </div>
                        )}
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
                  // Fix: Check receipt_url column first, then nested provider_response
                  const receiptUrl = (successfulPayment as any)?.receipt_url 
                    || successfulPayment?.provider_response?.transaction?.receipt_url as string | undefined;
                  
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
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDealToEdit(deal);
                                setEditDealOpen(true);
                              }}
                              className="h-6 w-6 text-muted-foreground hover:text-primary"
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
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

        {/* Edit Subscription Dialog */}
        <EditSubscriptionDialog
          subscription={subscriptionToEdit}
          open={editSubscriptionOpen}
          onOpenChange={setEditSubscriptionOpen}
          onSuccess={() => refetchSubs()}
        />

        {/* Edit Deal Dialog */}
        <EditDealDialog
          deal={dealToEdit}
          open={editDealOpen}
          onOpenChange={setEditDealOpen}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["contact-deals", contact.user_id] })}
        />

        {/* Compose Email Dialog */}
        <ComposeEmailDialog
          recipientEmail={contact.email}
          recipientName={contact.full_name}
          open={composeEmailOpen}
          onOpenChange={setComposeEmailOpen}
        />

        {/* Admin Charge Dialog */}
        {contact.user_id && (
          <AdminChargeDialog
            open={chargeDialogOpen}
            onOpenChange={setChargeDialogOpen}
            userId={contact.user_id}
            userName={contact.full_name || undefined}
            userEmail={contact.email || undefined}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
