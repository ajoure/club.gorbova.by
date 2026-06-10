import { useState, useRef, useEffect, useMemo } from "react";
import { getSubscriptionChargeCount } from "@/utils/subscriptionChargeCount";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { useModuleDisplayMeta } from "@/hooks/useModuleDisplayMeta";
import { ProductCategoryBadge } from "@/components/ui/ProductCategoryBadge";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { SHEET_SHELL_CLASS } from "@/lib/sheetShell";
import { useNavigate } from "react-router-dom";
import { format, addDays, differenceInDays } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { getEventLabel } from "@/lib/eventLabels";
import { formatContactName } from "@/lib/nameUtils";
import { useActiveAccessRuleProducts, isCurrentValidAccess, isHistoricalAccess } from "@/hooks/useAccessValidation";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  
  RefreshCw,
  Link2,
} from "lucide-react";
import { copyToClipboard, getContactUrl } from "@/utils/clipboardUtils";
import { formatPaymentTimeIANA } from "@/lib/formatPaymentTime";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { ContactInstallments } from "@/components/installments/ContactInstallments";
import { toast } from "sonner";
import { DealDetailSheet } from "./DealDetailSheet";
import { getEffectiveDealDate } from "@/utils/getEffectiveDealDate";
import { RefundDialog } from "./RefundDialog";
import { AccessHistorySheet } from "./AccessHistorySheet";
import { EditContactDialog } from "./EditContactDialog";
import { ContactTelegramChat } from "./ContactTelegramChat";
import { ContactClubMembershipsList } from "./ContactClubMembershipsList";
import { ContactEmailHistory } from "./ContactEmailHistory";
import { EditSubscriptionDialog } from "./EditSubscriptionDialog";
import { EditDealDialog } from "./EditDealDialog";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { AdminChargeDialog } from "./AdminChargeDialog";
import { AdminPaymentLinkDialog } from "./AdminPaymentLinkDialog";
import { AvatarZoomDialog } from "./AvatarZoomDialog";
import { LoyaltyPulse } from "./LoyaltyPulse";
import { ContactLoyaltyTab } from "./ContactLoyaltyTab";
import { ContactArtifactsTab } from "./contact/ContactArtifactsTab";
import { ContactDealsTab } from "./contact/ContactDealsTab";
import { ContactPaymentsTab } from "./ContactPaymentsTab";

import { usePermissions } from "@/hooks/usePermissions";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { WebinarActivitySection } from "./contact/WebinarActivitySection";
import { isStaffRole } from "@/lib/liveRoomRoles";
import { useAuth } from "@/contexts/AuthContext";

// formatContactName imported from @/lib/nameUtils

