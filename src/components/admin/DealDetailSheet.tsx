import { useEffect, useState, useMemo } from "react";
import { getDealDisplayName, getShortDisplayName } from "@/lib/deals/getDealDisplayName";
import { useModuleDisplayMeta } from "@/hooks/useModuleDisplayMeta";
import { ProductCategoryBadge } from "@/components/ui/ProductCategoryBadge";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { SHEET_SHELL_CLASS, getEntityShellClass } from "@/lib/sheetShell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import { useNavigate } from "react-router-dom";
import { format, parse } from "date-fns";
import { ru } from "date-fns/locale";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEffectiveDealDate } from "@/utils/getEffectiveDealDate";
import { getDealCommercialAmount } from "@/lib/payments/composableDealAmount";
import { useLiveContactSheet } from "@/hooks/useLiveContactSheet";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import { ContactFeedTab } from "@/components/admin/contact/ContactFeedTab";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  Calendar,
  CalendarDays,
  CreditCard,
  User,
  Mail,
  Phone,
  MessageCircle,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Copy,
  Download,
  Shield,
  Handshake,
  ExternalLink,
  Pencil,
  Trash2,
  RefreshCw,
  Receipt,
  Undo2,
  Search,
  Link2,
  Activity,
  Building2,
} from "lucide-react";
import { copyToClipboard as copyToClipboardUtil, getDealUrl } from "@/utils/clipboardUtils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EditDealDialog } from "./EditDealDialog";
import { LinkPaymentDialog } from "./payments/LinkPaymentDialog";
import { GrantAccessFromDealDialog } from "./GrantAccessFromDealDialog";
import { DealPayerDocumentsCard } from "./DealPayerDocumentsCard";
import { CrmTasksSection } from "./tasks/CrmTasksSection";
import { CallsHistorySection } from "./calls/CallsHistorySection";
import { CallButton } from "./calls/CallButton";
import { SmsButton } from "./sms/SmsButton";
import { ComposeEmailDialog } from "./ComposeEmailDialog";
import { PaymentReceiptButton } from "@/components/payments/PaymentReceiptButton";
import { usePermissions } from "@/hooks/usePermissions";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { getDealAuditErrorCode, useDealAuditLogs } from "@/hooks/useDealAuditLogs";

import { InternalInstallmentBlock } from "@/components/installments/InternalInstallmentBlock";

interface DealDetailSheetProps {
  deal: any | null;
  profile: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  draft: { label: "Черновик", color: "bg-muted text-muted-foreground", icon: Clock },
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/20 text-amber-600", icon: Clock },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600", icon: CheckCircle },
  partial: { label: "Частично оплачен", color: "bg-blue-500/20 text-blue-600", icon: AlertTriangle },
  cancelled: { label: "Отменён", color: "bg-red-500/20 text-red-600", icon: XCircle },
  refunded: { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: XCircle },
  expired: { label: "Истёк", color: "bg-muted text-muted-foreground", icon: XCircle },
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает", color: "bg-amber-500/20 text-amber-600" },
  processing: { label: "Обработка", color: "bg-blue-500/20 text-blue-600" },
  paid: { label: "Оплачен", color: "bg-green-500/20 text-green-600" },
  succeeded: { label: "Оплачен", color: "bg-green-500/20 text-green-600" },
  failed: { label: "Ошибка", color: "bg-red-500/20 text-red-600" },
  refunded: { label: "Возврат", color: "bg-muted text-muted-foreground" },
  canceled: { label: "Отменён", color: "bg-muted text-muted-foreground" },
};

const ACTION_LABELS: Record<string, string> = {
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
  "deal.sales_manager_changed": "Изменён менеджер продажи",
  "deal_sales_manager_assigned_on_create": "Назначен менеджер продажи",
  "trial.started": "Начало триала",
  "trial.ended": "Окончание триала",
};

const getActionLabel = (action: string): string => {
  return ACTION_LABELS[action] || action;
};