interface CommunicationStyle {
  tone: string;
  keywords_to_use: string[];
  topics_to_avoid: string[];
  recommendations: string;
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
  loyalty_score?: number | null;
  loyalty_ai_summary?: string | null;
  loyalty_status_reason?: string | null;
  loyalty_proofs?: unknown[] | null;
  loyalty_analyzed_messages_count?: number | null;
  loyalty_updated_at?: string | null;
  communication_style?: CommunicationStyle | null;
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
  const { hasPermission, isSuperAdmin, isAdmin } = usePermissions();
  const { role: authRole } = useAuth();
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
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const dealSheetOpen = !!selectedDealId;
  const [refundDealId, setRefundDealId] = useState<string | null>(null);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSubscriptionOpen, setEditSubscriptionOpen] = useState(false);
  const [subscriptionToEdit, setSubscriptionToEdit] = useState<any>(null);
  const [dealToEditId, setDealToEditId] = useState<string | null>(null);
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [paymentLinkDialogOpen, setPaymentLinkDialogOpen] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  // TG info card свёрнут по умолчанию — чтобы не отъедал высоту у ленты сообщений.
  const [tgInfoExpanded, setTgInfoExpanded] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [isFetchingPhoto, setIsFetchingPhoto] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [showFinishedSubs, setShowFinishedSubs] = useState(false);
  const [createDealOnly, setCreateDealOnly] = useState(false);
  const [autoRenewConfirmOpen, setAutoRenewConfirmOpen] = useState(false);
  const [autoRenewTarget, setAutoRenewTarget] = useState<{
    subscriptionId: string;
    currentValue: boolean;
    productName: string;
    hasPaymentMethod: boolean;
  } | null>(null);
  // PATCH-B: State for bePaid link modal
  const [bepaidLinkModalOpen, setBepaidLinkModalOpen] = useState(false);
  const [bepaidLinkUrl, setBepaidLinkUrl] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [isBanning, setIsBanning] = useState(false);

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

  // Realtime subscriptions for orders_v2, subscriptions_v2, payments_v2
  useEffect(() => {
    if (!open || !resolvedUserId) return;

    const userId = resolvedUserId;
    const profileId = contact?.id;
    if (!profileId) return;
    
    // Build user IDs array for filtering
    const userIds = [profileId];
    if (userId !== profileId) {
      userIds.push(userId);
    }

    const channel = supabase
      .channel(`contact-${profileId}-realtime`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders_v2" },
        (payload) => {
          // Check if this change is for our contact
          const record = (payload.new || payload.old) as { user_id?: string; profile_id?: string };
          if (record?.user_id === userId || record?.profile_id === profileId || userIds.includes(record?.user_id || "")) {
            console.log("[Realtime] orders_v2 change for contact", profileId);
            queryClient.invalidateQueries({ queryKey: ["contact-deals", contact?.id, resolvedUserId] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions_v2" },
        (payload) => {
          const record = (payload.new || payload.old) as { user_id?: string };
          if (record?.user_id === userId || userIds.includes(record?.user_id || "")) {
            console.log("[Realtime] subscriptions_v2 change for contact", profileId);
            queryClient.invalidateQueries({ queryKey: ["contact-subscriptions", contact?.id, resolvedUserId] });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments_v2" },
        (payload) => {
          const record = (payload.new || payload.old) as { user_id?: string };
          if (record?.user_id === userId || userIds.includes(record?.user_id || "")) {
            console.log("[Realtime] payments_v2 change for contact", profileId);
            queryClient.invalidateQueries({ queryKey: ["contact-payments", contact.id] });
          }
        }
      )
      .subscribe((status) => {
        console.log("[Realtime] Channel subscription status:", status);
      });

    return () => {
      console.log("[Realtime] Removing channel for contact", profileId);
      supabase.removeChannel(channel);
    };
  }, [open, contact?.id, contact?.user_id, queryClient]);

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

  // Fetch full profile data for Telegram info + loyalty score
  const { data: profileData } = useQuery({
    queryKey: ["contact-profile-details", contact?.id],
    queryFn: async () => {
      if (!contact?.id) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, status, telegram_user_id, telegram_username, telegram_linked_at, telegram_link_status, loyalty_score, loyalty_updated_at, loyalty_auto_update, country, city, birth_date, instagram_url, gc_registered_at")
        .eq("id", contact.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id,
  });

  // Reliable contact fields: prefer DB data (profileData) over potentially stale props
  const resolvedUserId = profileData?.user_id ?? contact?.user_id ?? null;
  const resolvedStatus = profileData?.status ?? contact?.status ?? "active";
  const resolvedTelegramUserId = profileData?.telegram_user_id ?? contact?.telegram_user_id ?? null;
  const resolvedTelegramUsername = profileData?.telegram_username ?? contact?.telegram_username ?? null;

  // Fetch Telegram user info (bio, etc.) from Telegram API
  const { data: telegramUserInfo } = useQuery({
    queryKey: ["contact-telegram-info", resolvedUserId],
    queryFn: async () => {
      if (!resolvedUserId || !resolvedTelegramUserId) return null;
      const { data, error } = await supabase.functions.invoke("telegram-admin-chat", {
        body: { action: "get_user_info", user_id: resolvedUserId },
      });
      if (error) throw error;
      if (!data.success) return null;
      return data.user_info;
    },
    enabled: !!resolvedUserId && !!resolvedTelegramUserId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Club membership status for badge display (via secure RPC)
  const { data: clubMembership, refetch: refetchClubMembership } = useQuery({
    queryKey: ["contact-club-membership", contact?.id],
    queryFn: async () => {
      if (!contact?.id) return null;
      try {
        const { data, error } = await supabase
          .rpc("admin_get_club_membership", { p_profile_id: contact.id });
        if (error) {
          // Don't throw on permission errors - just return null gracefully
          console.debug("Club membership not available:", error.message);
          return null;
        }
        // RPC returns array, take first row
        return data?.[0] ?? null;
      } catch (err) {
        console.debug("Club membership RPC unavailable:", err);
        return null;
      }
    },
    enabled: !!contact?.id && !!contact?.telegram_user_id,
    staleTime: 0,         // PATCH: всегда считать данные устаревшими
    refetchOnMount: true, // PATCH: перезапрашивать при каждом открытии карточки
  });

  // Fetch deals for this contact - only paid/trial/cancelled (not pending/failed payment attempts)
  // Deals = successful transactions. Payment attempts go to Payments tab.
  const { data: deals, isLoading: dealsLoading } = useQuery({
    queryKey: ["contact-deals", contact?.id, resolvedUserId],
    queryFn: async () => {
      if (!contact?.id) return [];
      
      // Build array of IDs to search (profile.id and optionally user_id)
      const userIds = [contact.id];
      if (resolvedUserId && resolvedUserId !== contact.id) {
        userIds.push(resolvedUserId);
      }
      
      // Query deals by profile_id OR user_id to catch ghost contact deals
      // Only include valid deal statuses (not pending/failed payment attempts)
      const { data, error } = await supabase
        .from("orders_v2")
        .select(`
          *,
          products_v2(id, name, code, category, public_id),
          tariffs(id, name, code),
          payments_v2(id, status, paid_at, created_at, provider_response)
        `)
        .or(`profile_id.eq.${contact.id},user_id.in.(${userIds.join(',')})`)
        .in("status", ['paid', 'partial', 'pending', 'canceled', 'refunded'] as const)
        .order("deal_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id,
  });

  const { data: moduleMetaMap } = useModuleDisplayMeta(deals);

  const selectedDeal = useMemo(
    () => deals?.find(d => d.id === selectedDealId) ?? null,
    [deals, selectedDealId]
  );

  const dealToEdit = useMemo(
    () => deals?.find(d => d.id === dealToEditId) ?? null,
    [deals, dealToEditId]
  );

  const refundDeal = useMemo(
    () => deals?.find(d => d.id === refundDealId) ?? null,
    [deals, refundDealId]
  );

  const { data: productsWithRules = new Set<string>() } = useActiveAccessRuleProducts();

  // Fetch subscriptions for this contact - check both profile.id and user_id
  // Use resolvedUserId (from DB) to ensure support-path also finds subscriptions
  const { data: subscriptions, isLoading: subsLoading, refetch: refetchSubs } = useQuery({
    queryKey: ["contact-subscriptions", contact?.id, resolvedUserId],
    queryFn: async () => {
      if (!contact?.id) return [];
      
      // Build array of IDs to search
      const userIds = [contact.id];
      if (resolvedUserId && resolvedUserId !== contact.id) {
        userIds.push(resolvedUserId);
      }
      
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          *,
          products_v2(id, name, code, telegram_club_id, is_active),
          tariffs(id, name, code, getcourse_offer_code, getcourse_offer_id, is_active)
        `)
        .in("user_id", userIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.id,
  });

  // Fetch entitlements for order_based_only products (not covered by subscriptions)
  const { data: entitlements, isLoading: entLoading } = useQuery({
    queryKey: ["contact-entitlements", contact?.id, resolvedUserId],
    queryFn: async () => {
      if (!contact?.id) return [];
      const userIds = [contact.id];
      if (resolvedUserId && resolvedUserId !== contact.id) {
        userIds.push(resolvedUserId);
      }
      const { data, error } = await supabase
        .from("entitlements")
        .select(`
          id, user_id, product_id, product_code, status, expires_at, meta, order_id, created_at, updated_at,
          products_v2:product_id(id, name, code, is_active, entitlement_mode)
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
  // Use resolvedUserId to ensure support-path also loads communications
  const { data: communications, isLoading: commsLoading } = useQuery({
    queryKey: ["contact-communications", resolvedUserId],
    queryFn: async () => {
      if (!resolvedUserId) return [];
      const { data: logs, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("target_user_id", resolvedUserId)
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
    enabled: !!resolvedUserId,
  });

  // Fetch notification events (telegram_logs + email_logs) for this contact
  const { data: notificationEvents } = useQuery({
    queryKey: ["contact-notification-events", resolvedUserId],
    queryFn: async () => {
      if (!resolvedUserId) return [];
      
      // Telegram notification logs - FIX-3: Include ADMIN_DISABLED_AUTO_RENEW for batch disable visibility
      const { data: tgLogs } = await supabase
        .from("telegram_logs")
        .select("id, created_at, action, event_type, status, error_message, meta")
        .eq("user_id", resolvedUserId)
        .in("action", ["SEND_REMINDER", "SEND_NO_CARD_WARNING", "ADMIN_DISABLED_AUTO_RENEW"])
        .order("created_at", { ascending: false })
        .limit(30);
      
      // Email notification logs
      const { data: emailLogs } = await supabase
        .from("email_logs")
        .select("id, created_at, status, error_message, meta")
        .eq("user_id", resolvedUserId)
        .eq("direction", "outgoing")
        .order("created_at", { ascending: false })
        .limit(30);
      
      // Normalize status helper
      const normalizeStatus = (raw: string | null): 'success' | 'skipped' | 'failed' => {
        if (!raw) return 'failed';
        const lower = raw.toLowerCase();
        if (['success', 'ok', 'sent'].includes(lower)) return 'success';
        if (['skipped'].includes(lower)) return 'skipped';
        return 'failed';
      };
      
      // Combine and normalize
      const combined = [
        ...(tgLogs || []).map(log => ({
          id: log.id,
          created_at: log.created_at,
          channel: 'telegram' as const,
          event_type: log.event_type || log.action,
          status: normalizeStatus(log.status),
          reason: (log.meta as any)?.reason,
          error_message: log.error_message,
          subscription_id: (log.meta as any)?.subscription_id,
        })),
        ...(emailLogs || []).map(log => ({
          id: log.id,
          created_at: log.created_at,
          channel: 'email' as const,
          event_type: (log.meta as any)?.event_type,
          status: normalizeStatus(log.status),
          reason: (log.meta as any)?.reason,
          error_message: log.error_message,
          subscription_id: (log.meta as any)?.subscription_id,
        })),
      ].filter(e => e.event_type?.startsWith('subscription_') || e.event_type === 'SEND_REMINDER' || e.event_type === 'SEND_NO_CARD_WARNING');
      
      return combined.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    enabled: !!contact?.user_id,
  });

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
        .select(`
          id, brand, last4, exp_month, exp_year, is_default, status, provider,
          verification_status, supports_recurring, recurring_verified,
          verification_error, verification_checked_at
        `)
        .eq("user_id", contact.user_id)
        .eq("status", "active")
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // PATCH-7: Fetch provider-managed subscriptions for contact
  const { data: contactProviderSubscriptions } = useQuery({
    queryKey: ["contact-provider-subscriptions", contact?.user_id],
    queryFn: async () => {
      if (!contact?.user_id) return [];
      const { data, error } = await supabase
        .from("provider_subscriptions")
        .select(`
          id, provider, state, provider_subscription_id,
          next_charge_at, amount_cents, currency, card_brand, card_last4, created_at, last_charge_at, interval_days,
          subscription_v2_id, meta,
          subscriptions_v2 (
            id, status, billing_type, tariff_id, access_end_at, next_charge_at, meta,
            products_v2 ( id, name ),
            tariffs ( id, name, product_id )
          )
        `)
        .eq("user_id", contact.user_id)
        .in("state", ["active", "pending"])
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!contact?.user_id,
  });

  // PATCH-7: Admin cancel provider subscription mutation
  const cancelProviderSubAdminMutation = useMutation({
    mutationFn: async (providerSubId: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-cancel-subscriptions', {
        body: { subscription_ids: [providerSubId], source: 'admin_cancel' }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (contact?.user_id) {
        queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', contact.user_id] });
      }
      toast.success('Подписка bePaid отменена');
    },
    onError: (error: Error) => {
      toast.error('Ошибка: ' + error.message);
    },
  });

  // PATCH-STRIPE-UI-INTEGRATION-CLEANUP-V1 (PATCH-C): Stripe cancel = bePaid cancel parity.
  // Action `cancel_now` отменяет рекуррент немедленно у провайдера.
  // НЕ трогает access_end_at / entitlements / telegram_access / orders / payments
  // (см. supabase/functions/stripe-subscription-action/index.ts — там это явно гарантировано).
  // Подписка исчезает из активного списка; оплаченный доступ сохраняется до access_end_at.
  const cancelStripeSubAdminMutation = useMutation({
    mutationFn: async (subscriptionV2Id: string) => {
      const { data, error } = await supabase.functions.invoke('stripe-subscription-action', {
        body: {
          subscription_v2_id: subscriptionV2Id,
          action: 'cancel_now',
          dry_run: false,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.detail || data.error);
      return data;
    },
    onSuccess: () => {
      if (contact?.user_id) {
        queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', contact.user_id] });
      }
      queryClient.invalidateQueries({ queryKey: ['bepaid-subscriptions-admin'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stripe-subscriptions-list'] });
      toast.success('Подписка отменена. Доступ сохраняется до конца оплаченного периода.');
    },
    onError: (error: Error) => {
      toast.error('Ошибка: ' + error.message);
    },
  });

  // PATCH 7: Sync bePaid subscription mutation
  const syncBepaidSubMutation = useMutation({
    mutationFn: async (providerSubId: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-get-subscription-details', {
        body: { subscription_id: providerSubId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', contact?.user_id] });
      queryClient.invalidateQueries({ queryKey: ['contact-payments', contact?.id] });
      queryClient.invalidateQueries({ queryKey: ['contact-deals'] });
      toast.success('Подписка синхронизирована');
    },
    onError: (error: Error) => {
      toast.error('Ошибка синхронизации: ' + error.message);
    },
  });

  // REPAIR-BEPAID-ACCESS-2026-05 v3: admin repair of zombie provider_subscriptions
  const repairZombieMutation = useMutation({
    mutationFn: async (providerSubRowIds: string[]) => {
      const { data, error } = await supabase.functions.invoke('admin-repair-zombie-provider-subs', {
        body: { provider_sub_row_ids: providerSubRowIds },
      });
      if (error) throw new Error(normalizeEdgeFunctionError(error));
      return data;
    },
    onSuccess: (data: any) => {
      const failed = (data?.results || []).filter((r: any) => r.action === 'failed_to_cancel_provider' || r.action === 'manual_review');
      const ok = (data?.results || []).filter((r: any) => r.action === 'cancel_local_only' || r.action === 'cancel_provider_then_local');
      queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', contact?.user_id] });
      if (failed.length === 0) toast.success(`Ремонт выполнен: ${ok.length}`);
      else toast.warning(`Готово: ${ok.length}, требуют внимания: ${failed.length}`);
    },
    onError: (e: Error) => toast.error('Ремонт не выполнен: ' + e.message),
  });
  const autoSyncCountRef = useRef(0);
  const autoSyncedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!contactProviderSubscriptions || contactProviderSubscriptions.length === 0) return;
    if (syncBepaidSubMutation.isPending) return;

    const subsToSync = contactProviderSubscriptions.filter((sub: any) => {
      if (sub.provider !== 'bepaid') return false;
      if (autoSyncedIdsRef.current.has(sub.provider_subscription_id)) return false;
      
      const snapshotAt = (sub as any)?.meta?.snapshot_at;
      const isStale = !snapshotAt || (Date.now() - new Date(snapshotAt).getTime() > 10 * 60 * 1000);
      const needsSync = !sub.next_charge_at || 
        ['failed_attempt', 'past_due', 'failed'].includes(sub.state) ||
        isStale;
      
      return needsSync;
    });

    for (const sub of subsToSync) {
      if (autoSyncCountRef.current >= 3) break;
      autoSyncCountRef.current++;
      autoSyncedIdsRef.current.add(sub.provider_subscription_id);
      syncBepaidSubMutation.mutate(sub.provider_subscription_id);
    }
  }, [contactProviderSubscriptions, syncBepaidSubMutation.isPending]);
  const createProviderSubAdminMutation = useMutation({
    mutationFn: async (subscriptionV2Id: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-admin-create-subscription-link', {
        body: { subscription_v2_id: subscriptionV2Id }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      if (data?.redirect_url) {
        setBepaidLinkUrl(data.redirect_url);
        setBepaidLinkModalOpen(true);
        if (contact?.user_id) {
          queryClient.invalidateQueries({ queryKey: ['contact-provider-subscriptions', contact.user_id] });
        }
      } else {
        toast.error('Не удалось получить ссылку');
      }
    },
    onError: (error: Error) => {
      toast.error('Ошибка: ' + error.message);
    },
  });

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
        // Critical: ensure impersonation can never be “silent”
        localStorage.setItem("is_impersonating", "true");
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
    onSuccess: (result, variables) => {
      const messages: Record<string, string> = {
        cancel: "Подписка отменена",
        resume: "Подписка восстановлена",
        extend: "Доступ продлён",
        grant_access: "Доступ выдан",
        revoke_access: "Доступ отозван",
        delete: "Подписка удалена",
        toggle_auto_renew: result.auto_renew 
          ? "Автопродление включено" + (result.payment_method_linked ? " (карта добавлена)" : " (карта не добавлена)")
          : "Автопродление отключено",
      };
      toast.success(messages[variables.action] || "Действие выполнено");
      refetchSubs();
      setSelectedSubscription(null);
      setAutoRenewConfirmOpen(false);
      setAutoRenewTarget(null);
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

  // Handle entitlement deletion (доступ по правилу)
  const handleDeleteEntitlement = async (entitlementId: string, productName: string, productId?: string, sourceType?: string, orderId?: string | null) => {
    if (!confirm(`Удалить доступ по правилу «${productName}»? Это действие необратимо.`)) return;
    if (isProcessing) return; // блокировка повторного клика
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('entitlements')
        .delete()
        .eq('id', entitlementId);
      if (error) throw error;
      
      await supabase.from('audit_logs').insert({
        action: 'entitlement.admin_delete',
        actor_type: 'admin',
        actor_user_id: (await supabase.auth.getUser()).data.user?.id || null,
        target_user_id: resolvedUserId || null,
        meta: {
          entitlement_id: entitlementId,
          product_name: productName,
          product_id: productId || null,
          source_type: sourceType || null,
          order_id: orderId || null,
        },
      });
      
      toast.success(`Доступ «${productName}» удалён`);
      queryClient.invalidateQueries({ queryKey: ["admin-contact-entitlements"] });
      queryClient.invalidateQueries({ queryKey: ["admin-contact"] });
    } catch (err: any) {
      toast.error(`Ошибка удаления: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleAutoRenew = async () => {
    if (!autoRenewTarget) return;
    
    const newValue = !autoRenewTarget.currentValue;
    await handleSubscriptionAction("toggle_auto_renew", autoRenewTarget.subscriptionId, {
      auto_renew: newValue,
      reason: newValue ? "Включено администратором" : "Отключено администратором",
    });
  };

  // Grant new access - performs all the same actions as a regular purchase
  const handleGrantNewAccess = async () => {
    const isGhostContact = !resolvedUserId;
    
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
        deal_date: accessStart.toISOString(),
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
        // 3. CANONICAL FULFILLMENT: Call grant-access-for-order instead of direct INSERT
        // This ensures entitlements, access_rules resolution, and all side-effects are created.
        // PATCH A/B/C: canonical orderId; Telegram идёт canonical через access_rules.
        try {
          const { data: grantResult, error: grantError } = await supabase.functions.invoke(
            "grant-access-for-order",
            {
              body: {
                orderId: orderV2.id,
                source: "admin_grant",
              },
            }
          );

          if (grantError || grantResult?.error) {
            console.error("grant-access-for-order error:", grantError, grantResult);
            // Don't throw - order is already created, log the issue
            toast.warning("Сделка создана, но автоматическая выдача доступа не сработала. Используйте кнопку 'Выдать доступ' на сделке.");
          } else {
            subscriptionId = grantResult?.subscription_id || null;
          }
        } catch (grantErr) {
          console.error("grant-access-for-order call failed:", grantErr);
          toast.warning("Сделка создана, но выдача доступа требует ручного действия.");
        }

        // Telegram access выдаёт canonical path (grant-access-for-order → access_rules
        // → telegram-grant-access). Прямой UI-вызов запрещён
        // (mem://architecture/telegram/canonical-grant-write-path).

        // 5. Sync to GetCourse using the created order
        const gcOfferId = tariff?.getcourse_offer_id || tariff?.getcourse_offer_code;
        if (gcOfferId) {
          try {
            const { data: gcResult, error: gcError } = await supabase.functions.invoke("test-getcourse-sync", {
              body: {
                orderId: orderV2.id,
                email: contact.email,
                offerId: (() => {
                  if (typeof gcOfferId === 'number') return gcOfferId;
                  if (typeof gcOfferId === 'string') {
                    const parsed = parseInt(gcOfferId, 10);
                    return isNaN(parsed) ? gcOfferId : parsed;
                  }
                  return null;
                })(),
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
      queryClient.invalidateQueries({ queryKey: ["contact-deals"] });
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

  // Используем централизованный словарь событий из @/lib/eventLabels
  // import { getEventLabel } from "@/lib/eventLabels" - добавлен в импорты

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
    if (sub.status === "past_due") {
      return <Badge variant="destructive">Просрочена</Badge>;
    }
    if (sub.status === "superseded") {
      return <Badge variant="secondary">Заменена</Badge>;
    }
    if (sub.status === "pending") {
      return <Badge variant="outline" className="text-amber-600 border-amber-300">Ожидает оплаты</Badge>;
    }
    if (sub.status === "paused") {
      return <Badge variant="outline" className="text-amber-600 border-amber-300">Приостановлена</Badge>;
    }
    return <Badge variant="outline">{sub.status}</Badge>;
  };

  const activeSubscriptions = subscriptions?.filter(s => 
    isCurrentValidAccess(s as any, productsWithRules)
  ) || [];

  // PATCH PAYMENT-CONFLICT v4: hide unpaid trash from finished section.
  // Trash = past_due / pending / redirecting / expired without any successful
  // billing cycle (access window never granted). Such records остаются в БД
  // как технические попытки, но не должны отображаться как «подписки» в карточке.
  const hadSuccessfulCycle = (s: any): boolean => {
    if (!s?.access_start_at || !s?.access_end_at) return false;
    const start = new Date(s.access_start_at).getTime();
    const end = new Date(s.access_end_at).getTime();
    // window >= ~12h => считаем, что был фактический оплаченный access cycle
    return end - start > 12 * 60 * 60 * 1000;
  };
  const isUnpaidTrashRow = (s: any): boolean => {
    const trashStatuses = new Set(['past_due', 'pending', 'redirecting', 'expired']);
    if (!trashStatuses.has(s?.status)) return false;
    return !hadSuccessfulCycle(s);
  };

  const finishedSubscriptions = subscriptions?.filter(s => 
    isHistoricalAccess(s as any, productsWithRules) && !isUnpaidTrashRow(s)
  ) || [];

  // Dedup entitlements against ONLY currently valid subscriptions (not canceled/archived/superseded)
  const activeSubscriptionProductIds = new Set(
    (activeSubscriptions || []).map(s => s.product_id).filter(Boolean)
  );

  const activeEntitlements = (entitlements || []).filter(e => {
    if (!e.product_id || activeSubscriptionProductIds.has(e.product_id)) return false;
    if (e.status !== 'active') return false;
    if (e.expires_at && new Date(e.expires_at) < new Date()) return false;
    const product = e.products_v2 as any;
    if (product?.is_active === false) return false;
    const productId = e.product_id;
    return productId && productsWithRules.has(productId);
  });

  const finishedSubscriptionProductIds = new Set(
    (finishedSubscriptions || []).map(s => s.product_id).filter(Boolean)
  );

  const finishedEntitlements = (entitlements || []).filter(e => {
    if (!e.product_id || activeSubscriptionProductIds.has(e.product_id) || finishedSubscriptionProductIds.has(e.product_id)) return false;
    return !activeEntitlements.some(ae => ae.id === e.id);
  });

  // Unified effective access count
  const totalActiveAccess = activeSubscriptions.length + activeEntitlements.length;

  if (!contact) return null;

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={SHEET_SHELL_CLASS}>
        {/* Compact header for mobile - with padding-right for close button */}
        <SheetHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-0 pr-14 sm:pr-16 flex-shrink-0 space-y-1.5">
          {/* Row 1: Avatar + Name + Email */}
          <div className="flex items-start gap-3">
            <AvatarZoomDialog
              avatarUrl={contact.avatar_url}
              fallbackText={formatContactName(contact)?.[0]?.toUpperCase() || contact.email?.[0]?.toUpperCase() || "?"}
              name={formatContactName(contact)}
              onFetchFromTelegram={resolvedTelegramUserId ? fetchPhotoFromTelegram : undefined}
              isFetchingPhoto={isFetchingPhoto}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg sm:text-xl font-bold leading-tight break-words">{formatContactName(contact)}</SheetTitle>
              {contact.email && (
                <p className="text-xs text-muted-foreground break-all mt-0.5">{contact.email}</p>
              )}
            </div>
          </div>

          {/* Separator removed — TabsList provides visual separation */}

          {/* Row 2: All badges & actions as uniform pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {returnTo && (
              <Badge
                variant="outline"
                className="cursor-pointer h-7 px-2.5 text-xs gap-1 hover:bg-accent"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/admin/${returnTo}`);
                }}
              >
                <ArrowLeft className="w-3 h-3" />
                {returnTo === "deals" ? "к сделкам" : "назад"}
              </Badge>
            )}

            {profileData?.loyalty_score && (
              <LoyaltyPulse score={profileData.loyalty_score} size="sm" />
            )}

            <Badge
              variant="outline"
              className="cursor-pointer h-7 px-2 text-xs hover:bg-accent"
              onClick={() => copyToClipboard(getContactUrl(contact.id), "Ссылка на контакт скопирована")}
            >
              <Link2 className="w-3 h-3" />
            </Badge>

            <Badge
              variant="outline"
              className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => setEditDialogOpen(true)}
            >
              <Pencil className="w-3 h-3" />
              редактировать
            </Badge>

            {!resolvedUserId && (
              <Badge variant="outline" className="h-7 px-2.5 text-xs gap-1 border-amber-400 text-amber-600 dark:text-amber-400">
                <UserX className="w-3 h-3" />
                без аккаунта
              </Badge>
            )}

            {resolvedStatus === "imported" ? (
              <Badge variant="outline" className="h-7 px-2.5 text-xs gap-1 bg-blue-500/20 text-blue-600 border-blue-500/30">
                <UserX className="w-3 h-3" />
                импорт
              </Badge>
            ) : resolvedStatus === "ghost" ? null : resolvedStatus === "active" && resolvedUserId ? (
              <Badge variant="default" className="h-7 px-2.5 text-xs gap-1">
                <CheckCircle className="w-3 h-3" />
                Активен
              </Badge>
            ) : resolvedStatus === "blocked" ? (
              <Badge variant="secondary" className="h-7 px-2.5 text-xs gap-1">
                <Ban className="w-3 h-3" />
                Заблокирован
              </Badge>
            ) : resolvedStatus === "archived" ? (
              <Badge variant="secondary" className="h-7 px-2.5 text-xs gap-1">
                <XCircle className="w-3 h-3" />
                Архивный
              </Badge>
            ) : resolvedStatus === "banned" ? (
              <Badge variant="destructive" className="h-7 px-2.5 text-xs gap-1">
                <Ban className="w-3 h-3" />
                ЗАБАНЕН
              </Badge>
            ) : null}

          </div>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Scrollable tabs for mobile */}
          <div className="flex-shrink-0 overflow-x-auto scrollbar-none" style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)' }}>
            <TabsList className="mx-4 sm:mx-6 mt-0 mb-0 inline-flex w-auto whitespace-nowrap bg-transparent h-auto">
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
                Доступы {totalActiveAccess > 0 && <Badge variant="secondary" className="ml-1 text-xs">{totalActiveAccess}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="deals" className="text-xs sm:text-sm px-2.5 sm:px-3">
                Сделки {deals && deals.filter(d => d.status === "paid").length > 0 && <Badge variant="secondary" className="ml-1 text-xs">{deals.filter(d => d.status === "paid").length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="payments" className="text-xs sm:text-sm px-2.5 sm:px-3">
                <CreditCard className="w-3 h-3 mr-1" />
                Платежи
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
              <TabsTrigger value="loyalty" className="text-xs sm:text-sm px-2.5 sm:px-3">
                <Sparkles className="w-3 h-3 mr-1" />
                Лояльность
              </TabsTrigger>
              <TabsTrigger value="artifacts" className="text-xs sm:text-sm px-2.5 sm:px-3">
                <BookOpen className="w-3 h-3 mr-1" />
                Анкеты
              </TabsTrigger>
              {contact.duplicate_flag && contact.duplicate_flag !== 'none' && (
                <TabsTrigger value="duplicates" className="text-xs sm:text-sm px-2.5 sm:px-3">Дубли</TabsTrigger>
              )}
            </TabsList>
          </div>
          {/* Separator removed — TabsList active state already provides visual border */}

          {/* Telegram-вкладка вынесена ИЗ внешнего скролла:
              скроллится только лента сообщений внутри ContactTelegramChat,
              а композер остаётся прижат к низу карточки контакта. */}
          <TabsContent
            value="telegram"
            forceMount
            className="m-0 flex-1 min-h-0 flex flex-col gap-2 px-4 sm:px-6 pb-0 pt-1 overflow-hidden data-[state=inactive]:hidden"
          >
            {/* Telegram Profile Info Card */}
            {resolvedTelegramUserId ? (
              <Card className="shrink-0">
                {/* Свёрнутый header: всегда виден, кликом раскрывается */}
                <button
                  type="button"
                  onClick={() => setTgInfoExpanded((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors rounded-t-lg"
                  aria-expanded={tgInfoExpanded}
                  aria-controls="tg-info-body"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-wrap text-sm">
                    <span className="font-mono text-xs text-muted-foreground">ID {resolvedTelegramUserId}</span>
                    {resolvedTelegramUsername && (
                      <span className="text-primary truncate">@{resolvedTelegramUsername}</span>
                    )}
                    {profileData?.telegram_link_status && (
                      <Badge
                        variant={profileData.telegram_link_status === "active" ? "default" : "secondary"}
                        className="text-[10px] py-0 h-5"
                      >
                        {profileData.telegram_link_status === "active" ? "Активен" : profileData.telegram_link_status}
                      </Badge>
                    )}
                    {clubMembership && (clubMembership.in_chat === true || clubMembership.in_channel === true) && (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] py-0 h-5">
                        В клубе
                      </Badge>
                    )}
                    {clubMembership && !(clubMembership.in_chat === true || clubMembership.in_channel === true) && clubMembership.access_status === 'ok' && (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] py-0 h-5">
                        Ожидает входа
                      </Badge>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 shrink-0 text-muted-foreground transition-transform",
                      tgInfoExpanded && "rotate-180"
                    )}
                  />
                </button>

                {tgInfoExpanded && (
                  <CardContent id="tg-info-body" className="p-4 pt-0 border-t">
                    <div className="flex items-start justify-between pt-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">ID:</span>
                          <span className="font-mono">{resolvedTelegramUserId}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => {
                              navigator.clipboard.writeText(String(resolvedTelegramUserId));
                              toast.success("ID скопирован");
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        {resolvedTelegramUsername && (
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-muted-foreground">Username:</span>
                            <a
                              href={`https://t.me/${resolvedTelegramUsername}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline flex items-center gap-1"
                            >
                              @{resolvedTelegramUsername}
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
                        {/* Club memberships — статус по всем активным Telegram-клубам */}
                        <div className="pt-1">
                          <ContactClubMembershipsList
                            profileId={contact?.id ?? null}
                            enabled={!!contact?.id && tgInfoExpanded}
                          />
                        </div>
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
                )}
              </Card>
            ) : (
              <Card className="shrink-0">
                <CardContent className="p-4 text-center text-muted-foreground">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Telegram не привязан</p>
                </CardContent>
              </Card>
            )}

            {/* Chat — единственный скроллящийся блок внутри Telegram-вкладки */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <ContactTelegramChat
                userId={resolvedUserId || ""}
                telegramUserId={resolvedTelegramUserId}
                telegramUsername={resolvedTelegramUsername}
                clientName={contact.full_name}
                hidePhotoButton
                isActive={activeTab === "telegram"}
              />
            </div>
          </TabsContent>

          {/* Все остальные вкладки — во внешнем скролле как раньше.
              При активной Telegram-вкладке прячем этот контейнер,
              чтобы не было двойного скролла и pb-24 не съедал высоту. */}
          <div
            ref={scrollContainerRef}
            className={cn("flex-1 overflow-y-auto", activeTab === "telegram" && "hidden")}
          >
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
                      {resolvedTelegramUsername ? (
                        <span>@{resolvedTelegramUsername}</span>
                      ) : resolvedTelegramUserId ? (
                        <span className="text-muted-foreground">ID: {resolvedTelegramUserId}</span>
                      ) : (
                        <span className="text-muted-foreground">Не привязан</span>
                      )}
                    </div>
                    {resolvedTelegramUsername && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`https://t.me/${resolvedTelegramUsername}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </Button>
                    )}
                  </div>

                  {/* Instagram */}
                  {profileData?.instagram_url && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <ExternalLink className="w-4 h-4 text-pink-500" />
                          <span>Instagram</span>
                        </div>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={profileData.instagram_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </Button>
                      </div>
                    </>
                  )}

                  {/* Country / City */}
                  {(profileData?.country || profileData?.city) && (
                    <>
                      <Separator />
                      <div className="flex items-center gap-3 text-sm">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{[profileData?.city, profileData?.country].filter(Boolean).join(', ')}</span>
                      </div>
                    </>
                  )}

                  {/* Birth date */}
                  {profileData?.birth_date && (
                    <>
                      <Separator />
                      <div className="flex items-center gap-3 text-sm">
                        <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Дата рождения</span>
                        <span>{format(new Date(profileData.birth_date), "dd MMM yyyy", { locale: ru })}</span>
                      </div>
                    </>
                  )}
                  
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
                  {profileData?.gc_registered_at && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-sm">
                          <CalendarIcon className="w-4 h-4 text-orange-500" />
                          <span className="text-muted-foreground">Рег. в GetCourse</span>
                        </div>
                        <span className="text-sm">
                          {format(new Date(profileData.gc_registered_at), "dd MMM yyyy", { locale: ru })}
                        </span>
                      </div>
                    </>
                  )}
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
              {resolvedTelegramUserId && (
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
                      <span className="text-sm font-mono">{resolvedTelegramUserId}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Username</span>
                      {resolvedTelegramUsername ? (
                        <a 
                          href={`https://t.me/${resolvedTelegramUsername}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-blue-500 hover:underline flex items-center gap-1"
                        >
                          @{resolvedTelegramUsername}
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

              {/* Привязанные карты с встроенным Card Health */}
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
                      <div className="space-y-2">
                        {paymentMethods.map((method) => {
                          const brand = (method.brand || "CARD").toUpperCase();
                          const last4 = method.last4 || "••••";
                          const mm = method.exp_month ? String(method.exp_month).padStart(2, "0") : null;
                          const yy = method.exp_year ? String(method.exp_year).slice(-2) : null;
                          const expiry = mm && yy ? `${mm}/${yy}` : null;
                          const isExpired = !!(method.exp_month && method.exp_year) &&
                            (new Date(method.exp_year, method.exp_month, 0) < new Date());
                          return (
                            <div
                              key={method.id}
                              className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                                  <span className="font-medium text-sm">
                                    {brand} ••••{last4}
                                  </span>
                                  {expiry && (
                                    <span className="text-xs text-muted-foreground">{expiry}</span>
                                  )}
                                  {method.is_default && (
                                    <Badge variant="secondary" className="text-[10px] h-5">Основная</Badge>
                                  )}
                                  {isExpired && (
                                    <Badge variant="destructive" className="text-[10px] h-5">Истекла</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted-foreground">
                        <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Нет привязанных карт</p>
                      </div>
                    )}
                    {/* Charge button — super_admin only; Payment link — any admin */}
                    <div className="flex gap-2 mt-2">
                      {isSuperAdmin() && (
                        <Button
                          variant="outline"
                          className="flex-1 gap-2"
                          onClick={() => setChargeDialogOpen(true)}
                        >
                          <CreditCard className="w-4 h-4" />
                          Списать деньги
                        </Button>
                      )}
                      {isAdmin() && (
                        <Button
                          variant="outline"
                          className="flex-1 gap-2"
                          onClick={() => setPaymentLinkDialogOpen(true)}
                        >
                          <Link2 className="w-4 h-4" />
                          Ссылка на оплату
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* PATCH-7 + REPAIR-BEPAID-ACCESS-2026-05 v3:
                  Provider-managed subscriptions (bePaid) for Admin.
                  Zombies (linked sv2 expired/canceled/superseded OR access_end_at < now OR sv2 missing)
                  не рисуются как «живые подписки» — provider_subscriptions.next_charge_at для них
                  технический desync-сигнал, а не пользовательский статус. */}
              {(() => {
                const allProviderSubs = contactProviderSubscriptions || [];
                // FIX 2026-05: provider-subscription health НЕ зависит от локальных
                // subscriptions_v2/access_end_at/доступов. Удаление сделки или отзыв доступа
                // не должны переводить живое bePaid-автосписание в "ремонт".
                // Зомби = провайдер реально мёртв (canceled/expired/terminated/404 в snapshot
                // или INV-22 флаг). См. .lovable/plan.md + admin-repair-zombie-provider-subs.
                const LIVE_PROVIDER_STATES = new Set(['active', 'trial', 'pending']);
                const DEAD_PROVIDER_SNAPSHOT_STATES = new Set([
                  'canceled', 'cancelled', 'expired', 'terminated', 'finished', 'failed',
                ]);
                const isProviderDead = (sub: any): boolean => {
                  const meta = (sub?.meta || {}) as Record<string, any>;
                  const snapshotState = String(meta?.provider_snapshot?.state ?? '').toLowerCase();
                  if (snapshotState && DEAD_PROVIDER_SNAPSHOT_STATES.has(snapshotState)) return true;
                  const lastHttp = Number(meta?.last_pull?.http_status ?? 0);
                  if (lastHttp === 404) return true;
                  if (meta?.inv22_provider_dead_local_active === true) return true;
                  return false;
                };
                // PATCH-A (2026-06-09): pending drafts (созданные ссылки / pending checkout)
                // НЕ являются реальной подпиской и не должны отображаться в карточке контакта.
                // Реальной считаем запись с настоящим provider_subscription_id:
                //   • stripe → начинается с 'sub_'
                //   • bepaid → не пусто и не 'pending:%'
                //   • прочие → не пусто и не 'pending:%'
                // Такие записи живут в «Платежи → Ссылки» / диагностике.
                const isRealProviderSubscription = (sub: any): boolean => {
                  const psid = String(sub?.provider_subscription_id ?? '').trim();
                  if (!psid) return false;
                  if (psid.toLowerCase().startsWith('pending:')) return false;
                  if (sub?.provider === 'stripe' && !psid.startsWith('sub_')) return false;
                  const sv2Status = String(sub?.subscriptions_v2?.status ?? '').toLowerCase();
                  if (sv2Status === 'pending') return false;
                  return true;
                };
                const isHealthyProviderSub = (sub: any) => {
                  if (!LIVE_PROVIDER_STATES.has(sub?.state)) return false;
                  if (isProviderDead(sub)) return false;
                  if (!isRealProviderSubscription(sub)) return false;
                  return true;
                };
                const healthyProviderSubs = allProviderSubs.filter(isHealthyProviderSub);
                const zombieProviderSubs = allProviderSubs.filter(
                  (s: any) =>
                    s?.provider === 'bepaid' &&
                    s?.state === 'active' &&
                    isRealProviderSubscription(s) &&
                    isProviderDead(s),
                );
                // Русские лейблы провайдер-состояний (только для реальных подписок).
                const PROVIDER_STATE_LABELS_RU: Record<string, string> = {
                  active: 'Активна',
                  trial: 'Пробный период',
                  pending: 'Ожидает оплаты',
                  canceled: 'Отменена',
                  cancelled: 'Отменена',
                  expired: 'Завершена',
                  terminated: 'Завершена',
                  finished: 'Завершена',
                  failed: 'Ошибка оплаты',
                  refunded: 'Возврат',
                };
                const PROVIDER_BRAND_LABELS: Record<string, string> = {
                  stripe: 'Иностранная карта (Stripe)',
                  bepaid: 'Белорусская карта (bePaid)',
                };
                return (
                  <>
                    {contact.user_id && healthyProviderSubs.length > 0 && (
                <Card className="border-blue-200 dark:border-blue-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2">
                      <RefreshCw className="w-4 h-4" />
                      Подписки
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TooltipProvider>
                    {healthyProviderSubs.map((sub: any) => {
                      const productName = sub.subscriptions_v2?.products_v2?.name || 'Подписка';
                      const tariffName = sub.subscriptions_v2?.tariffs?.name;
                      const displayName = tariffName ? `${productName} — ${tariffName}` : productName;
                      const isActive = sub.state === 'active' || sub.state === 'pending';
                      const isBepaid = sub.provider === 'bepaid';
                      const providerLabel =
                        PROVIDER_BRAND_LABELS[String(sub.provider).toLowerCase()] ||
                        (sub.provider ? sub.provider.toString() : 'Провайдер');
                      const stateLabel =
                        PROVIDER_STATE_LABELS_RU[String(sub.state).toLowerCase()] || 'Активна';

                      const nextCharge = sub.next_charge_at ?? sub.subscriptions_v2?.next_charge_at ?? null;
                      const hasAmount = sub.amount_cents != null && sub.currency;
                      const amountStr = hasAmount ? `${(sub.amount_cents / 100).toFixed(2)} ${sub.currency}` : null;

                      // PATCH 5b: accessEnd fallback from provider_snapshot
                      const metaObj = ((sub as any).meta || {}) as Record<string, any>;
                      const accessEnd = sub.subscriptions_v2?.access_end_at
                        || metaObj?.provider_snapshot?.active_to
                        || null;
                      const accessEndSource = sub.subscriptions_v2?.access_end_at ? 'db' : 'provider';
                      
                      return (
                        <div 
                          key={sub.id} 
                          className={`p-3 rounded-lg border ${
                            isActive 
                              ? 'bg-blue-50 dark:bg-blue-900/20' 
                              : 'bg-muted/50'
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{displayName}</p>
                              {isBepaid ? (
                                <a
                                  href={`/admin/payments/bepaid-subscriptions?search=${sub.provider_subscription_id}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    navigate(`/admin/payments/bepaid-subscriptions?search=${sub.provider_subscription_id}`);
                                  }}
                                  className="text-xs text-primary hover:underline cursor-pointer break-all"
                                >
                                  ID: {sub.provider_subscription_id}
                                </a>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-xs text-muted-foreground cursor-not-allowed break-all">
                                      ID: {sub.provider_subscription_id}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Переход доступен только для bePaid</TooltipContent>
                                </Tooltip>
                              )}
                              <div className="flex items-center gap-1.5 mt-1 whitespace-nowrap">
                                <Badge 
                                  variant={isActive ? 'default' : 'secondary'}
                                  className={isActive ? 'bg-blue-600' : ''}
                                >
                                  {stateLabel}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {providerLabel}
                                </Badge>
                                {(() => {
                                  const chargeCount = getSubscriptionChargeCount(sub);
                                  if (chargeCount === null) return null;
                                  return (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full text-[10px] font-semibold bg-amber-100/70 border border-amber-200/50 text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] cursor-default"
                                        >
                                          {chargeCount}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top">Количество успешных списаний по подписке</TooltipContent>
                                    </Tooltip>
                                  );
                                })()}
                              </div>
                              {sub.card_last4 && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {sub.card_brand?.toUpperCase()} •••• {sub.card_last4}
                                </p>
                              )}
                              <div className="mt-1 text-xs text-muted-foreground leading-tight space-y-px">
                                <p className="whitespace-nowrap">Создана: {formatPaymentTimeIANA(sub.created_at, 'Europe/Warsaw')}</p>
                                <p className="whitespace-nowrap">Последнее списание: {sub.last_charge_at ? formatPaymentTimeIANA(sub.last_charge_at, 'Europe/Warsaw') : '—'}</p>
                                <p className="whitespace-nowrap">
                                  {nextCharge 
                                    ? `Следующее списание: ${formatPaymentTimeIANA(nextCharge, 'Europe/Warsaw')}${amountStr ? ` — ${amountStr}` : ''}`
                                    : 'Следующее списание: —'
                                  }
                                </p>
                                {accessEnd && (
                                  <p className="whitespace-nowrap">
                                    Доступ до: {formatPaymentTimeIANA(accessEnd, 'Europe/Warsaw')}
                                    {accessEndSource === 'provider' && (
                                      <Badge variant="outline" className="ml-1 text-[9px]">provider</Badge>
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 items-center">
                              {/* PATCH 7: Sync button */}
                              {isBepaid && sub.provider_subscription_id && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 w-7 p-0 rounded-full"
                                  onClick={() => syncBepaidSubMutation.mutate(sub.provider_subscription_id)}
                                  disabled={syncBepaidSubMutation.isPending}
                                  title="Синхронизировать с bePaid"
                                >
                                  {syncBepaidSubMutation.isPending ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3" />
                                  )}
                                </Button>
                              )}
                              {isActive && (
                                isBepaid ? (
                                  <Button 
                                    variant="destructive" 
                                    size="sm"
                                    className="h-7 px-2 text-xs rounded-full"
                                    onClick={() => cancelProviderSubAdminMutation.mutate(sub.provider_subscription_id)}
                                    disabled={cancelProviderSubAdminMutation.isPending}
                                  >
                                    {cancelProviderSubAdminMutation.isPending ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      'Отменить'
                                    )}
                                  </Button>
                              ) : sub.provider === 'stripe' && sub.subscription_v2_id ? (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-7 px-2 text-xs rounded-full"
                                  onClick={() => {
                                    const accessLine = accessEnd
                                      ? `\n\nДоступ сохраняется до: ${formatPaymentTimeIANA(accessEnd, 'Europe/Warsaw')}`
                                      : '\n\nДоступ сохраняется до конца оплаченного периода.';
                                    if (window.confirm(`Отменить подписку?\n\nБудущих списаний не будет. Деньги не возвращаются.${accessLine}`)) {
                                      cancelStripeSubAdminMutation.mutate(sub.subscription_v2_id);
                                    }
                                  }}
                                  disabled={cancelStripeSubAdminMutation.isPending}
                                  title="Отменить рекуррент (доступ не отзывается)"
                                >
                                  {cancelStripeSubAdminMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    'Отменить'
                                  )}
                                </Button>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>
                                      <Button 
                                        variant="destructive" 
                                        size="sm"
                                        className="h-7 px-2 text-xs rounded-full"
                                        disabled
                                      >
                                        Отменить
                                      </Button>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>Провайдер {sub.provider || 'unknown'} не поддерживает отмену из админки</TooltipContent>
                                </Tooltip>
                              )
                            )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </TooltipProvider>
                  </CardContent>
                </Card>
              )}
              {contact.user_id && zombieProviderSubs.length > 0 && (
                <Card className="border-amber-200/60 dark:border-amber-900/40 bg-amber-50/30 dark:bg-amber-950/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Технические записи провайдера ({zombieProviderSubs.length}) — требуют ремонта
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      bePaid сообщил, что {zombieProviderSubs.length} запись(ей) подписки отменены
                      или недоступны на стороне провайдера (canceled / expired / terminated / 404).
                      Автосписание у провайдера не пройдёт. Запись можно закрыть локально —
                      это не влияет на доступы и сделки контакта.
                    </p>
                    <ul className="mt-2 space-y-1 text-[11px] font-mono text-muted-foreground">
                      {zombieProviderSubs.map((s: any) => (
                        <li key={s.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {s.provider_subscription_id} — sv2: {s.subscriptions_v2?.status ?? 'NULL'}
                            {s.subscriptions_v2?.access_end_at ? ` (до ${new Date(s.subscriptions_v2.access_end_at).toLocaleDateString('ru-RU')})` : ''}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px] rounded-full shrink-0"
                            disabled={repairZombieMutation.isPending}
                            onClick={() => repairZombieMutation.mutate([s.id])}
                          >
                            {repairZombieMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Ремонт'}
                          </Button>
                        </li>
                      ))}
                    </ul>
                    {zombieProviderSubs.length > 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 h-7 px-3 text-xs rounded-full"
                        disabled={repairZombieMutation.isPending}
                        onClick={() => repairZombieMutation.mutate(zombieProviderSubs.map((s: any) => s.id))}
                      >
                        {repairZombieMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : `Ремонт всех (${zombieProviderSubs.length})`}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
                  </>
                );
              })()}

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
              {(contact.user_id && (hasPermission("users.impersonate") || hasPermission("users.reset_password"))) || isSuperAdmin() ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      Действия администратора
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {hasPermission("users.impersonate") && contact.user_id && (
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
                    {hasPermission("users.reset_password") && contact.email && contact.user_id && (
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

                    {isSuperAdmin() && resolvedStatus !== "banned" && (
                      <Button
                        variant="destructive"
                        className="w-full gap-2"
                        onClick={() => { setBanReason(""); setBanDialogOpen(true); }}
                      >
                        <Ban className="w-4 h-4" />
                        Добавить в бан-лист
                      </Button>
                    )}

                    {isSuperAdmin() && resolvedStatus === "banned" && (
                      <Button
                        variant="outline"
                        className="w-full gap-2 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-700"
                        onClick={async () => {
                          setIsBanning(true);
                          try {
                            const { error } = await supabase.functions.invoke("ban-list-manage", {
                              body: { action: "remove", profileId: contact?.id },
                            });
                            if (error) throw error;
                            queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
                            queryClient.invalidateQueries({ queryKey: ["contact-detail"] });
                            toast.success("Бан снят");
                          } catch (e: any) {
                            toast.error("Ошибка: " + e.message);
                          } finally {
                            setIsBanning(false);
                          }
                        }}
                        disabled={isBanning}
                      >
                        {isBanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                        Снять бан
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : null}
            </TabsContent>

            {/* Telegram-вкладка вынесена выше — за пределы внешнего скролла */}


            {/* Email History Tab */}
            <TabsContent value="email" className="m-0 space-y-4">
              <ContactEmailHistory
                userId={contact.user_id}
                profileId={contact.id}
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

              {/* Current active access (subscriptions + entitlements) */}
              {(subsLoading || entLoading) ? (
                <div className="space-y-3">
                  {[1, 2].map(i => <Skeleton key={i} className="h-24 w-full" />)}
                </div>
              ) : !totalActiveAccess && !finishedSubscriptions.length && !finishedEntitlements.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Key className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>Нет доступов</p>
                </div>
              ) : (
                <>
                  {!totalActiveAccess && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      Нет текущих активных доступов
                    </div>
                  )}
                  {activeSubscriptions.map(sub => {
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
                                <span className="text-muted-foreground">Попытка списания: </span>
                                <span className="text-muted-foreground">{format(new Date(sub.next_charge_at), "dd.MM.yy")}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* Auto-renewal status with toggle button */}
                          {isActive && !isCanceled && (
                            <div className="flex items-center justify-between gap-2 mb-3 p-2 rounded-lg bg-muted/50 text-xs">
                              <div className="flex items-center gap-2">
                                {sub.auto_renew ? (
                                  <>
                                    <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                                    <span className="text-green-700">
                                      Автопродление включено{!sub.payment_method_id && " (нет карты)"}
                                    </span>
                                    {sub.charge_attempts > 0 && (
                                      <Badge variant="outline" className="text-amber-600 border-amber-200 text-xs">
                                        Попыток: {sub.charge_attempts}/3
                                      </Badge>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                                    <span className="text-muted-foreground">
                                      {sub.auto_renew_disabled_by 
                                        ? (
                                          <>
                                            Откл. {sub.auto_renew_disabled_by === 'admin' ? 'админом' : 'клиентом'}
                                            {sub.auto_renew_disabled_at && (
                                              <span className="ml-1 opacity-70">
                                                ({format(new Date(sub.auto_renew_disabled_at), "dd.MM.yy")})
                                              </span>
                                            )}
                                          </>
                                        )
                                        : "Автопродление отключено"
                                      }
                                    </span>
                                  </>
                                )}
                              </div>
                              {/* Toggle button — only for non-provider_managed subscriptions */}
                              {/* For provider_managed (bePaid) subscriptions, auto-renewal is managed by the payment provider — show info only */}
                              {sub.billing_type === 'provider_managed' ? (
                                <div className="flex items-center gap-1">
                                  <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">
                                    bePaid
                                  </Badge>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className={cn(
                                      "h-6 w-6 p-0",
                                      sub.auto_renew ? "text-green-600 hover:text-green-700" : "text-muted-foreground hover:text-primary"
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setAutoRenewTarget({
                                        subscriptionId: sub.id,
                                        currentValue: sub.auto_renew || false,
                                        productName: product?.name || "Продукт",
                                        hasPaymentMethod: !!(paymentMethods && paymentMethods.length > 0),
                                      });
                                      setAutoRenewConfirmOpen(true);
                                    }}
                                    title={sub.auto_renew ? "Отключить автопродление" : "Включить автопродление"}
                                  >
                                    <RefreshCw className={cn("w-3.5 h-3.5", sub.auto_renew && "animate-pulse")} />
                                  </Button>
                                  
                                  {/* Switch to provider-managed (bePaid) button */}
                                  {!contactProviderSubscriptions?.some((ps: any) => ps.subscription_v2_id === sub.id && ['active', 'trial', 'pending'].includes(ps.state)) && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        createProviderSubAdminMutation.mutate(sub.id);
                                      }}
                                      disabled={createProviderSubAdminMutation.isPending}
                                      title="Переключить на bePaid — для карт с 3D-Secure"
                                    >
                                      {createProviderSubAdminMutation.isPending ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                      ) : (
                                        <span className="text-xs">→ bePaid</span>
                                      )}
                                    </Button>
                                  )}
                                </div>
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
                  })}

                  {/* Active entitlements (order_based_only products not covered by subscriptions) */}
                  {activeEntitlements.map(ent => {
                    const product = ent.products_v2 as any;
                    const meta = ent.meta as Record<string, any> | null;
                    return (
                      <Card key={ent.id} className="transition-all border-l-2 border-l-blue-400">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="font-medium">{product?.name || ent.product_code || "Продукт"}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">доступ по продукту</Badge>
                                {meta?.source_rule_id && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-green-600 border-green-200">
                                    {(meta?.business_subscription_id || (meta?.source_rule_id === '1b497fba-031a-4318-8d9f-2530f1bac116' && (meta?.canonical_source === 'BUSINESS_subscription'))) ? "через BUSINESS" : "по правилу"}
                                  </Badge>
                                )}
                                {!meta?.source_rule_id && meta?.historical_purchase_type && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-200">прямая покупка</Badge>
                                )}
                                {!meta?.source_rule_id && meta?.scope_resolution_mode === 'module_scope_only' && !meta?.business_subscription_id && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-purple-600 border-purple-200">модульная покупка</Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Активен</Badge>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleDeleteEntitlement(ent.id, product?.name || ent.product_code || "Продукт", ent.product_id, (ent.meta as any)?.source_type, ent.order_id)}
                                disabled={isProcessing}
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                title="Удалить доступ по правилу"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Создан: </span>
                              <span>{format(new Date(ent.created_at), "dd.MM.yy")}</span>
                            </div>
                            {ent.expires_at && (
                              <div>
                                <span className="text-muted-foreground">До: </span>
                                <span>{format(new Date(ent.expires_at), "dd.MM.yy")}</span>
                              </div>
                            )}
                          </div>
                          {meta?.scope_resolution_mode === 'module_scope_only' && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Область доступа: Отдельные модули
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}

                  {/* Toggle for finished access */}
                  {(finishedSubscriptions.length > 0 || finishedEntitlements.length > 0) && (
                    <div className="pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowFinishedSubs(!showFinishedSubs)}
                        className="w-full gap-2 text-muted-foreground text-xs"
                      >
                        <History className="w-3.5 h-3.5" />
                        {showFinishedSubs ? "Скрыть завершённые" : `Показать завершённые (${finishedSubscriptions.length + finishedEntitlements.length})`}
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showFinishedSubs && "rotate-180")} />
                      </Button>
                      
                      {showFinishedSubs && (
                        <div className="space-y-3 mt-3 opacity-60">
                          {finishedSubscriptions.map(sub => {
                            const product = sub.products_v2 as any;
                            const tariff = sub.tariffs as any;
                            const isExpired = sub.access_end_at && new Date(sub.access_end_at) < new Date();
                            
                            return (
                              <Card key={sub.id} className="border-dashed">
                                <CardContent className="p-3">
                                  <div className="flex items-start justify-between mb-1">
                                    <div>
                                      <div className="font-medium text-sm">{product?.name || "Продукт"}</div>
                                      <div className="text-xs text-muted-foreground">{tariff?.name}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {getSubscriptionStatusBadge(sub)}
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => handleSubscriptionAction("delete", sub.id)}
                                        disabled={isProcessing}
                                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="flex gap-3 text-xs text-muted-foreground">
                                    <span>Начало: {format(new Date(sub.access_start_at), "dd.MM.yy")}</span>
                                    {sub.access_end_at && (
                                      <span className={isExpired ? "text-destructive" : ""}>
                                        До: {format(new Date(sub.access_end_at), "dd.MM.yy")}
                                      </span>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                          {finishedEntitlements.map(ent => {
                            const product = ent.products_v2 as any;
                            const isExpired = ent.expires_at && new Date(ent.expires_at) < new Date();
                            return (
                              <Card key={ent.id} className="border-dashed">
                                <CardContent className="p-3">
                                  <div className="flex items-start justify-between mb-1">
                                    <div>
                                      <div className="font-medium text-sm">{product?.name || ent.product_code || "Продукт"}</div>
                                      <div className="text-xs text-muted-foreground">
                                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">доступ по продукту</Badge>
                                      </div>
                                    </div>
                                    <Badge variant={isExpired ? "outline" : "secondary"}>
                                      {ent.status === 'active' && isExpired ? 'Истёк' : ent.status === 'expired' ? 'Истёк' : ent.status === 'active' ? 'Активен' : ent.status === 'revoked' ? 'Отозван' : ent.status}
                                    </Badge>
                                  </div>
                                  <div className="flex gap-3 text-xs text-muted-foreground">
                                    <span>Создан: {format(new Date(ent.created_at), "dd.MM.yy")}</span>
                                    {ent.expires_at && (
                                      <span className={isExpired ? "text-destructive" : ""}>
                                        До: {format(new Date(ent.expires_at), "dd.MM.yy")}
                                      </span>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* Payments Tab */}
            <TabsContent value="payments" className="m-0">
              <ContactPaymentsTab contactId={contact.id} userId={contact.user_id} />
            </TabsContent>

            {/* Deals Tab */}
            <TabsContent value="deals" className="m-0 space-y-3">
              <ContactDealsTab
                deals={deals}
                isLoading={dealsLoading}
                moduleMetaMap={moduleMetaMap}
                onOpenDeal={(id) => setSelectedDealId(id)}
                onEditDeal={(id) => setDealToEditId(id)}
                onRefund={(id) => setRefundDealId(id)}
              />
            </TabsContent>

            {/* Communications Tab */}
            <TabsContent value="communications" className="m-0 space-y-4">
              {/* Webinar Activity Section */}
              {resolvedUserId && (
                <WebinarActivitySection userId={resolvedUserId} isStaff={isStaffRole(authRole)} />
              )}

              {/* Notification Events Section */}
              {notificationEvents && notificationEvents.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Send className="w-4 h-4" />
                      Уведомления
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {notificationEvents.slice(0, 10).map((event: any) => (
                      <div key={event.id} className={cn(
                        "flex items-center justify-between p-2 rounded border-l-2",
                        event.channel === 'telegram' ? 'border-l-blue-500 bg-blue-50/50' : 'border-l-green-500 bg-green-50/50'
                      )}>
                        <div className="flex items-center gap-2">
                          {event.channel === 'telegram' ? (
                            <Send className="w-3.5 h-3.5 text-blue-500" />
                          ) : (
                            <Mail className="w-3.5 h-3.5 text-green-500" />
                          )}
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{getEventLabel(event.event_type)}</span>
                            <div className="flex items-center gap-1.5">
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-[10px] px-1.5 py-0",
                                  event.status === 'success' && 'bg-green-100 text-green-700 border-green-200',
                                  event.status === 'skipped' && 'bg-amber-100 text-amber-700 border-amber-200',
                                  event.status === 'failed' && 'bg-red-100 text-red-700 border-red-200',
                                )}
                              >
                                {event.status === 'success' ? 'Отправлено' : event.status === 'skipped' ? 'Пропущено' : 'Ошибка'}
                              </Badge>
                              {event.reason && (
                                <span className="text-xs text-muted-foreground">
                                  {event.reason === 'no_telegram_linked' ? 'TG не привязан' : 
                                   event.reason === 'no_link_bot_configured' ? 'Бот не настроен' : event.reason}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(event.created_at), "dd.MM HH:mm")}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Audit Events Section */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <History className="w-4 h-4" />
                    События
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
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
                      <div key={comm.id} className="p-3 border rounded-lg space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm">{getEventLabel(comm.action)}</span>
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
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
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

            {/* Loyalty Tab */}
            <TabsContent value="loyalty" className="m-0">
              <ContactLoyaltyTab contact={contact} />
            </TabsContent>

            {/* Artifacts Tab — Анкеты, обучение и вебинары */}
            <TabsContent value="artifacts" className="m-0">
              <ContactArtifactsTab
                profileId={contact.id}
                userId={contact.user_id}
                enabled={activeTab === "artifacts"}
                contactName={contact.full_name || undefined}
                isStaff={isStaffRole(authRole)}
              />
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
          deal={selectedDeal ?? null}
          profile={contact}
          open={dealSheetOpen}
          onOpenChange={(open) => { if (!open) setSelectedDealId(null); }}
        />

        {/* Refund Dialog */}
        {refundDeal && (
          <RefundDialog
            open={!!refundDealId}
            onOpenChange={(v) => { if (!v) setRefundDealId(null); }}
            orderId={refundDeal.id}
            orderNumber={refundDeal.order_number}
            amount={Number(refundDeal.final_price)}
            currency={refundDeal.currency}
            paymentProvider={(() => {
              const payments = (refundDeal as any).payments_v2 as any[] | undefined;
              const successfulPayment = payments?.find((p: any) => p.status === "succeeded");
              return successfulPayment?.provider || null;
            })()}
            onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["contact-deals"] });
              queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
              queryClient.invalidateQueries({ queryKey: ["deal-payments"] });
              setRefundDealId(null);
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
        {dealToEdit && (
          <EditDealDialog
            deal={dealToEdit}
            open={!!dealToEditId}
            onOpenChange={(v) => { if (!v) setDealToEditId(null); }}
            onSuccess={() => queryClient.invalidateQueries({ queryKey: ["contact-deals"] })}
          />
        )}

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

        {/* Admin Payment Link Dialog */}
        {contact.user_id && (
          <AdminPaymentLinkDialog
            open={paymentLinkDialogOpen}
            onOpenChange={setPaymentLinkDialogOpen}
            userId={contact.user_id}
            userName={contact.full_name || undefined}
            userEmail={contact.email || undefined}
            telegramUserId={resolvedTelegramUserId}
          />
        )}

        {/* Auto-renew toggle confirmation dialog */}
        <AlertDialog open={autoRenewConfirmOpen} onOpenChange={setAutoRenewConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {autoRenewTarget?.currentValue 
                  ? "Отключить автопродление?" 
                  : "Включить автопродление?"}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                {autoRenewTarget?.currentValue ? (
                  <>
                    <p>
                      Автопродление для <strong>{autoRenewTarget?.productName}</strong> будет отключено.
                    </p>
                    <p className="text-amber-600">
                      ⚠️ Списание с карты не произойдёт автоматически. Карта будет отвязана от подписки.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      Автопродление для <strong>{autoRenewTarget?.productName}</strong> будет включено.
                    </p>
                    {autoRenewTarget?.hasPaymentMethod ? (
                      <p className="text-green-600">
                        ✅ Карта клиента будет привязана для автоматического списания.
                      </p>
                    ) : (
                      <p className="text-amber-600">
                        ⚠️ У клиента нет привязанной карты. Списание не будет работать до привязки карты.
                      </p>
                    )}
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setAutoRenewConfirmOpen(false);
                setAutoRenewTarget(null);
              }}>
                Отмена
              </AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleToggleAutoRenew}
                disabled={isProcessing}
                className={autoRenewTarget?.currentValue ? "bg-destructive hover:bg-destructive/90" : ""}
              >
                {isProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {autoRenewTarget?.currentValue ? "Отключить" : "Включить"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* PATCH-B: bePaid Link Modal */}
        <Dialog open={bepaidLinkModalOpen} onOpenChange={setBepaidLinkModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Ссылка для клиента</DialogTitle>
              <DialogDescription>
                Скопируйте и отправьте клиенту. Клиент завершит оформление подписки на стороне bePaid.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Input 
                readOnly 
                value={bepaidLinkUrl || ''} 
                className="font-mono text-xs"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
            </div>
            <DialogFooter className="flex gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  if (bepaidLinkUrl) {
                    navigator.clipboard.writeText(bepaidLinkUrl);
                    toast.success('Ссылка скопирована');
                  }
                }}
                className="gap-2"
              >
                <Copy className="w-4 h-4" />
                Копировать
              </Button>
              <Button
                onClick={() => {
                  if (bepaidLinkUrl) {
                    window.open(bepaidLinkUrl, '_blank');
                  }
                }}
                className="gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Открыть
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>

    {/* Ban AlertDialog */}
    <AlertDialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="h-5 w-5" />
            Добавить в бан-лист
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                Все идентификаторы контакта будут добавлены в бан-лист. Повторная регистрация с этими данными будет автоматически заблокирована.
              </p>
              <div className="space-y-1 text-sm">
                {contact?.email && <div>Email: <strong>{contact.email}</strong></div>}
                {contact?.phone && <div>Телефон: <strong>{contact.phone}</strong></div>}
                {contact?.telegram_username && <div>Telegram: <strong>@{contact.telegram_username}</strong></div>}
              </div>
              <div className="space-y-1">
                <Label>Причина бана</Label>
                <Textarea
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                  placeholder="Укажите причину..."
                  rows={2}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90"
            disabled={isBanning}
            onClick={async (e) => {
              e.preventDefault();
              setIsBanning(true);
              try {
                const { error } = await supabase.functions.invoke("ban-list-manage", {
                  body: { action: "add", profileId: contact?.id, reason: banReason || undefined },
                });
                if (error) throw error;
                queryClient.invalidateQueries({ queryKey: ["admin-contacts"] });
                queryClient.invalidateQueries({ queryKey: ["contact-detail"] });
                toast.success("Контакт добавлен в бан-лист");
                setBanDialogOpen(false);
              } catch (err: any) {
                toast.error("Ошибка: " + err.message);
              } finally {
                setIsBanning(false);
              }
            }}
          >
            {isBanning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Забанить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