export function DealDetailSheet({ deal, profile, open, onOpenChange, onDeleted }: DealDetailSheetProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const { data: staff = [] } = useStaffOptions();
  const canReassignSales = hasPermission("deals.reassign");
  const navigate = useNavigate();
  const { selectedContact, contactSheetOpen, setContactSheetOpen, openContactSheet } = useLiveContactSheet();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteWithPayments, setDeleteWithPayments] = useState(false); // dangerous mode
  const [fetchingDocs, setFetchingDocs] = useState(false);
  const [linkPaymentDialogOpen, setLinkPaymentDialogOpen] = useState(false);
  const [grantAccessDialogOpen, setGrantAccessDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);
  const [responsibleId, setResponsibleId] = useState("__unassigned__");
  const [responsibleReason, setResponsibleReason] = useState("");

  useEffect(() => {
    setResponsibleId(deal?.responsible_user_id || "__unassigned__");
    setResponsibleReason("");
  }, [deal?.id, deal?.responsible_user_id]);

  const reassignSalesMutation = useMutation({
    mutationFn: async () => {
      if (!deal?.id) throw new Error("Сделка не найдена");
      if (!responsibleReason.trim()) throw new Error("Укажите причину изменения");
      const { data, error } = await supabase.rpc("set_deal_responsible_v1", {
        p_deal_id: deal.id,
        // Supabase's generated RPC type cannot express a required SQL UUID
        // argument that intentionally accepts NULL for "Без менеджера".
        p_responsible_user_id: (responsibleId === "__unassigned__" ? null : responsibleId) as string,
        p_reason: responsibleReason.trim(),
        p_source: "manual_reassignment",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Менеджер продажи обновлён");
      setResponsibleReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["deals-board"] });
      queryClient.invalidateQueries({ queryKey: ["deal-audit", deal?.id] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось изменить менеджера"),
  });



  const dealArr = useMemo(() => deal ? [{ id: deal.id, purchase_snapshot: deal.purchase_snapshot }] : [], [deal]);
  const { data: moduleMetaMap } = useModuleDisplayMeta(dealArr);
  const { data: linkedCompany } = useQuery({
    queryKey: ["deal-company", deal?.company_id],
    enabled: !!deal?.company_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("companies").select("id,public_id,full_name,phone,email").eq("id", deal.company_id).maybeSingle();
      if (error) throw error;
      return data as { id: string; public_id: string; full_name: string; phone: string | null; email: string | null } | null;
    },
  });

  // Check if current user is super_admin
  const { data: isSuperAdmin } = useQuery({
    queryKey: ['is-super-admin'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase.rpc('is_super_admin', { _user_id: user.id });
      return !!data;
    },
    staleTime: 60000,
  });

  // Fetch bePaid docs mutation
  const fetchBepaidDocsMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const { data, error } = await supabase.functions.invoke('bepaid-get-payment-docs', {
        body: { order_id: orderId, force_refresh: true },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.status === 'success') {
        toast.success('Документы получены из bePaid');
        queryClient.invalidateQueries({ queryKey: ['deal-payments', deal?.id] });
      } else if (data?.status === 'skipped') {
        toast.info('Документы уже загружены');
      } else {
        toast.error(data?.error || 'Ошибка получения документов');
      }
    },
    onError: (error: any) => {
      toast.error('Ошибка: ' + error.message);
    },
  });

  // Fetch full payments for this deal
  const { data: payments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["deal-payments", deal?.id],
    queryFn: async () => {
      if (!deal?.id) return [];
      const { data, error } = await supabase
        .from("payments_v2")
        .select("*")
        .eq("order_id", deal.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!deal?.id && open,
    staleTime: 30000,
  });

  // One CRM deal can contain a primary product and delayed add-on modules.
  // These rows make the already purchased, not-yet-opened modules visible to
  // the manager without creating a second deal or a premature entitlement.
  const { data: scheduledModuleAccesses, isLoading: scheduledModuleAccessesLoading } = useQuery({
    queryKey: ["deal-scheduled-module-accesses", deal?.id],
    enabled: !!deal?.id && open,
    queryFn: async () => {
      if (!deal?.id) return [];
      const { data: group, error: groupError } = await (supabase as any)
        .from("order_groups")
        .select("id")
        .eq("primary_order_id", deal.id)
        .maybeSingle();
      if (groupError) throw groupError;
      if (!group?.id) return [];
      const { data, error } = await (supabase as any)
        .from("scheduled_product_access")
        .select(`
          id, status, access_delivery_mode, opens_at, purchase_confirmed_at,
          products_v2:product_id(name, code), tariffs:tariff_id(name, code)
        `)
        .eq("order_group_id", group.id)
        .in("status", ["scheduled", "activating", "failed"])
        .order("purchase_confirmed_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // The primary CRM deal is the source of truth for the whole basket. Keep the
  // composition visible here instead of making managers search for child orders.
  const { data: dealComposition, isLoading: dealCompositionLoading } = useQuery({
    queryKey: ["deal-composition", deal?.id],
    enabled: !!deal?.id && open,
    queryFn: async () => {
      if (!deal?.id) return [];
      const { data: group, error: groupError } = await (supabase as any)
        .from("order_groups")
        .select("id")
        .eq("primary_order_id", deal.id)
        .maybeSingle();
      if (groupError) throw groupError;
      if (!group?.id) return [];
      const { data, error } = await (supabase as any)
        .from("order_group_items")
        .select(`
          id, role, sort_order, final_amount, item_snapshot,
          products_v2:product_id(name, code), tariffs:tariff_id(name, code)
        `)
        .eq("order_group_id", group.id)
        .order("sort_order");
      if (error) throw error;
      return data as any[];
    },
  });

  const openScheduledModuleMutation = useMutation({
    mutationFn: async (scheduledAccessId: string) => {
      const { data, error } = await supabase.functions.invoke("activate-scheduled-product-access", {
        body: { scheduled_access_id: scheduledAccessId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Не удалось открыть доступ");
      return data;
    },
    onSuccess: () => {
      toast.success("Доступ к модулю открыт");
      queryClient.invalidateQueries({ queryKey: ["deal-scheduled-module-accesses", deal?.id] });
      queryClient.invalidateQueries({ queryKey: ["deal-subscription", deal?.id] });
      queryClient.invalidateQueries({ queryKey: ["user-purchase-entitlements"] });
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось открыть доступ"),
  });

  // Fetch subscription for this deal
  const { data: subscription } = useQuery({
    queryKey: ["deal-subscription", deal?.id],
    queryFn: async () => {
      if (!deal?.id) return null;
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select("*")
        .eq("order_id", deal.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!deal?.id && open,
    staleTime: 30000,
  });

  // Read on opening the history tab, not from an earlier hidden-card cache.
  const {
    data: auditLogs,
    isLoading: auditLoading,
    isFetching: auditFetching,
    error: auditError,
    refetch: refetchAudit,
  } = useDealAuditLogs(deal?.id, open && activeTab === "history");

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} скопирован`);
  };

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deal?.id) throw new Error("No deal ID");

      console.log(`[DealDetailSheet] Starting deletion of deal: ${deal.id}`);

      // 0. Load order snapshot for notifications + telegram revoke + GetCourse cancel
      const { data: order, error: orderError } = await supabase
        .from("orders_v2")
        .select("id, user_id, product_id, order_number, status, customer_email, products_v2(name, code, telegram_club_id, public_id)")
        .eq("id", deal.id)
        .single();

      if (orderError) {
        console.error("[DealDetailSheet] Error fetching order:", orderError);
        throw new Error(`Не удалось найти сделку: ${orderError.message}`);
      }

      if (!order) {
        throw new Error("Сделка не найдена или уже удалена");
      }

      console.log(`[DealDetailSheet] Found order to delete:`, order.order_number);

      // 0.5 Cancel in GetCourse for paid orders BEFORE deleting
      if (order.status === "paid") {
        await supabase.functions
          .invoke("getcourse-cancel-deal", {
            body: { order_id: order.id, reason: "deal_deleted_by_admin" },
          })
          .catch(err => console.error("[DealDetailSheet] GetCourse cancel error:", err));
      }

      // 1. Get subscription IDs linked to this order
      const { data: subscriptions, error: subsError } = await supabase
        .from("subscriptions_v2")
        .select("id")
        .eq("order_id", order.id);

      if (subsError) {
        console.error("[DealDetailSheet] Error fetching subscriptions:", subsError);
      }

      const subscriptionIds = subscriptions?.map((s) => s.id) || [];
      console.log(`[DealDetailSheet] Found ${subscriptionIds.length} subscriptions to delete`);

      // 2. Delete installment payments for these subscriptions
      if (subscriptionIds.length > 0) {
        const { error: installError } = await supabase
          .from("installment_payments")
          .delete()
          .in("subscription_id", subscriptionIds);

        if (installError) {
          console.error("[DealDetailSheet] Error deleting installments:", installError);
        }
      }

      // 3. Delete subscriptions
      if (subscriptionIds.length > 0) {
        const { error: subsDeleteError } = await supabase
          .from("subscriptions_v2")
          .delete()
          .eq("order_id", order.id);

        if (subsDeleteError) {
          console.error("[DealDetailSheet] Error deleting subscriptions:", subsDeleteError);
          throw new Error(`Ошибка удаления подписок: ${subsDeleteError.message}`);
        }
        console.log(`[DealDetailSheet] Deleted subscriptions`);
      }

      // 4. Delete entitlements for affected user & product
      const orderProductCode = (order.products_v2 as any)?.code;
      if (order.user_id && orderProductCode) {
        const { error: entError } = await supabase
          .from("entitlements")
          .delete()
          .eq("user_id", order.user_id)
          .eq("product_code", orderProductCode);

        if (entError) {
          console.error("[DealDetailSheet] Error deleting entitlements:", entError);
        }
      }

      // 4.1 Check for other active deals before revoking Telegram access
      const telegramClubId = (order.products_v2 as any)?.telegram_club_id;

      if (order.user_id && telegramClubId) {
        // Check if user has other active deals with same product
        const { count: otherActiveDeals } = await supabase
          .from('orders_v2')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', order.user_id)
          .eq('product_id', order.product_id)
          .eq('status', 'paid')
          .neq('id', order.id);

        // Check for other active subscriptions
        const { count: activeSubscriptions } = await supabase
          .from('subscriptions_v2')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', order.user_id)
          .eq('product_id', order.product_id)
          .in('status', ['active', 'trial'])
          .neq('order_id', order.id);

        // Only revoke Telegram if no other active deals/subscriptions
        if (!otherActiveDeals && !activeSubscriptions) {
          await supabase.functions
            .invoke("telegram-revoke-access", {
              body: {
                user_id: order.user_id,
                club_id: telegramClubId,
                reason: "deal_deleted",
                is_manual: true,
                admin_id: (await supabase.auth.getUser()).data.user?.id,
              },
            })
            .catch(console.error);
        } else {
          console.log(`[DealDetailSheet] Skipping TG revoke: user has ${otherActiveDeals} other deals, ${activeSubscriptions} active subs`);
        }
      }

      // 4.2 Notify super_admins about deal deletion
      const productName = (order.products_v2 as any)?.name || "Продукт";
      await supabase.functions
        .invoke("telegram-notify-admins", {
          body: {
            message:
              `🗑 <b>Сделка удалена</b>\n\n` +
              `📧 ${order.customer_email || "N/A"}\n` +
              `📦 ${productName}\n` +
              `🧾 ${order.order_number}`,
            parse_mode: "HTML",
          },
        })
        .catch(console.error);

      // 5. Handle payments - DETACH by default, delete only if deleteWithPayments is true
      const { data: linkedPayments } = await supabase
        .from("payments_v2")
        .select("id, meta")
        .eq("order_id", order.id);

      const paymentsCount = linkedPayments?.length || 0;

      if (deleteWithPayments && paymentsCount > 0) {
        // DANGEROUS: Actually delete payments (super_admin only)
        console.log(`[DealDetailSheet] Deleting ${paymentsCount} payments (dangerous mode)`);
        const { error: paymentsError } = await supabase
          .from("payments_v2")
          .delete()
          .eq("order_id", order.id);

        if (paymentsError) {
          console.error("[DealDetailSheet] Error deleting payments:", paymentsError);
          throw new Error(`Ошибка удаления платежей: ${paymentsError.message}`);
        }
      } else if (paymentsCount > 0) {
        // SAFE DEFAULT: Detach payments (set order_id = NULL, preserve metadata)
        console.log(`[DealDetailSheet] Detaching ${paymentsCount} payments (safe mode)`);

        for (const pmt of linkedPayments || []) {
          const updatedMeta = {
            ...(pmt.meta as object || {}),
            deleted_order_id: order.id,
            deleted_order_number: order.order_number,
            detached_at: new Date().toISOString(),
          };

          const { error: detachError } = await supabase
            .from("payments_v2")
            .update({
              order_id: null,
              meta: updatedMeta,
            })
            .eq("id", pmt.id);

          if (detachError) {
            console.error("[DealDetailSheet] Error detaching payment:", detachError);
            // HARD GUARD: If detaching fails, STOP and do NOT delete the deal
            throw new Error(`Не удалось отвязать платёж ${pmt.id}: ${detachError.message}. Сделка НЕ удалена.`);
          }
        }
        console.log(`[DealDetailSheet] Successfully detached ${paymentsCount} payments`);
      }

      // 6. Delete order - CRITICAL STEP
      console.log(`[DealDetailSheet] Attempting to delete order: ${order.id}`);
      const { error } = await supabase
        .from("orders_v2")
        .delete()
        .eq("id", order.id);

      if (error) {
        console.error("[DealDetailSheet] CRITICAL: Failed to delete order:", error);
        throw new Error(`Не удалось удалить сделку: ${error.message}. Код: ${error.code}`);
      }

      console.log(`[DealDetailSheet] Successfully deleted order ${order.order_number}`);
    },
    onSuccess: () => {
      toast.success(deleteWithPayments ? "Сделка и платежи удалены" : "Сделка удалена (платежи сохранены)");
      setDeleteWithPayments(false); // Reset dangerous mode
      queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
      queryClient.invalidateQueries({ queryKey: ["contact-deals"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] }); // Refresh payments list
      onOpenChange(false);
      onDeleted?.();
    },
    onError: (error: any) => {
      console.error("[DealDetailSheet] Delete mutation error:", error);
      toast.error("Ошибка: " + (error?.message || String(error)));
    },
  });

  if (!deal) return null;

  // PATCH partial-refund-classifier-2026-05 (v2 — no double count):
  // paidSum: positive non-refund successful payments only.
  // refundedSum:
  //   1) parentRefundedSum = Σ parent.refunded_amount (canonical format, Patch 2)
  //   2) для legacy/orphan refund-row добавляем |amount| ТОЛЬКО если этот refund-row
  //      НЕ покрыт parent.refunded_amount (parent не найден или его refunded_amount = 0).
  // Это убирает двойной учёт, когда Patch 2 пишет одновременно
  // parent.refunded_amount += X и refund-row amount=-X.
  const refundTotals = (() => {
    if (!payments || payments.length === 0) return { paidSum: 0, refundedSum: 0 };
    const list = payments as any[];
    // index parent payments by id and by provider_payment_id (uid)
    const parentById = new Map<string, any>();
    const parentByUid = new Map<string, any>();
    for (const p of list) {
      if (p?.id) parentById.set(String(p.id), p);
      if (p?.provider_payment_id) parentByUid.set(String(p.provider_payment_id), p);
    }
    let paidSum = 0;
    let parentRefundedSum = 0;
    let legacyRefundedSum = 0;
    for (const p of list) {
      const status = (p?.status || '').toLowerCase();
      const txType = (p?.transaction_type || '').toLowerCase();
      const metaType = (p?.meta?.type || '').toLowerCase();
      const amount = Number(p?.amount) || 0;
      const isRefundRow = txType.includes('refund') || txType.includes('возврат')
        || metaType === 'refund' || amount < 0;
      if (!isRefundRow && amount > 0
        && (status === 'paid' || status === 'succeeded' || status === 'refunded')) {
        paidSum += amount;
      }
      // canonical: суммируем parent.refunded_amount (только non-refund rows, чтобы не учесть поле на самом refund-row)
      if (!isRefundRow) {
        parentRefundedSum += Number(p?.refunded_amount) || 0;
      }
      // legacy fallback: refund-row учитываем, только если его parent НЕ покрывает эту сумму
      if (isRefundRow) {
        const parentId = p?.meta?.parent_payment_id ? String(p.meta.parent_payment_id) : null;
        const parentUid = p?.meta?.parent_payment_uid ? String(p.meta.parent_payment_uid) : null;
        const parent = (parentId && parentById.get(parentId))
          || (parentUid && parentByUid.get(parentUid))
          || null;
        const parentRefunded = Number(parent?.refunded_amount) || 0;
        if (!parent || parentRefunded <= 0) {
          legacyRefundedSum += Math.abs(amount);
        }
      }
    }
    return { paidSum, refundedSum: parentRefundedSum + legacyRefundedSum };
  })();
  const isPartialRefund = refundTotals.refundedSum > 0
    && refundTotals.paidSum > 0
    && refundTotals.refundedSum + 0.01 < refundTotals.paidSum;
  const isFullRefund = refundTotals.refundedSum > 0
    && refundTotals.paidSum > 0
    && refundTotals.refundedSum + 0.01 >= refundTotals.paidSum;

  const baseStatusConfig = STATUS_CONFIG[deal.status] || { label: deal.status, color: "bg-muted", icon: Clock };
  const statusConfig = isPartialRefund
    ? { label: "Частичный возврат", color: "bg-amber-500/20 text-amber-600", icon: Undo2 }
    : isFullRefund
      ? { label: "Возврат", color: "bg-red-500/20 text-red-600", icon: Undo2 }
      : baseStatusConfig;
  const StatusIcon = statusConfig.icon;
  const product = deal.products_v2 as any;
  const tariff = deal.tariffs as any;

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={getEntityShellClass("deal")}>
        <SheetHeader className="p-4 sm:p-6 pb-4 pr-14 sm:pr-16">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center shrink-0">
                <Handshake className="w-5 h-5 sm:w-7 sm:h-7 text-primary" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-lg sm:text-xl flex items-center gap-2">
                  Сделка
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(deal.order_number, "Номер сделки");
                    }}
                    className="font-mono hover:bg-primary/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                    title="Скопировать номер без #"
                  >
                    #{deal.order_number}
                  </button>
                </SheetTitle>
                {(() => {
                  const effectiveDate = getEffectiveDealDate(deal, payments);
                  return (
                    <p className="text-xs sm:text-sm text-muted-foreground">
                      {format(new Date(effectiveDate), "dd MMMM yyyy, HH:mm", { locale: ru })}
                    </p>
                  );
                })()}
              </div>
            </div>
            <Badge className={`${statusConfig.color} shrink-0 mt-1 h-7 px-2.5 text-xs rounded-full`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusConfig.label}
            </Badge>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge
              variant="outline"
              className="cursor-pointer h-7 px-2 text-xs gap-1 hover:bg-accent"
              onClick={() => copyToClipboardUtil(getDealUrl(deal.id), "Ссылка на сделку скопирована")}
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
            <Badge
              variant="outline"
              className="cursor-pointer h-7 px-2.5 text-xs gap-1 border-destructive/30 text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="w-3 h-3" />
              Удалить
            </Badge>
          </div>

          {/* Месяц сделки (для контента, привязанного к месяцу) */}
          {(() => {
            const dealMonth = (deal.meta as any)?.deal_month as string | undefined;
            const isCurrent = dealMonth
              ? dealMonth === format(new Date(), "yyyy-MM")
              : false;
            return (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">Месяц сделки:</span>
                {dealMonth ? (
                  <Badge
                    variant="outline"
                    className={`h-7 px-2.5 text-xs gap-1 capitalize ${
                      isCurrent
                        ? "bg-violet-500/15 text-violet-700 border-violet-300 dark:text-violet-300"
                        : "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300"
                    }`}
                  >
                    <CalendarDays className="w-3 h-3" />
                    {(() => {
                      try {
                        return format(parse(`${dealMonth}-01`, "yyyy-MM-dd", new Date()), "LLLL yyyy", { locale: ru });
                      } catch {
                        return dealMonth;
                      }
                    })()}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="h-7 px-2.5 text-xs text-muted-foreground">
                    не задан
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className="cursor-pointer h-7 px-2 text-xs gap-1 hover:bg-accent"
                  onClick={() => setEditDialogOpen(true)}
                  title="Изменить месяц через редактор сделки"
                >
                  <Pencil className="w-3 h-3" />
                  изменить
                </Badge>
              </div>
            );
          })()}
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="border-b border-border/40 bg-background/30 backdrop-blur-sm sticky top-0 z-10 overflow-x-auto scrollbar-none">
            <TabsList className="mx-4 sm:mx-6 mt-0 mb-0 inline-flex w-auto whitespace-nowrap bg-transparent h-auto">
              <TabsTrigger value="overview" className="text-xs sm:text-sm px-2.5 sm:px-3"><Package className="mr-1 h-3.5 w-3.5" />Обзор</TabsTrigger>
              <TabsTrigger value="feed" className="text-xs sm:text-sm px-2.5 sm:px-3"><Activity className="mr-1 h-3.5 w-3.5" />Лента</TabsTrigger>
              <TabsTrigger value="tasks" className="text-xs sm:text-sm px-2.5 sm:px-3"><CheckCircle className="mr-1 h-3.5 w-3.5" />Задачи</TabsTrigger>
              <TabsTrigger value="calls" className="text-xs sm:text-sm px-2.5 sm:px-3"><Phone className="mr-1 h-3.5 w-3.5" />Звонки</TabsTrigger>
              <TabsTrigger value="history" className="text-xs sm:text-sm px-2.5 sm:px-3"><Clock className="mr-1 h-3.5 w-3.5" />История действий</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="flex-1 overflow-y-auto p-6 mt-0 data-[state=inactive]:hidden">
            <div className="space-y-6">
              {/* Contact & channels — canonical first section */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Контакт и каналы связи
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {linkedCompany && (
                  <>
                    <button type="button" onClick={() => navigate(`/admin/companies?company=${linkedCompany.id}`)} className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-2 text-left text-sm hover:bg-muted/50">
                      <Building2 className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate font-medium">{linkedCompany.full_name}</span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </button>
                    <Separator />
                  </>
                )}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      const contactUserId = profile?.user_id || deal?.user_id;
                      if (!contactUserId) return;
                      openContactSheet(contactUserId);
                    }}
                    disabled={!(profile?.user_id || deal?.user_id)}
                    className={cn(
                      "flex items-center gap-2 text-left",
                      (profile?.user_id || deal?.user_id) && "cursor-pointer hover:underline text-primary",
                      !(profile?.user_id || deal?.user_id) && "cursor-default"
                    )}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={profile?.avatar_url} alt={profile?.full_name} />
                      <AvatarFallback>
                        <User className="w-4 h-4 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    <span>
                      {profile?.full_name
                        || (profile?.name && profile?.surname ? `${profile.name} ${profile.surname}` : null)
                        || profile?.name
                        || deal?.meta?.customer_full_name
                        || deal?.meta?.card_holder
                        || deal?.customer_email
                        || profile?.email
                        || deal?.customer_phone
                        || profile?.phone
                        || "—"}
                    </span>
                    {(profile?.user_id || deal?.user_id) && <ExternalLink className="w-3 h-3" />}
                  </button>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{deal.customer_email || profile?.email || "—"}</span>
                  </div>
                  {(deal.customer_email || profile?.email) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={() => setComposeEmailOpen(true)}>
                        <Mail className="w-3 h-3 mr-1" />
                        Письмо
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7" onClick={() => copyToClipboard(deal.customer_email || profile?.email, "Email")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  )}

                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{deal.customer_phone || profile?.phone || "—"}</span>
                  </div>
                  {(deal.customer_phone || profile?.phone) && (
                    <div className="flex items-center gap-1 shrink-0">
                      <CallButton
                        phone={deal.customer_phone || profile?.phone}
                        dealId={deal.id}
                      />
                      <SmsButton
                        phone={deal.customer_phone || profile?.phone}
                        dealId={deal.id}
                      />
                    </div>
                  )}
                </div>

                {/* Customer data from bePaid import (from meta) */}
                {deal.meta && (deal.meta.customer_full_name || deal.meta.customer_email || deal.meta.customer_phone || deal.meta.card_holder) && (
                  <>
                    <Separator />
                    <div className="bg-muted/50 p-3 rounded-lg space-y-2">
                      <div className="text-xs font-medium text-muted-foreground uppercase mb-2">
                        Данные из платёжной системы
                      </div>
                      {deal.meta.customer_full_name && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">ФИО клиента:</span>
                          <span>{deal.meta.customer_full_name}</span>
                        </div>
                      )}
                      {deal.meta.customer_email && deal.meta.customer_email !== deal.customer_email && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Email bePaid:</span>
                          <span>{deal.meta.customer_email}</span>
                        </div>
                      )}
                      {deal.meta.customer_phone && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Телефон bePaid:</span>
                          <span>{deal.meta.customer_phone}</span>
                        </div>
                      )}
                      {deal.meta.card_holder && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Владелец карты:</span>
                          <span>{deal.meta.card_holder}</span>
                        </div>
                      )}
                      {deal.meta.purchased_at && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Дата покупки:</span>
                          <span>{format(new Date(deal.meta.purchased_at), "dd.MM.yyyy HH:mm", { locale: ru })}</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

              {/* Deal Info */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  Данные сделки
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">Менеджер продажи</span>
                    {!canReassignSales && (
                      <span className="text-sm font-medium">
                        {staff.find((item) => item.user_id === deal?.responsible_user_id)?.label || "Без менеджера"}
                      </span>
                    )}
                  </div>
                  {canReassignSales && (
                    <>
                      <Select value={responsibleId} onValueChange={setResponsibleId}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">Без менеджера</SelectItem>
                          {staff.map((item) => (
                            <SelectItem key={item.user_id} value={item.user_id}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={responsibleReason}
                        onChange={(event) => setResponsibleReason(event.target.value)}
                        placeholder="Причина изменения"
                      />
                      <Button
                        size="sm"
                        onClick={() => reassignSalesMutation.mutate()}
                        disabled={reassignSalesMutation.isPending || !responsibleReason.trim()}
                      >
                        {reassignSalesMutation.isPending && <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />}
                        Сохранить менеджера
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-muted-foreground shrink-0">Продукт</span>
                    <div className="text-right space-y-1">
                      <div className="flex items-center gap-1.5 justify-end flex-wrap">
                        <ProductCategoryBadge category={(deal?.products_v2 as any)?.category} />
                        <span className="font-medium">{getShortDisplayName(getDealDisplayName({
                          productsV2: deal?.products_v2 as any,
                          productName: product?.name,
                          purchaseSnapshot: deal?.purchase_snapshot,
                          moduleProduct: moduleMetaMap?.get(deal?.id)?.moduleProduct,
                        }), (deal?.products_v2 as any)?.category)}</span>
                      </div>
                      {deal?.product_id && (() => {
                        const meta = moduleMetaMap?.get(deal.id);
                        const displayPublicId = (meta?.resolutionType === "direct_module" && meta.resolvedPublicId)
                          ? meta.resolvedPublicId
                          : (deal.products_v2 as any)?.public_id || deal.product_id.substring(0, 8);
                        const copyValue = meta?.resolvedModuleProductId || deal.product_id;
                        return <CopyableIdChip value={displayPublicId} copyValue={copyValue} successMessage="Product ID скопирован" />;
                      })()}
                    {(() => {
                      const snapshot = deal?.purchase_snapshot as Record<string, any> | null;
                      const meta = deal?.meta as Record<string, any> | null;
                      if (meta?.split_status === 'children_created') {
                        return (
                          <>
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 ml-2">📦 Разделена на модули</Badge>
                            {meta?.split_child_order_ids && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({(meta.split_child_order_ids as string[])?.length || 0} child orders)
                              </span>
                            )}
                          </>
                        );
                      }
                      if (meta?.split_from_order_id) {
                        return (
                          <>
                            <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-300 ml-2">📄 Модуль (split)</Badge>
                            <span className="text-[10px] text-muted-foreground ml-1">
                              от {meta.split_from_order_number || 'parent'}
                            </span>
                          </>
                        );
                      }
                      if (snapshot?.historical_purchase_type === 'module_only_standalone') {
                        return (
                          <>
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 ml-2">
                              Модульная покупка
                            </Badge>
                            {!snapshot?.display_purchase_name && (
                              <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-400 bg-amber-50 ml-1">⚠ Historical name missing</Badge>
                            )}
                          </>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Тариф</span>
                  <span className="font-medium">{tariff?.name || "—"}</span>
                </div>
                {tariff?.access_days && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Период</span>
                      <span>{tariff.access_days} дней</span>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Базовая цена</span>
                  <span>
                    {(() => {
                      const n = Number(deal.base_price);
                      const cur = deal.currency || "BYN";
                      if (!Number.isFinite(n)) return "—";
                      try {
                        return new Intl.NumberFormat("ru-BY", { style: "currency", currency: cur }).format(n);
                      } catch {
                        return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
                      }
                    })()}
                  </span>
                </div>
                {deal.discount_percent && Number(deal.discount_percent) > 0 && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Скидка</span>
                      <span className="text-green-600">-{deal.discount_percent}%</span>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Итого</span>
                  <span className="font-bold text-lg">
                    {(() => {
                      const n = getDealCommercialAmount(deal);
                      const cur = deal.currency || "BYN";
                      if (!Number.isFinite(n)) return "—";
                      try {
                        return new Intl.NumberFormat("ru-BY", { style: "currency", currency: cur }).format(n);
                      } catch {
                        return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
                      }
                    })()}
                  </span>
                </div>
                {deal.is_trial && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Trial до</span>
                      <Badge variant="outline" className="text-blue-600 border-blue-500/30">
                        {deal.trial_end_at ? format(new Date(deal.trial_end_at), "dd.MM.yy") : "—"}
                      </Badge>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Removed duplicate Contact card — moved to top as Контакт и каналы связи */}


            {/* Внутренняя рассрочка (canonical bepaid finite subscription) */}
            {(dealCompositionLoading || (dealComposition?.length ?? 0) > 0) && (
              <Card className="border-primary/15">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    Состав заказа
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dealCompositionLoading ? <Skeleton className="h-16 w-full" /> : dealComposition?.map((item: any) => {
                    const snapshot = (item.item_snapshot && typeof item.item_snapshot === "object") ? item.item_snapshot : {};
                    const price = Number(item.final_amount);
                    const label = item.products_v2?.name || snapshot.product_name || "Продукт";
                    return (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{label}</span>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {item.role === "primary" ? "Основной" : "Модуль"}
                            </Badge>
                          </div>
                          {(item.tariffs?.name || snapshot.tariff_name) && (
                            <p className="text-xs text-muted-foreground mt-0.5">{item.tariffs?.name || snapshot.tariff_name}</p>
                          )}
                        </div>
                        {Number.isFinite(price) && price > 0 && (
                          <span className="shrink-0 text-sm font-medium">
                            {price.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {deal.currency || "BYN"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            <InternalInstallmentBlock order={deal} />

            {(scheduledModuleAccessesLoading || (scheduledModuleAccesses?.length ?? 0) > 0) && (
              <Card className="border-primary/15 bg-primary/[0.02]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    Купленные модули с отложенным доступом
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {scheduledModuleAccessesLoading ? <Skeleton className="h-20 w-full" /> : scheduledModuleAccesses?.map((access: any) => {
                    const isFixedDate = access.access_delivery_mode === "fixed_date";
                    const notice = isFixedDate && access.opens_at
                      ? `Автоматическое открытие: ${format(new Date(access.opens_at), "d MMMM yyyy 'в' HH:mm", { locale: ru })}`
                      : "Откроется вручную администратором";
                    return (
                      <div key={access.id} className="rounded-lg border bg-background p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-sm">{access.products_v2?.name || "Дополнительный модуль"}</div>
                            {access.tariffs?.name && <div className="text-xs text-muted-foreground mt-0.5">{access.tariffs.name}</div>}
                          </div>
                          <Badge variant="outline" className="shrink-0 text-amber-700 border-amber-300">Куплен</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{notice}</p>
                        {access.access_delivery_mode === "manual" && (
                          <Button
                            size="sm"
                            onClick={() => openScheduledModuleMutation.mutate(access.id)}
                            disabled={openScheduledModuleMutation.isPending}
                          >
                            <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                            Открыть доступ сейчас
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Payments */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    Оплаты {payments?.length ? `(${payments.length})` : ""}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinkPaymentDialogOpen(true)}
                  >
                    <Search className="w-3 h-3 mr-1" />
                    Привязать платёж
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {paymentsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !payments?.length ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Нет платежей
                  </div>
                ) : (
                  <div className="space-y-3">
                    {payments.map((payment) => {
                      const paymentStatusConfig =
                        PAYMENT_STATUS_CONFIG[payment.status] || { label: payment.status, color: "bg-muted" };
                      // Priority: new receipt_url column > fallback to provider_response
                      const receiptUrl = (payment as any)?.receipt_url ||
                                        (payment as any)?.provider_response?.transaction?.receipt_url;
                      const isBepaid = (payment as any)?.provider === 'bepaid';
                      const receiptProvider = String((payment as any)?.provider ?? '').toLowerCase();
                      const canResolveReceipt = payment.status === 'succeeded' && (
                        receiptProvider === 'stripe' || (receiptProvider === 'bepaid' && !!receiptUrl)
                      );
                      const refunds = ((payment as any)?.refunds || []) as any[];
                      const refundedAmount = Number((payment as any)?.refunded_amount) || 0;

                      return (
                        <div
                          key={payment.id}
                          className="p-3 rounded-lg bg-muted/50 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {new Intl.NumberFormat("ru-BY", {
                                    style: "currency",
                                    currency: payment.currency,
                                  }).format(Number(payment.amount))}
                                </span>
                                <Badge className={cn("text-xs", paymentStatusConfig.color)}>
                                  {paymentStatusConfig.label}
                                </Badge>
                                {refundedAmount > 0 && (
                                  <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">
                                    <Undo2 className="w-3 h-3 mr-1" />
                                    -{refundedAmount.toFixed(2)}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {payment.card_brand && `${payment.card_brand} •••• ${payment.card_last4}`}
                                {payment.installment_number && ` • Платёж ${payment.installment_number}`}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2">
                              <div className="text-xs text-muted-foreground">
                                {payment.paid_at
                                  ? format(new Date(payment.paid_at), "dd.MM.yy HH:mm")
                                  : format(new Date(payment.created_at), "dd.MM.yy HH:mm")}
                              </div>
                              <div className="flex items-center gap-1">
                                {canResolveReceipt ? (
                                  <PaymentReceiptButton paymentId={payment.id} label="Открыть чек" />
                                ) : isBepaid && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fetchBepaidDocsMutation.mutate(deal.id)}
                                    disabled={fetchBepaidDocsMutation.isPending}
                                  >
                                    {fetchBepaidDocsMutation.isPending ? (
                                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                                    ) : (
                                      <Download className="w-4 h-4 mr-2" />
                                    )}
                                    Получить чек
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Refunds section */}
                          {refunds.length > 0 && (
                            <div className="border-t pt-2 mt-2">
                              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                                <Undo2 className="w-3 h-3" />
                                Возвраты ({refunds.length})
                              </div>
                              <div className="space-y-1">
                                {refunds.map((refund: any, idx: number) => (
                                  <div key={refund.refund_id || idx} className="flex items-center justify-between text-xs bg-orange-500/5 p-2 rounded">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">
                                        {refund.amount?.toFixed(2)} {refund.currency || 'BYN'}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-[10px]",
                                          refund.status === 'succeeded' && "text-green-600 border-green-300",
                                          refund.status === 'pending' && "text-amber-600 border-amber-300",
                                          refund.status === 'failed' && "text-red-600 border-red-300"
                                        )}
                                      >
                                        {refund.status === 'succeeded' ? 'Выполнен' :
                                         refund.status === 'pending' ? 'В обработке' :
                                         refund.status === 'failed' ? 'Ошибка' : refund.status}
                                      </Badge>
                                      {refund.reason && (
                                        <span className="text-muted-foreground">{refund.reason}</span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-muted-foreground">
                                        {refund.created_at && format(new Date(refund.created_at), "dd.MM.yy HH:mm")}
                                      </span>
                                      {refund.receipt_url && (
                                        <Button variant="ghost" size="sm" className="h-6 px-2" asChild>
                                          <a href={refund.receipt_url} target="_blank" rel="noopener noreferrer">
                                            <Receipt className="w-3 h-3" />
                                          </a>
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Refresh from bePaid button */}
                          {isBepaid && payment.status === 'succeeded' && (
                            <div className="flex justify-end pt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-xs h-7"
                                onClick={() => fetchBepaidDocsMutation.mutate(deal.id)}
                                disabled={fetchBepaidDocsMutation.isPending}
                              >
                                <RefreshCw className={cn("w-3 h-3 mr-1", fetchBepaidDocsMutation.isPending && "animate-spin")} />
                                Обновить из bePaid
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Access / Subscription */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Доступ
                </CardTitle>
              </CardHeader>
              <CardContent>
                {subscription ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Статус</span>
                      <Badge variant={subscription.status === "active" ? "default" : "secondary"}>
                        {subscription.status}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Начало</span>
                      <span>{format(new Date(subscription.access_start_at), "dd.MM.yy")}</span>
                    </div>
                    {subscription.access_end_at && (
                      <>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Окончание</span>
                          <span>{format(new Date(subscription.access_end_at), "dd.MM.yy")}</span>
                        </div>
                      </>
                    )}
                    {/* Next charge date with fallback calculation */}
                    {(() => {
                      // Check if auto-renewal is active
                      const isCanceled = subscription.status === 'canceled' || subscription.status === 'expired';
                      const autoRenewalOff = subscription.auto_renew === false;

                      if (isCanceled || autoRenewalOff) {
                        return (
                          <>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Списание</span>
                              <span className="text-xs text-muted-foreground">Автопродление выключено</span>
                            </div>
                          </>
                        );
                      }

                      // Priority: next_charge_at from subscription
                      if (subscription.next_charge_at) {
                        return (
                          <>
                            <Separator />
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Следующее списание</span>
                              <span>{format(new Date(subscription.next_charge_at), "dd.MM.yy")}</span>
                            </div>
                          </>
                        );
                      }

                      // Fallback: calculate from last payment + billing period
                      // Default to access_end_at - 3 days (standard billing logic)
                      if (subscription.access_end_at && subscription.status === 'active') {
                        const accessEnd = new Date(subscription.access_end_at);
                        const calculatedChargeDate = new Date(accessEnd.getTime() - 3 * 24 * 60 * 60 * 1000);

                        // Only show if in the future
                        if (calculatedChargeDate > new Date()) {
                          return (
                            <>
                              <Separator />
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Списание (расчёт)</span>
                                <span className="text-amber-600">{format(calculatedChargeDate, "dd.MM.yy")}</span>
                              </div>
                            </>
                          );
                        }
                      }

                      return null;
                    })()}
                  </div>
                ) : (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-muted-foreground text-sm">Подписка не создана</p>
                    {deal.status === "paid" && deal.user_id && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setGrantAccessDialogOpen(true)}
                      >
                        <Shield className="w-4 h-4 mr-2" />
                        Выдать доступ
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Documents — единая карточка */}
            <DealPayerDocumentsCard orderId={deal.id} />

            {/* ID Info */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">ID сделки</span>
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(deal.id, "ID")}>
                    <code className="text-xs mr-2">{deal.id.slice(0, 8)}...</code>
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            </div>
          </TabsContent>

          {/* Лента — единая amoCRM-подобная лента (переиспользует ContactFeedTab) */}
          <TabsContent value="feed" className="p-3 sm:p-4 mt-0 flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
            <ContactFeedTab
              dealId={deal.id}
              contactId={deal.profile_id ?? profile?.id ?? undefined}
              companyId={deal.company_id ?? undefined}
              embedded
            />
          </TabsContent>

          {/* Задачи по сделке (переиспользует CrmTasksSection) */}
          <TabsContent value="tasks" className="flex-1 overflow-y-auto p-4 sm:p-6 mt-0 data-[state=inactive]:hidden">
            <CrmTasksSection dealId={deal.id} />
          </TabsContent>

          {/* Звонки по сделке (переиспользует CallsHistorySection, VOCHI Phase 2) */}
          <TabsContent value="calls" className="flex-1 overflow-y-auto p-4 sm:p-6 mt-0 data-[state=inactive]:hidden">
            <CallsHistorySection dealId={deal.id} />
          </TabsContent>

          {/* История действий — audit_logs */}
          <TabsContent value="history" className="flex-1 overflow-y-auto p-4 sm:p-6 mt-0 data-[state=inactive]:hidden">
            <Card>
              <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  История действий
                </CardTitle>
                <Button type="button" variant="ghost" size="sm" onClick={() => refetchAudit()} disabled={auditFetching}>
                  <RefreshCw className={`mr-2 h-3.5 w-3.5 ${auditFetching ? "animate-spin" : ""}`} />
                  Обновить историю
                </Button>
              </CardHeader>
              <CardContent>
                {auditLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : auditError ? (
                  <div role="alert" className="space-y-2 py-4 text-sm">
                    <p>Не удалось загрузить историю действий. Это не означает, что записи отсутствуют.</p>
                    <p className="text-muted-foreground">Код: {getDealAuditErrorCode(auditError)}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => refetchAudit()} disabled={auditFetching}>
                      Повторить загрузку
                    </Button>
                  </div>
                ) : !auditLogs?.length ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    Нет записей
                  </div>
                ) : (
                  <div className="space-y-2">
                    {auditLogs.map((log: any) => (
                      <div key={log.id} className="p-3 rounded-lg bg-muted/30 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm">{getActionLabel(log.action)}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(log.created_at), "dd.MM HH:mm")}
                          </span>
                        </div>
                        {(log.actor_profile || log.actor_label) && (
                          <div className="text-xs text-muted-foreground">
                            <span>Выполнил: </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (!log.actor_user_id) return;
                                onOpenChange(false);
                                navigate(`/admin/contacts?contact=${log.actor_user_id}`);
                              }}
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              {log.actor_profile?.full_name || log.actor_label || log.actor_profile?.email || "Сотрудник"}
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        {log.action === "deal.sales_manager_changed" && (
                          <div className="text-xs text-muted-foreground">
                            {(log.meta?.old_responsible_name || "Без менеджера")}
                            {" → "}
                            {(log.meta?.new_responsible_name || "Без менеджера")}
                            {log.meta?.changed_payment_count != null && ` · платежей: ${log.meta.changed_payment_count}`}
                            {log.meta?.reason && ` · ${log.meta.reason}`}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </SheetContent>


      {/* Edit Dialog */}
      <EditDealDialog
        deal={deal}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
          queryClient.invalidateQueries({ queryKey: ["contact-deals"] });
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) setDeleteWithPayments(false); // Reset on close
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить сделку?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Будут удалены: сделка #{deal.order_number}, связанные подписки и права доступа.
              </p>
              <p className="font-medium text-foreground">
                Платежи будут отвязаны, но сохранены в системе для возможности пересоздания сделки.
              </p>
              {isSuperAdmin && (
                <div className="mt-4 p-3 border border-destructive/50 rounded-md bg-destructive/5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={deleteWithPayments}
                      onChange={(e) => setDeleteWithPayments(e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-destructive font-medium">
                      ⚠️ Удалить также платежи (необратимо)
                    </span>
                  </label>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className={cn(
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                deleteWithPayments && "bg-red-700 hover:bg-red-800"
              )}
            >
              {deleteWithPayments ? "Удалить всё" : "Удалить сделку"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Link Payment Dialog */}
      <LinkPaymentDialog
        open={linkPaymentDialogOpen}
        onOpenChange={setLinkPaymentDialogOpen}
        orderId={deal.id}
        orderNumber={deal.order_number}
        orderAmount={deal.final_price}
        orderCurrency={deal.currency}
        profileId={deal.profile_id}
        userId={deal.user_id}
        existingPaymentsCount={payments?.length || 0}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["deal-payments", deal.id] });
          queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
          queryClient.invalidateQueries({ queryKey: ["contact-deals"] });
          setLinkPaymentDialogOpen(false);
        }}
      />

      {/* Grant Access Dialog */}
      <GrantAccessFromDealDialog
        open={grantAccessDialogOpen}
        onOpenChange={setGrantAccessDialogOpen}
        deal={{
          id: deal.id,
          order_number: deal.order_number,
          user_id: deal.user_id,
          profile_id: deal.profile_id,
          product_id: deal.product_id,
          tariff_id: deal.tariff_id,
          status: deal.status,
          deal_date: deal.deal_date,
          created_at: deal.created_at,
        }}
        tariff={tariff ? { access_days: tariff.access_days, name: tariff.name } : null}
        existingSubscription={subscription}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["deal-subscription", deal.id] });
          queryClient.invalidateQueries({ queryKey: ["deal-audit", deal.id] });
          queryClient.invalidateQueries({ queryKey: ["admin-deals"] });
          queryClient.invalidateQueries({ queryKey: ["contact-deals"] });
        }}
      />
    </Sheet>
    <ContactDetailSheet
      contact={selectedContact}
      open={contactSheetOpen}
      onOpenChange={setContactSheetOpen}
    />
    <ComposeEmailDialog
      recipientEmail={deal.customer_email || profile?.email || null}
      recipientName={deal?.meta?.customer_full_name || profile?.full_name || null}
      open={composeEmailOpen}
      onOpenChange={setComposeEmailOpen}
    />
    </>

  );
}
