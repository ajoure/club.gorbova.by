import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GlassCard } from "@/components/ui/GlassCard";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  ArrowLeft, Plus, Tag, MousePointer, Users, Eye, Globe, CreditCard, ChevronDown, Calendar, Bell, RefreshCw, Settings2, FolderTree, Pencil, Trash2, ChevronRight, X, EyeOff, Power, PowerOff, GripVertical, Shield
} from "lucide-react";
import { ProductAccessRulesTab } from "@/components/admin/product/ProductAccessRulesTab";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableTariffItem } from "@/components/admin/product/SortableTariffItem";
import { ProductCustomFields } from "@/components/products/ProductCustomFields";
import { ProductCompositionTab } from "@/components/products/ProductCompositionTab";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TariffFeaturesEditor } from "@/components/admin/TariffFeaturesEditor";
import { TariffCardCompact } from "@/components/admin/product/TariffCardCompact";
import { OfferRowCompact } from "@/components/admin/product/OfferRowCompact";
import { TariffCard } from "@/components/landing/TariffCard";
import { TariffCarouselGrid } from "@/components/landing/TariffCarouselGrid";
import { UniversalPricingSection } from "@/components/landing/UniversalPricingSection";
import { buildTariffCardViewModel, type CardConfig } from "@/lib/tariffCardViewModel";
import { SelectionBox } from "@/components/admin/SelectionBox";
import { SortPill } from "@/components/admin/SortPill";
import { TariffDeleteConfirmDialog } from "@/components/admin/TariffDeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTableSort } from "@/hooks/useTableSort";
import { useDragSelect } from "@/hooks/useDragSelect";
import { type TariffMetaConfig } from "@/components/admin/product/TariffWelcomeMessageEditor";
import { OfferWelcomeMessageEditor } from "@/components/admin/product/OfferWelcomeMessageEditor";
import { OfferCrmRoutingSection, validateCrmRoutingForSave } from "@/components/admin/OfferCrmRoutingSection";
import { OfferDocumentDefaultsCard } from "@/components/admin/product/OfferDocumentDefaultsCard";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CopyableIdChip } from "@/components/ui/CopyableIdChip";
import { ProductSitePageBinding } from "@/components/admin/product/ProductSitePageBinding";
import { getStatusBadgeClass } from "@/utils/badgeUtils";
import {
  useProductV2,
  useUpdateProductV2,
  useTariffs, useCreateTariff, useUpdateTariff, useDeleteTariff, useReorderTariffs,
  useFlows, useCreateFlow, useUpdateFlow, useDeleteFlow,
} from "@/hooks/useProductsV2";
import {
  useProductOffers,
  useCreateTariffOffer,
  useUpdateTariffOffer,
  useDeleteTariffOffer,
  useSetPrimaryOffer,
  type TariffOffer,
  type TariffOfferInsert,
  type PaymentMethod,
  type OfferMetaConfig,
} from "@/hooks/useTariffOffers";
import { isFeatureVisible, type TariffFeature } from "@/hooks/useTariffFeatures";

export default function AdminProductDetailV2() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  // Deep-link: read tab from query params
  const tabFromQuery = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState(tabFromQuery || "tariffs");

  // Sync tab from query params on navigation
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && ["tariffs", "offers", "flows", "preview", "custom_fields", "composition", "access_rules"].includes(t)) {
      setActiveTab(t);
    }
  }, [searchParams]);

  // Controlled open for access rules tab (create/edit from external navigation)
  const accessRulesAction = (location.state as any)?.accessRulesAction as
    | { type: "create_training_content"; targetRef?: string }
    | { type: "edit_rule"; ruleId: string }
    | undefined;

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Update URL without full navigation
    const newParams = new URLSearchParams(searchParams);
    if (value === "tariffs") {
      newParams.delete("tab");
    } else {
      newParams.set("tab", value);
    }
    setSearchParams(newParams, { replace: true });
  };

  const { data: product, isLoading: productLoading } = useProductV2(productId || null);
  const { data: tariffs } = useTariffs(productId);
  const { data: flows } = useFlows(productId);
  const { data: offers } = useProductOffers(productId);
  
  // Fetch tariff features for preview
  const { data: allTariffFeatures } = useQuery({
    queryKey: ["preview-tariff-features", productId],
    queryFn: async () => {
      if (!productId) return [] as TariffFeature[];
      const { data: tariffList } = await supabase
        .from("tariffs")
        .select("id")
        .eq("product_id", productId);
      if (!tariffList?.length) return [] as TariffFeature[];
      const tariffIds = tariffList.map(t => t.id);
      const { data, error } = await supabase
        .from("tariff_features" as any)
        .select("*")
        .in("tariff_id", tariffIds)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as TariffFeature[];
    },
    enabled: !!productId,
  });

  // Mutations
  const createTariff = useCreateTariff();
  const updateTariff = useUpdateTariff();
  const deleteTariff = useDeleteTariff();
  const reorderTariffs = useReorderTariffs();

  // DnD sensors for tariff reorder
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleTariffDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !tariffs?.length) return;

    const oldIndex = tariffs.findIndex(t => t.id === active.id);
    const newIndex = tariffs.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...tariffs];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    const updates = reordered.map((t, i) => ({ id: t.id, sort_order: i }));
    reorderTariffs.mutate(updates);
  }, [tariffs, reorderTariffs]);
  const createFlow = useCreateFlow();
  const updateFlow = useUpdateFlow();
  const deleteFlow = useDeleteFlow();
  const createOffer = useCreateTariffOffer();
  const updateOffer = useUpdateTariffOffer();
  const deleteOffer = useDeleteTariffOffer();
  const setPrimaryOffer = useSetPrimaryOffer();

  // Dialog states
  const [tariffDialog, setTariffDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [offerDialog, setOfferDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [flowDialog, setFlowDialog] = useState<{ open: boolean; editing: any }>({ open: false, editing: null });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState<{ type: "tariff" | "offer" | "flow"; ids: string[] } | null>(null);

  // === Sorting (client-side, in-memory) ===
  const offerSort = useTableSort<any>({ data: offers || [] });
  const flowSort = useTableSort<any>({ data: flows || [] });

  // Client sort helper
  const clientSort = useCallback((items: any[], sortKey: string | null, sortDir: "asc" | "desc" | null) => {
    if (!sortKey || !sortDir) return items;
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name" || sortKey === "code") {
        cmp = String(a[sortKey] || "").localeCompare(String(b[sortKey] || ""), "ru");
      } else if (sortKey === "is_active") {
        cmp = (a.is_active === b.is_active) ? 0 : a.is_active ? -1 : 1;
      } else if (sortKey === "amount") {
        cmp = (a.amount ?? 0) - (b.amount ?? 0);
      } else if (sortKey === "offer_type") {
        const order: Record<string, number> = { pay_now: 0, trial: 1, preregistration: 2 };
        cmp = (order[a.offer_type] ?? 9) - (order[b.offer_type] ?? 9);
      } else if (sortKey === "start_date") {
        const aD = a.start_date ? new Date(a.start_date).getTime() : Infinity;
        const bD = b.start_date ? new Date(b.start_date).getTime() : Infinity;
        cmp = aD - bD;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
  }, []);

  // Sorted arrays — tariffs use sort_order only (no client sort)
  const sortedTariffs = useMemo(() => tariffs || [], [tariffs]);
  const sortedFlows = useMemo(() => clientSort(flows || [], flowSort.sortKey, flowSort.sortDirection), [flows, flowSort.sortKey, flowSort.sortDirection, clientSort]);
  // allOffers flat for selection/bulk (sorted offers used inside groups for UI)
  const allOffers = useMemo(() => offers ?? [], [offers]);

  // === Selection (3 independent stores) ===
  const tariffSelect = useDragSelect({ items: sortedTariffs, getItemId: (t: any) => t.id });
  const offerSelect = useDragSelect({ items: allOffers, getItemId: (o: any) => o.id });
  const flowSelect = useDragSelect({ items: sortedFlows, getItemId: (f: any) => f.id });

  // === Bulk action handlers ===
  const handleBulkActivate = useCallback(async (type: "tariff" | "offer" | "flow") => {
    const select = type === "tariff" ? tariffSelect : type === "offer" ? offerSelect : flowSelect;
    const ids = Array.from(select.selectedIds);
    if (ids.length > 50 && !confirm(`Выбрано ${ids.length}. Продолжить?`)) return;
    const mutate = type === "tariff" ? updateTariff : type === "offer" ? updateOffer : updateFlow;
    await Promise.all(ids.map(id => mutate.mutateAsync({ id, is_active: true })));
    select.clearSelection();
    toast.success(`Активировано: ${ids.length}`);
  }, [tariffSelect, offerSelect, flowSelect, updateTariff, updateOffer, updateFlow]);

  const handleBulkDeactivate = useCallback(async (type: "tariff" | "offer" | "flow") => {
    const select = type === "tariff" ? tariffSelect : type === "offer" ? offerSelect : flowSelect;
    const ids = Array.from(select.selectedIds);
    if (ids.length > 50 && !confirm(`Выбрано ${ids.length}. Продолжить?`)) return;
    const mutate = type === "tariff" ? updateTariff : type === "offer" ? updateOffer : updateFlow;
    await Promise.all(ids.map(id => mutate.mutateAsync({ id, is_active: false })));
    select.clearSelection();
    toast.success(`Деактивировано: ${ids.length}`);
  }, [tariffSelect, offerSelect, flowSelect, updateTariff, updateOffer, updateFlow]);

  const handleBulkDeleteStart = useCallback((type: "tariff" | "offer" | "flow") => {
    const select = type === "tariff" ? tariffSelect : type === "offer" ? offerSelect : flowSelect;
    const ids = Array.from(select.selectedIds);
    if (ids.length > 50 && !confirm(`Выбрано ${ids.length}. Продолжить?`)) return;
    setBulkDeleteConfirm({ type, ids });
  }, [tariffSelect, offerSelect, flowSelect]);

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (!bulkDeleteConfirm) return;
    const { type, ids } = bulkDeleteConfirm;
    const mutate = type === "tariff" ? deleteTariff : type === "offer" ? deleteOffer : deleteFlow;
    await Promise.all(ids.map(id => mutate.mutateAsync(id)));
    const select = type === "tariff" ? tariffSelect : type === "offer" ? offerSelect : flowSelect;
    select.clearSelection();
    setBulkDeleteConfirm(null);
    toast.success(`Удалено: ${ids.length}`);
  }, [bulkDeleteConfirm, deleteTariff, deleteOffer, deleteFlow, tariffSelect, offerSelect, flowSelect]);
  
  // Payment dialog state for preview
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedOfferForPayment, setSelectedOfferForPayment] = useState<{
    offer: any;
    tariff: any;
  } | null>(null);

  // Handler for preview card offer selection
  const handlePreviewSelectOffer = (offer: any, tariff: any) => {
    setSelectedOfferForPayment({ offer, tariff });
    setPaymentDialogOpen(true);
  };

  // Tariff form
  const [tariffForm, setTariffForm] = useState({
    code: "",
    name: "",
    description: "",
    subtitle: "",
    period_label: "BYN",
    is_popular: false,
    badge: "",
    access_days: 30,
    is_active: true,
    meta: {} as TariffMetaConfig,
    // card_config fields (stored in meta.card_config)
    cc_price_display: null as number | null,
    cc_old_price: null as number | null,
    cc_price_suffix: "BYN",
    cc_footnote: "",
    cc_style_variant: "default" as "default" | "highlighted" | "minimal" | "compact",
  });

  // Preview mode for tariff dialog
  const [tariffPreviewMode, setTariffPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [sectionPreviewMode, setSectionPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const isMobile = useIsMobile();

  // Layout-настройка тарифной секции (SoT — продукт.landing_config.tariffs_layout).
  // Сохраняется через useUpdateProductV2 (тот же путь, что и любые другие поля продукта).
  // После save инвалидируем кэш публичных продуктов, чтобы preview/публичные страницы/site-builder
  // подхватили новое значение без перезагрузки страницы.
  const queryClient = useQueryClient();
  const updateProductMutation = useUpdateProductV2();
  const currentTariffsLayout: "auto" | "vertical-grid" =
    ((product as any)?.landing_config?.tariffs_layout as "auto" | "vertical-grid" | undefined) ?? "auto";

  const handleChangeTariffsLayout = async (next: "auto" | "vertical-grid") => {
    if (!productId || !product) return;
    if (next === currentTariffsLayout) return;
    const prevConfig = ((product as any).landing_config ?? {}) as Record<string, any>;
    const nextConfig = { ...prevConfig, tariffs_layout: next };
    try {
      await updateProductMutation.mutateAsync({
        id: productId,
        landing_config: nextConfig as any,
      } as any);
      // Invalidate public-product caches so preview + public pages + site-builder pick up the change
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products_v2", productId] }),
        queryClient.invalidateQueries({ queryKey: ["public-product"] }),
        queryClient.invalidateQueries({ queryKey: ["public-product-by-slug"] }),
      ]);
    } catch (e) {
      // toast обрабатывается внутри mutation onError
    }
  };


  // Offer form
  const [offerForm, setOfferForm] = useState({
    tariff_id: "",
    offer_type: "pay_now" as "pay_now" | "trial" | "preregistration",
    button_label: "",
    amount: 0,
    reentry_amount: null as number | null, // Price for re-entry (former club members)
    trial_days: 5,
    auto_charge_after_trial: true,
    auto_charge_offer_id: "" as string, // Reference to pay_now offer for auto-charge
    auto_charge_delay_days: 5,
    requires_card_tokenization: false,
    is_active: true,
    is_primary: false,
    getcourse_offer_id: "",
    reject_virtual_cards: false,
    // Installment fields
    payment_method: "full_payment" as PaymentMethod,
    installment_count: 3,
    installment_interval_days: 30,
    first_payment_delay_days: 0,
    // Meta for welcome message
    meta: {} as OfferMetaConfig,
    // Preregistration fields (stored in meta.preregistration)
    preregistration_first_charge_date: "",
    preregistration_charge_offer_id: "",
    preregistration_notify_before_days: 1,
    preregistration_auto_convert: false,
    preregistration_charge_window_start: 1,
    preregistration_charge_window_end: 4,
  });
  
  // Advanced settings visibility
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Flow form
  const [flowForm, setFlowForm] = useState({
    code: "",
    name: "",
    start_date: "",
    end_date: "",
    max_participants: null as number | null,
    is_default: false,
    is_active: true,
  });

  if (productLoading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Загрузка...</div>
        </div>
      </AdminLayout>
    );
  }

  if (!product) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-muted-foreground">Продукт не найден</div>
          <Button variant="outline" onClick={() => navigate("/admin/products-v2")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            К списку продуктов
          </Button>
        </div>
      </AdminLayout>
    );
  }

  // Tariff handlers
  const openTariffDialog = (tariff?: any) => {
    if (tariff) {
      const meta = (tariff.meta || {}) as TariffMetaConfig;
      const cc = (meta as any).card_config as CardConfig | undefined;
      setTariffForm({
        code: tariff.code,
        name: tariff.name,
        description: tariff.description || "",
        subtitle: tariff.subtitle || "",
        period_label: tariff.period_label || "BYN/мес",
        is_popular: tariff.is_popular || false,
        badge: tariff.badge || "",
        access_days: tariff.access_days,
        is_active: tariff.is_active,
        meta,
        cc_price_display: cc?.price_display ?? null,
        cc_old_price: cc?.old_price ?? tariff.original_price ?? null,
        cc_price_suffix: cc?.price_suffix || "BYN",
        cc_footnote: cc?.footnote || "",
        cc_style_variant: cc?.style_variant || (cc?.is_highlighted || tariff.is_popular ? "highlighted" : "default"),
      });
      setTariffDialog({ open: true, editing: tariff });
    } else {
      setTariffForm({
        code: "",
        name: "",
        description: "",
        subtitle: "",
        period_label: "BYN",
        is_popular: false,
        badge: "",
        access_days: 30,
        is_active: true,
        meta: {},
        cc_price_display: null,
        cc_old_price: null,
        cc_price_suffix: "BYN",
        cc_footnote: "",
        cc_style_variant: "default",
      });
      setTariffDialog({ open: true, editing: null });
    }
  };

  const handleSaveTariff = async () => {
    if (!tariffForm.name) {
      toast.error("Заполните название");
      return;
    }
    const effectiveCode = tariffForm.code || `trf_${crypto.randomUUID().slice(0, 12)}`;
    
    // Build card_config from cc_ fields
    const cardConfig: CardConfig = {
      price_display: tariffForm.cc_price_display,
      old_price: tariffForm.cc_old_price,
      price_suffix: tariffForm.cc_price_suffix || "BYN",
      cta_text: (tariffForm.meta as any)?.card_config?.cta_text ?? null,
      footnote: tariffForm.cc_footnote || null,
      is_highlighted: tariffForm.cc_style_variant === "highlighted",
      style_variant: tariffForm.cc_style_variant,
      badge_text: tariffForm.badge || null,
    };

    // Deep merge meta: preserve existing fields, update only card_config
    const existingMeta = tariffForm.meta || {};
    const mergedMeta = {
      ...existingMeta,
      card_config: cardConfig,
    };

    // Extract cc_ fields out, keep the rest
    const { meta, cc_price_display, cc_old_price, cc_price_suffix, cc_footnote, cc_style_variant, ...formBase } = tariffForm;
    
    const data: any = { 
      ...formBase,
      code: effectiveCode,
      product_id: productId!,
      is_popular: tariffForm.cc_style_variant === "highlighted", // backward compat mapping
      meta: Object.keys(mergedMeta).length > 0 ? mergedMeta : null,
    };
    if (tariffDialog.editing) {
      await updateTariff.mutateAsync({ id: tariffDialog.editing.id, ...data });
    } else {
      await createTariff.mutateAsync(data);
    }
    setTariffDialog({ open: false, editing: null });
  };

  // Offer handlers
  const openOfferDialog = (offer?: any) => {
    if (offer) {
      // Parse meta from offer
      const meta = (offer.meta || {}) as OfferMetaConfig;
      const prereg = meta.preregistration || {};
      setOfferForm({
        tariff_id: offer.tariff_id,
        offer_type: offer.offer_type,
        button_label: offer.button_label,
        amount: offer.amount,
        reentry_amount: offer.reentry_amount ?? null,
        trial_days: offer.trial_days || 5,
        auto_charge_after_trial: offer.auto_charge_after_trial ?? true,
        auto_charge_offer_id: offer.auto_charge_offer_id || "",
        auto_charge_delay_days: offer.auto_charge_delay_days || 5,
        requires_card_tokenization: offer.requires_card_tokenization ?? false,
        is_active: offer.is_active ?? true,
        is_primary: offer.is_primary ?? false,
        getcourse_offer_id: offer.getcourse_offer_id || "",
        reject_virtual_cards: offer.reject_virtual_cards ?? false,
        payment_method: offer.payment_method || "full_payment",
        installment_count: offer.installment_count || 3,
        installment_interval_days: offer.installment_interval_days || 30,
        first_payment_delay_days: offer.first_payment_delay_days || 0,
        meta,
        // Preregistration fields from meta
        preregistration_first_charge_date: prereg.first_charge_date || "",
        preregistration_charge_offer_id: prereg.charge_offer_id || "",
        preregistration_notify_before_days: prereg.notify_before_days ?? 1,
        preregistration_auto_convert: prereg.auto_convert_after_date ?? false,
        preregistration_charge_window_start: prereg.charge_window_start ?? 1,
        preregistration_charge_window_end: prereg.charge_window_end ?? 4,
      });
      setOfferDialog({ open: true, editing: offer });
    } else {
      setOfferForm({
        tariff_id: tariffs?.[0]?.id || "",
        offer_type: "pay_now",
        button_label: "Оплатить",
        amount: 0,
        reentry_amount: null,
        trial_days: 5,
        auto_charge_after_trial: true,
        auto_charge_offer_id: "",
        auto_charge_delay_days: 5,
        requires_card_tokenization: false,
        is_active: true,
        is_primary: false,
        getcourse_offer_id: "",
        reject_virtual_cards: false,
        payment_method: "full_payment",
        installment_count: 3,
        installment_interval_days: 30,
        first_payment_delay_days: 0,
        meta: {},
        // Preregistration defaults
        preregistration_first_charge_date: "",
        preregistration_charge_offer_id: "",
        preregistration_notify_before_days: 1,
        preregistration_auto_convert: false,
        preregistration_charge_window_start: 1,
        preregistration_charge_window_end: 4,
      });
      setOfferDialog({ open: false, editing: null });
      setTimeout(() => setOfferDialog({ open: true, editing: null }), 0);
    }
  };
  
  // Get pay_now offers for the selected tariff (for trial auto-charge selection)
  const payNowOffersForTariff = offers?.filter(
    o => o.tariff_id === offerForm.tariff_id && o.offer_type === "pay_now" && o.is_active
  ) || [];

  const handleSaveOffer = async () => {
    if (!offerForm.tariff_id || !offerForm.button_label) {
      toast.error("Заполните обязательные поля");
      return;
    }
    // CRM routing semantic validation (UI mirrors server)
    const crmError = validateCrmRoutingForSave(offerForm.meta?.crm_routing);
    if (crmError) {
      toast.error(crmError);
      return;
    }
    const isInstallment = offerForm.payment_method === "internal_installment";
    const isPreregistration = offerForm.offer_type === "preregistration";
    
    // Build meta object with preregistration and recurring settings if applicable
    let metaToSave: OfferMetaConfig = { ...offerForm.meta };
    
    if (isPreregistration) {
      metaToSave.preregistration = {
        first_charge_date: offerForm.preregistration_first_charge_date || undefined,
        charge_offer_id: offerForm.preregistration_charge_offer_id || undefined,
        notify_before_days: offerForm.preregistration_notify_before_days,
        auto_convert_after_date: offerForm.preregistration_auto_convert,
        charge_window_start: offerForm.preregistration_charge_window_start,
        charge_window_end: offerForm.preregistration_charge_window_end,
      };
    } else {
      // Remove preregistration if switching to different type
      delete metaToSave.preregistration;
    }
    
    // Preserve/clear recurring settings based on subscription toggle
    // Installment НЕ recurring: meta.recurring очищается для installment-кнопок (взаимоисключение типов).
    const isSubscription = !isInstallment && (
      offerForm.offer_type === "trial" ||
      isPreregistration ||
      offerForm.requires_card_tokenization
    );
    
    if (isSubscription) {
      // PATCH: Normalize recurring config with all required defaults
      const existingRecurring = metaToSave.recurring || {};
      const chargeAttemptsPerDay = Math.min(4, Math.max(1, existingRecurring.charge_attempts_per_day || 2));
      
      // Ensure charge_times_local array matches charge_attempts_per_day
      let chargeTimesLocal = existingRecurring.charge_times_local || ['09:00', '21:00'];
      if (chargeTimesLocal.length < chargeAttemptsPerDay) {
        // Fill with defaults
        const defaults = ['09:00', '15:00', '21:00', '03:00'];
        while (chargeTimesLocal.length < chargeAttemptsPerDay) {
          chargeTimesLocal.push(defaults[chargeTimesLocal.length] || '12:00');
        }
      } else if (chargeTimesLocal.length > chargeAttemptsPerDay) {
        chargeTimesLocal = chargeTimesLocal.slice(0, chargeAttemptsPerDay);
      }
      
      metaToSave.recurring = {
        is_recurring: true,
        timezone: existingRecurring.timezone || 'Europe/Minsk',
        billing_period_mode: existingRecurring.billing_period_mode || 'month',
        billing_period_days: existingRecurring.billing_period_mode === 'days' 
          ? (existingRecurring.billing_period_days || 30) : undefined,
        grace_hours: Math.min(168, Math.max(1, existingRecurring.grace_hours || 72)),
        charge_attempts_per_day: chargeAttemptsPerDay,
        charge_times_local: chargeTimesLocal,
        pre_due_reminders_days: existingRecurring.pre_due_reminders_days || [7, 3, 1],
        post_due_reminders_policy: existingRecurring.post_due_reminders_policy || 'daily',
        notify_before_each_charge: existingRecurring.notify_before_each_charge ?? true,
        notify_grace_events: existingRecurring.notify_grace_events ?? true,
      };
    } else {
      delete metaToSave.recurring;
    }
    
    // Installment metadata (Stage L0a-1):
    // meta.installment = { max_months 2..12, interval_days:30, first_payment_delay_days:0, rounding_mode }
    // legacy-зеркало в столбцах installment_count / installment_interval_days / first_payment_delay_days сохраняем.
    if (isInstallment) {
      const maxMonths = Math.max(2, Math.min(12, offerForm.installment_count || 6));
      metaToSave.installment = {
        max_months: maxMonths,
        interval_days: 30,
        first_payment_delay_days: 0,
        rounding_mode: 'round_half_up_byn',
      };
    } else {
      delete metaToSave.installment;
    }
    
    const data: TariffOfferInsert = {
      tariff_id: offerForm.tariff_id,
      offer_type: offerForm.offer_type,
      button_label: offerForm.button_label,
      amount: offerForm.amount,
      reentry_amount: offerForm.reentry_amount || null, // Price for re-entry
      trial_days: offerForm.offer_type === "trial" ? offerForm.trial_days : null,
      auto_charge_after_trial: offerForm.offer_type === "trial" ? offerForm.auto_charge_after_trial : false,
      auto_charge_amount: null, // Deprecated, use auto_charge_offer_id instead
      auto_charge_delay_days: offerForm.offer_type === "trial" ? offerForm.auto_charge_delay_days : null,
      auto_charge_offer_id: offerForm.offer_type === "trial" && offerForm.auto_charge_after_trial ? (offerForm.auto_charge_offer_id || null) : null,
      requires_card_tokenization: offerForm.offer_type === "trial" || isPreregistration ? true : (isInstallment || offerForm.requires_card_tokenization),
      is_active: offerForm.is_active,
      is_primary: offerForm.offer_type === "pay_now" ? offerForm.is_primary : false,
      visible_from: null,
      visible_to: null,
      sort_order: offerForm.offer_type === "trial" ? 1 : (isPreregistration ? 2 : 0),
      getcourse_offer_id: offerForm.getcourse_offer_id || null,
      reject_virtual_cards: offerForm.reject_virtual_cards,
      // Installment fields (legacy mirror — installment_count хранит max_months)
      payment_method: offerForm.offer_type === "pay_now" ? offerForm.payment_method : "full_payment",
      installment_count: isInstallment ? Math.max(2, Math.min(12, offerForm.installment_count || 6)) : null,
      installment_interval_days: isInstallment ? 30 : null,
      first_payment_delay_days: isInstallment ? 0 : null,
      // Meta field for welcome message + preregistration settings + installment
      meta: Object.keys(metaToSave).length > 0 ? metaToSave : (offerForm.requires_card_tokenization ? metaToSave : null),
    };
    
    if (offerDialog.editing) {
      await updateOffer.mutateAsync({ id: offerDialog.editing.id, ...data });
    } else {
      await createOffer.mutateAsync(data);
    }
    setOfferDialog({ open: false, editing: null });
  };

  const handleToggleOfferActive = async (id: string, isActive: boolean) => {
    await updateOffer.mutateAsync({ id, is_active: isActive });
  };

  const handleUpdateOfferLabel = async (id: string, label: string) => {
    await updateOffer.mutateAsync({ id, button_label: label });
  };

  // Sprint 10: copy a payment button (offer) as a new INACTIVE one.
  // Copies all functional fields including meta.document_defaults; resets is_primary
  // and forces is_active=false to avoid accidental publication / payment-link conflicts.
  const handleCopyOffer = async (offer: any) => {
    try {
      const meta = (offer.meta ? { ...offer.meta } : {}) as OfferMetaConfig;
      // Don't copy crm_routing payment-link conflicts: keep crm_routing but reset welcome message media path
      const insert: TariffOfferInsert = {
        tariff_id: offer.tariff_id,
        offer_type: offer.offer_type,
        button_label: `${offer.button_label} (копия)`,
        amount: offer.amount,
        reentry_amount: offer.reentry_amount ?? null,
        trial_days: offer.trial_days ?? null,
        auto_charge_after_trial: !!offer.auto_charge_after_trial,
        auto_charge_amount: null,
        auto_charge_delay_days: offer.auto_charge_delay_days ?? null,
        auto_charge_offer_id: offer.auto_charge_offer_id ?? null,
        requires_card_tokenization: !!offer.requires_card_tokenization,
        is_active: false, // safety: never auto-activate
        is_primary: false, // safety: never auto-promote
        visible_from: null,
        visible_to: null,
        sort_order: (offer.sort_order ?? 0),
        getcourse_offer_id: null, // do not copy provider-side ID
        reject_virtual_cards: !!offer.reject_virtual_cards,
        payment_method: offer.payment_method ?? "full_payment",
        installment_count: offer.installment_count ?? null,
        installment_interval_days: offer.installment_interval_days ?? null,
        first_payment_delay_days: offer.first_payment_delay_days ?? null,
        meta: Object.keys(meta).length > 0 ? meta : null,
      };
      await createOffer.mutateAsync(insert);
      // Best-effort audit log; non-blocking
      try {
        await supabase.from("audit_logs").insert({
          action: "offer.copied",
          actor_type: "admin",
          meta: {
            source_offer_id: offer.id,
            tariff_id: offer.tariff_id,
            copied_document_defaults: !!meta.document_defaults,
          },
        });
      } catch {
        /* audit best-effort */
      }
      toast.success("Кнопка скопирована (выключена)");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось скопировать кнопку");
    }
  };

  // Flow handlers
  const openFlowDialog = (flow?: any) => {
    if (flow) {
      setFlowForm({
        code: flow.code,
        name: flow.name,
        start_date: flow.start_date || "",
        end_date: flow.end_date || "",
        max_participants: flow.max_participants,
        is_default: flow.is_default,
        is_active: flow.is_active,
      });
      setFlowDialog({ open: true, editing: flow });
    } else {
      setFlowForm({
        code: "",
        name: "",
        start_date: "",
        end_date: "",
        max_participants: null,
        is_default: false,
        is_active: true,
      });
      setFlowDialog({ open: true, editing: null });
    }
  };

  const handleSaveFlow = async () => {
    if (!flowForm.code || !flowForm.name) {
      toast.error("Заполните код и название");
      return;
    }
    const data = {
      ...flowForm,
      product_id: productId!,
      start_date: flowForm.start_date || null,
      end_date: flowForm.end_date || null,
    };
    if (flowDialog.editing) {
      await updateFlow.mutateAsync({ id: flowDialog.editing.id, ...data });
    } else {
      await createFlow.mutateAsync(data);
    }
    setFlowDialog({ open: false, editing: null });
  };

  // Delete handler — only for "flow"; tariff/offer handled by TariffDeleteConfirmDialog
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "flow") {
      await deleteFlow.mutateAsync(deleteConfirm.id);
    }
    setDeleteConfirm(null);
  };

  // Get offers by tariff
  const getOffersForTariff = (tariffId: string) => 
    (offers || []).filter((o: any) => o.tariff_id === tariffId);

  // Get features by tariff
  const getFeaturesForTariff = (tariffId: string) =>
    (allTariffFeatures || []).filter((f: TariffFeature) => f.tariff_id === tariffId && isFeatureVisible(f));

  return (
    <AdminLayout>
      <div className="space-y-4">
        {/* Compact Header */}
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate("/admin/products-v2")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                {(product as any).public_id && (
                  <CopyableIdChip value={(product as any).public_id} />
                )}
                <h1 className="text-lg font-semibold truncate">{product.name}</h1>
                <Badge 
                  variant="outline"
                  className={`text-[11px] ${getStatusBadgeClass((product as any).status === "active" ? "active" : (product as any).status === "archived" ? "archived" : "hidden")}`}
                >
                  {(product as any).status === "active" ? "Активный" : (product as any).status === "archived" ? "Архивный" : "Скрытый"}
                </Badge>
              </div>
            </div>
            {(product as any).primary_domain && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 shrink-0" asChild>
                <a href={`https://${(product as any).primary_domain}`} target="_blank" rel="noopener noreferrer">
                  <Globe className="h-3.5 w-3.5" />
                  Сайт
                </a>
              </Button>
            )}
          </div>
          <ProductSitePageBinding productId={productId!} primaryDomain={(product as any).primary_domain} productName={(product as any).name} />
        </GlassCard>

        {/* Pill-style tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="px-1 overflow-x-auto scrollbar-none">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="tariffs" className="gap-1.5 text-xs">
                <Tag className="h-3.5 w-3.5" />
                Тарифы
              </TabsTrigger>
              <TabsTrigger value="offers" className="gap-1.5 text-xs">
                <MousePointer className="h-3.5 w-3.5" />
                Кнопки оплаты
              </TabsTrigger>
              <TabsTrigger value="flows" className="gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5" />
                Потоки
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs">
                <Eye className="h-3.5 w-3.5" />
                Превью
              </TabsTrigger>
              <TabsTrigger value="custom_fields" className="gap-1.5 text-xs">
                <Settings2 className="h-3.5 w-3.5" />
                Документы
              </TabsTrigger>
              <TabsTrigger value="composition" className="gap-1.5 text-xs">
                <FolderTree className="h-3.5 w-3.5" />
                Состав
              </TabsTrigger>
              <TabsTrigger value="access_rules" className="gap-1.5 text-xs">
                <Shield className="h-3.5 w-3.5" />
                Доступы
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tariffs Tab */}
          <TabsContent value="tariffs" className="space-y-4 mt-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h2 className="text-lg font-semibold">Тарифы</h2>
                <p className="text-sm text-muted-foreground">
                  Тариф = пакет доступа. Цены задаются в кнопках оплаты.
                </p>
              </div>
              <Button onClick={() => openTariffDialog()} className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Добавить тариф
              </Button>
            </div>

            {!tariffs?.length ? (
              <GlassCard className="py-12 text-center text-muted-foreground">
                Нет тарифов. Создайте первый тариф для этого продукта.
              </GlassCard>
            ) : (
              <>
                {/* Select All + Sort Pills */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Checkbox
                    checked={tariffSelect.selectedCount > 0 && tariffSelect.selectedCount === sortedTariffs.length}
                    onCheckedChange={(checked) => checked ? tariffSelect.selectAll() : tariffSelect.clearSelection()}
                  />
                  <span className="text-xs text-muted-foreground">
                    {tariffSelect.selectedCount > 0 ? `Выбрано: ${tariffSelect.selectedCount}` : "Выбрать все"}
                  </span>
                  {tariffSelect.hasSelection && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={tariffSelect.clearSelection}>Сбросить</Button>
                  )}
                </div>

                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleTariffDragEnd}>
                  <SortableContext items={sortedTariffs.map(t => t.id)} strategy={verticalListSortingStrategy}>
                    <div className="relative space-y-3" onMouseDown={tariffSelect.handleMouseDown}>
                      {sortedTariffs.map((tariff) => (
                        <SortableTariffItem
                          key={tariff.id}
                          tariff={tariff}
                          offers={getOffersForTariff(tariff.id)}
                          productIsActive={(product as any)?.is_active ?? true}
                          isSelected={tariffSelect.selectedIds.has(tariff.id)}
                          isDragPending={reorderTariffs.isPending}
                          onToggleSelect={() => tariffSelect.toggleSelection(tariff.id, true)}
                          onEdit={() => openTariffDialog(tariff)}
                          onDelete={() => setDeleteConfirm({ type: "tariff", id: tariff.id })}
                          onClick={(e) => {
                            if (e.shiftKey) { tariffSelect.handleRangeSelect(tariff.id, true); }
                            else if (e.ctrlKey || e.metaKey) { tariffSelect.toggleSelection(tariff.id, true); }
                            else { openTariffDialog(tariff); }
                          }}
                          registerRef={(el) => tariffSelect.registerItemRef(tariff.id, el)}
                        />
                      ))}

                      {/* Selection box overlay */}
                      {tariffSelect.isDragging && tariffSelect.selectionBox && (
                        <SelectionBox
                          startX={tariffSelect.selectionBox.startX}
                          startY={tariffSelect.selectionBox.startY}
                          endX={tariffSelect.selectionBox.endX}
                          endY={tariffSelect.selectionBox.endY}
                        />
                      )}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Bulk Actions Bar */}
                {tariffSelect.hasSelection && (
                  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
                    <div className="bg-background border rounded-xl shadow-lg px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)]">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
                        <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs sm:text-sm">
                          {tariffSelect.selectedCount}
                        </div>
                        <span className="text-muted-foreground whitespace-nowrap">из {sortedTariffs.length}</span>
                      </div>
                      <div className="h-5 w-px bg-border hidden sm:block" />
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-primary" onClick={() => handleBulkActivate("tariff")}>
                        <Power className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Активировать</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={() => handleBulkDeactivate("tariff")}>
                        <PowerOff className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Деактивировать</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-destructive hover:text-destructive" onClick={() => handleBulkDeleteStart("tariff")}>
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Удалить</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={tariffSelect.clearSelection}>
                        <span className="text-xs">✕</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Offers Tab */}
          <TabsContent value="offers" className="space-y-4 mt-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h2 className="text-lg font-semibold">Кнопки оплаты</h2>
                <p className="text-sm text-muted-foreground">
                  Кнопка = способ покупки тарифа. Здесь задаётся цена.
                </p>
              </div>
              <Button onClick={() => openOfferDialog()} className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Добавить кнопку
              </Button>
            </div>

            {!offers?.length ? (
              <GlassCard className="py-12 text-center text-muted-foreground">
                Нет кнопок оплаты. Создайте кнопки для отображения на сайте.
              </GlassCard>
            ) : (
              <>
                {/* Select All + Sort Pills */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Checkbox
                    checked={offerSelect.selectedCount > 0 && offerSelect.selectedCount === allOffers.length}
                    onCheckedChange={(checked) => checked ? offerSelect.selectAll() : offerSelect.clearSelection()}
                  />
                  <span className="text-xs text-muted-foreground">
                    {offerSelect.selectedCount > 0 ? `Выбрано: ${offerSelect.selectedCount}` : "Выбрать все"}
                  </span>
                  {offerSelect.hasSelection && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={offerSelect.clearSelection}>Сбросить</Button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <SortPill label="Сумма" sortKey="amount" currentSortKey={offerSort.sortKey} currentSortDirection={offerSort.sortDirection} onSort={offerSort.handleSort} />
                    <SortPill label="Тип" sortKey="offer_type" currentSortKey={offerSort.sortKey} currentSortDirection={offerSort.sortDirection} onSort={offerSort.handleSort} />
                  </div>
                </div>

                <div className="relative space-y-6" onMouseDown={offerSelect.handleMouseDown}>
                  {tariffs?.map((tariff) => {
                    const tariffOffers = clientSort(getOffersForTariff(tariff.id), offerSort.sortKey, offerSort.sortDirection);
                    if (!tariffOffers.length) return null;
                    
                    const hasActivePayOffer = tariffOffers.some((o: any) => o.offer_type === 'pay_now' && o.is_active);
                    
                    return (
                      <GlassCard key={tariff.id} className="p-4">
                        {/* Tariff group header — NOT selectable */}
                        <div className="flex items-center gap-2 mb-3">
                          <span className="font-medium">{tariff.name}</span>
                          {tariff.public_id && (
                            <CopyableIdChip value={tariff.public_id} />
                          )}
                          {!hasActivePayOffer && (
                            <Badge variant="outline" className={`text-xs ${getStatusBadgeClass("warning")}`}>
                              Нет основной цены
                            </Badge>
                          )}
                        </div>
                        <div className="space-y-2">
                          {tariffOffers.map((offer: any) => (
                            <div
                              key={offer.id}
                              ref={(el) => offerSelect.registerItemRef(offer.id, el)}
                              className={cn(
                                "flex items-start gap-2 cursor-pointer",
                                offerSelect.selectedIds.has(offer.id) && "ring-2 ring-primary/30 rounded-lg"
                              )}
                              onClick={(e) => {
                                if (e.shiftKey) { offerSelect.handleRangeSelect(offer.id, true); }
                                else if (e.ctrlKey || e.metaKey) { offerSelect.toggleSelection(offer.id, true); }
                                else { openOfferDialog(offer); }
                              }}
                            >
                              <div className="pt-2 pl-1" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={offerSelect.selectedIds.has(offer.id)}
                                  onCheckedChange={() => offerSelect.toggleSelection(offer.id, true)}
                                />
                              </div>
                              <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                <OfferRowCompact
                                  offer={offer}
                                  onToggleActive={handleToggleOfferActive}
                                  onUpdateLabel={handleUpdateOfferLabel}
                                  onSetPrimary={(offerId) => setPrimaryOffer.mutate({ offerId, tariffId: tariff.id })}
                                  onEdit={() => openOfferDialog(offer)}
                                  onCopy={() => handleCopyOffer(offer)}
                                  onDelete={() => setDeleteConfirm({ type: "offer", id: offer.id })}
                                  hasPrimaryInTariff={hasActivePayOffer}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </GlassCard>
                    );
                  })}

                  {/* Selection box overlay */}
                  {offerSelect.isDragging && offerSelect.selectionBox && (
                    <SelectionBox
                      startX={offerSelect.selectionBox.startX}
                      startY={offerSelect.selectionBox.startY}
                      endX={offerSelect.selectionBox.endX}
                      endY={offerSelect.selectionBox.endY}
                    />
                  )}
                </div>

                {/* Bulk Actions Bar */}
                {offerSelect.hasSelection && (
                  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
                    <div className="bg-background border rounded-xl shadow-lg px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)]">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
                        <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs sm:text-sm">
                          {offerSelect.selectedCount}
                        </div>
                        <span className="text-muted-foreground whitespace-nowrap">из {allOffers.length}</span>
                      </div>
                      <div className="h-5 w-px bg-border hidden sm:block" />
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-primary" onClick={() => handleBulkActivate("offer")}>
                        <Power className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Активировать</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={() => handleBulkDeactivate("offer")}>
                        <PowerOff className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Деактивировать</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-destructive hover:text-destructive" onClick={() => handleBulkDeleteStart("offer")}>
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Удалить</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={offerSelect.clearSelection}>
                        <span className="text-xs">✕</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Flows Tab */}
          <TabsContent value="flows" className="space-y-4 mt-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
              <div>
                <h2 className="text-lg font-semibold">Потоки</h2>
                <p className="text-sm text-muted-foreground">
                  Потоки для запуска продукта в разное время
                </p>
              </div>
              <Button onClick={() => openFlowDialog()} className="w-full sm:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Добавить поток
              </Button>
            </div>

            {!flows?.length ? (
              <GlassCard className="py-12 text-center text-muted-foreground">
                Нет потоков.
              </GlassCard>
            ) : (
              <>
                {/* Select All + Sort Pills */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Checkbox
                    checked={flowSelect.selectedCount > 0 && flowSelect.selectedCount === sortedFlows.length}
                    onCheckedChange={(checked) => checked ? flowSelect.selectAll() : flowSelect.clearSelection()}
                  />
                  <span className="text-xs text-muted-foreground">
                    {flowSelect.selectedCount > 0 ? `Выбрано: ${flowSelect.selectedCount}` : "Выбрать все"}
                  </span>
                  {flowSelect.hasSelection && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={flowSelect.clearSelection}>Сбросить</Button>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <SortPill label="Имя" sortKey="name" currentSortKey={flowSort.sortKey} currentSortDirection={flowSort.sortDirection} onSort={flowSort.handleSort} />
                    <SortPill label="Статус" sortKey="is_active" currentSortKey={flowSort.sortKey} currentSortDirection={flowSort.sortDirection} onSort={flowSort.handleSort} />
                  </div>
                </div>

                <div className="relative space-y-2" onMouseDown={flowSelect.handleMouseDown}>
                  {sortedFlows.map((flow) => (
                    <div
                      key={flow.id}
                      ref={(el) => flowSelect.registerItemRef(flow.id, el)}
                      className={cn(
                        "flex items-start gap-2 cursor-pointer",
                        flowSelect.selectedIds.has(flow.id) && "ring-2 ring-primary/30 rounded-xl"
                      )}
                      onClick={(e) => {
                        if (e.shiftKey) { flowSelect.handleRangeSelect(flow.id, true); }
                        else if (e.ctrlKey || e.metaKey) { flowSelect.toggleSelection(flow.id, true); }
                        else { openFlowDialog(flow); }
                      }}
                    >
                      <div className="pt-4 pl-1" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={flowSelect.selectedIds.has(flow.id)}
                          onCheckedChange={() => flowSelect.toggleSelection(flow.id, true)}
                        />
                      </div>
                      <GlassCard className="flex-1 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{flow.name}</span>
                              <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{flow.code}</code>
                              {flow.is_default && <Badge variant="outline">По умолчанию</Badge>}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {flow.max_participants ? `Макс. ${flow.max_participants} уч.` : "Без ограничений"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Badge variant="outline" className={getStatusBadgeClass(flow.is_active ? "active" : "inactive")}>
                              {flow.is_active ? "Активен" : "Неактивен"}
                            </Badge>
                            <Button variant="ghost" size="sm" onClick={() => openFlowDialog(flow)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm({ type: "flow", id: flow.id })}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      </GlassCard>
                    </div>
                  ))}

                  {/* Selection box overlay */}
                  {flowSelect.isDragging && flowSelect.selectionBox && (
                    <SelectionBox
                      startX={flowSelect.selectionBox.startX}
                      startY={flowSelect.selectionBox.startY}
                      endX={flowSelect.selectionBox.endX}
                      endY={flowSelect.selectionBox.endY}
                    />
                  )}
                </div>

                {/* Bulk Actions Bar */}
                {flowSelect.hasSelection && (
                  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
                    <div className="bg-background border rounded-xl shadow-lg px-3 sm:px-4 py-2.5 sm:py-3 flex flex-wrap items-center gap-2 sm:gap-3 max-w-[calc(100vw-2rem)]">
                      <div className="flex items-center gap-2 text-xs sm:text-sm font-medium">
                        <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs sm:text-sm">
                          {flowSelect.selectedCount}
                        </div>
                        <span className="text-muted-foreground whitespace-nowrap">из {sortedFlows.length}</span>
                      </div>
                      <div className="h-5 w-px bg-border hidden sm:block" />
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-primary" onClick={() => handleBulkActivate("flow")}>
                        <Power className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Активировать</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm" onClick={() => handleBulkDeactivate("flow")}>
                        <PowerOff className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Деактивировать</span>
                      </Button>
                      <Button variant="ghost" size="sm" className="gap-1 h-7 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm text-destructive hover:text-destructive" onClick={() => handleBulkDeleteStart("flow")}>
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Удалить</span>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8" onClick={flowSelect.clearSelection}>
                        <span className="text-xs">✕</span>
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
          <TabsContent value="preview" className="space-y-4 mt-6">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">Превью секции тарифов</h2>
                      <p className="text-sm text-muted-foreground">
                        Так будет выглядеть секция на сайте
                      </p>
                    </div>
                    <div className="flex gap-1 border rounded-lg p-1">
                      <Button
                        variant={sectionPreviewMode === "desktop" ? "default" : "ghost"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSectionPreviewMode("desktop")}
                      >
                        Desktop
                      </Button>
                      <Button
                        variant={sectionPreviewMode === "mobile" ? "default" : "ghost"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSectionPreviewMode("mobile")}
                      >
                        Mobile
                      </Button>
                    </div>
                  </div>

                  {/* Layout setting (SoT — продукт.landing_config.tariffs_layout) */}
                  <GlassCard className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm font-medium">Раскладка тарифной секции</Label>
                        <p className="text-xs text-muted-foreground max-w-md">
                          Применяется ко всем product-driven отображениям тарифов: превью, публичные страницы продукта, блок тарифов в конструкторе сайтов.
                        </p>
                      </div>
                      <RadioGroup
                        value={currentTariffsLayout}
                        onValueChange={(v) => handleChangeTariffsLayout(v as "auto" | "vertical-grid")}
                        className="flex flex-col gap-2 sm:min-w-[280px]"
                      >
                        <label className="flex items-start gap-2 cursor-pointer rounded-md border p-2 hover:bg-muted/50">
                          <RadioGroupItem value="auto" id="tariffs-layout-auto" className="mt-0.5" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Авто (карусель при 4+)</span>
                            <span className="text-xs text-muted-foreground">Текущее поведение по умолчанию</span>
                          </div>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer rounded-md border p-2 hover:bg-muted/50">
                          <RadioGroupItem value="vertical-grid" id="tariffs-layout-vgrid" className="mt-0.5" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Вертикальная сетка (1 / 2 колонки)</span>
                            <span className="text-xs text-muted-foreground">Mobile — 1 колонка, desktop — 2 колонки, без карусели</span>
                          </div>
                        </label>
                      </RadioGroup>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-4 sm:p-8">
                    {!(product as any).is_active ? (
                      <div className="py-12 text-center text-muted-foreground">
                        <p className="text-lg font-medium">Продукт неактивен</p>
                        <p className="text-sm mt-1">Превью недоступно. Активируйте продукт для просмотра.</p>
                      </div>
                    ) : (
                      // Preview parity: используем тот же UniversalPricingSection,
                      // что и публичные страницы / site-builder pricing block.
                      // Mobile-режим эмулируется ограничением ширины контейнера (max-w-[360px]).
                      // Layout берётся автоматически из product.landing_config.tariffs_layout (SoT).
                      <div className={cn("mx-auto transition-all", sectionPreviewMode === "mobile" ? "max-w-[360px]" : "")}>
                        {(() => {
                          const activeTariffs = (tariffs ?? []).filter((t: any) => t.is_active);
                          const previewTariffs = activeTariffs.map((t: any) => ({
                            ...t,
                            features: getFeaturesForTariff(t.id),
                            offers: getOffersForTariff(t.id),
                          })) as any;
                          if (previewTariffs.length === 0) {
                            return (
                              <p className="text-center text-sm text-muted-foreground py-8">
                                Нет активных тарифов для превью
                              </p>
                            );
                          }
                          return (
                            <UniversalPricingSection
                              product={product as any}
                              tariffs={previewTariffs}
                            />
                          );
                        })()}
                      </div>
                    )}
                  </GlassCard>
          </TabsContent>

          {/* Custom Fields Tab */}
          <TabsContent value="custom_fields" className="mt-6">
            {productId && <ProductCustomFields entityId={productId} />}
          </TabsContent>

          {/* Composition Tab */}
          <TabsContent value="composition" className="space-y-4 mt-6">
            {productId && <ProductCompositionTab productId={productId} />}
          </TabsContent>

          {/* Access Rules Tab */}
          <TabsContent value="access_rules" className="space-y-4 mt-6">
            {productId && (
              <ProductAccessRulesTab
                productId={productId}
                tariffs={(tariffs || []).map((t: any) => ({ id: t.id, name: t.name }))}
                initialAction={activeTab === "access_rules" ? accessRulesAction : undefined}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Tariff Dialog — Visual Tariff Editor */}
      <Dialog open={tariffDialog.open} onOpenChange={(open) => setTariffDialog({ ...tariffDialog, open })}>
        <DialogContent className="max-w-5xl w-[calc(100vw-1.5rem)] sm:w-full overflow-hidden p-0 bg-background border-border/40 rounded-2xl">
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6">
          <DialogHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {tariffDialog.editing ? "Редактировать тариф" : "Новый тариф"}
                {tariffDialog.editing?.public_id && (
                  <CopyableIdChip value={tariffDialog.editing.public_id} />
                )}
                {tariffDialog.editing?.public_id && (
                  <CopyableIdChip
                    value={`…/pricing/tariff/${tariffDialog.editing.public_id}`}
                    copyValue={
                      product?.primary_domain
                        ? `https://${product.primary_domain}/pricing/tariff/${tariffDialog.editing.public_id}`
                        : `/pricing/tariff/${tariffDialog.editing.public_id}`
                    }
                    successMessage="Ссылка скопирована"
                  />
                )}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Switch
                  checked={tariffForm.is_active}
                  onCheckedChange={(checked) => setTariffForm({ ...tariffForm, is_active: checked })}
                />
                <Label className={tariffForm.is_active ? "text-primary" : "text-muted-foreground"}>
                  {tariffForm.is_active ? "Активен" : "Неактивен"}
                </Label>
              </div>
            </div>
            <DialogDescription>
              Конструктор карточки тарифа. Цены задаются отдельно в кнопках оплаты.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col lg:flex-row gap-6 mt-4">
            {/* LEFT: Form */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Section — Основное */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Основное</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Название *</Label>
                    <Input
                      placeholder="CLUB FULL"
                      value={tariffForm.name}
                      onChange={(e) => setTariffForm({ ...tariffForm, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Подзаголовок</Label>
                    <Input
                      placeholder="Самый популярный"
                      value={tariffForm.subtitle}
                      onChange={(e) => setTariffForm({ ...tariffForm, subtitle: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Section — Цена на карточке */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Цена на карточке</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Визуальная цена</Label>
                      <Input
                        type="number"
                        placeholder="500"
                        value={tariffForm.cc_price_display ?? ""}
                        onChange={(e) => setTariffForm({ ...tariffForm, cc_price_display: e.target.value ? parseFloat(e.target.value) : null })}
                      />
                      <p className="text-xs text-muted-foreground">Отображается если нет активной кнопки оплаты</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Валюта</Label>
                      <Input
                        placeholder="BYN"
                        value={tariffForm.cc_price_suffix}
                        onChange={(e) => setTariffForm({ ...tariffForm, cc_price_suffix: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Старая цена (зачёркнутая)</Label>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={tariffForm.cc_old_price ?? ""}
                      onChange={(e) => setTariffForm({ ...tariffForm, cc_old_price: e.target.value ? parseFloat(e.target.value) : null })}
                    />
                    <p className="text-xs text-muted-foreground">Показывается зачёркнутой, если больше основной цены</p>
                  </div>
                </CardContent>
              </Card>

              {/* Section — Карточка на сайте */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Карточка на сайте</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Бейдж</Label>
                    <Input
                      placeholder="Популярный"
                      value={tariffForm.badge}
                      onChange={(e) => setTariffForm({ ...tariffForm, badge: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Описание</Label>
                    <Textarea
                      value={tariffForm.description}
                      onChange={(e) => setTariffForm({ ...tariffForm, description: e.target.value })}
                      rows={3}
                      className="resize-y min-h-[80px]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Стиль карточки</Label>
                      <Select
                        value={tariffForm.cc_style_variant}
                        onValueChange={(v: any) => setTariffForm({ ...tariffForm, cc_style_variant: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Стандартный</SelectItem>
                          <SelectItem value="highlighted">Выделенный</SelectItem>
                          <SelectItem value="minimal">Минимальный</SelectItem>
                          <SelectItem value="compact">Компактный</SelectItem>
                        </SelectContent>
                      </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Подпись под кнопками</Label>
                    <Input
                      placeholder="Гарантия возврата 7 дней"
                      value={tariffForm.cc_footnote}
                      onChange={(e) => setTariffForm({ ...tariffForm, cc_footnote: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Секция — Доступ */}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between px-0 hover:bg-transparent">
                    <span className="text-sm font-medium text-muted-foreground">Доступ</span>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Card className="mt-2">
                    <CardContent className="pt-4 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Срок доступа (дней)</Label>
                          <Input
                            type="number"
                            value={tariffForm.access_days === 0 ? "" : tariffForm.access_days}
                            onChange={(e) => setTariffForm({ ...tariffForm, access_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                            onBlur={() => { if (tariffForm.access_days < 1) setTariffForm({ ...tariffForm, access_days: 1 }); }}
                            min={1}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Период</Label>
                          <Input
                            placeholder="BYN/мес"
                            value={tariffForm.period_label}
                            onChange={(e) => setTariffForm({ ...tariffForm, period_label: e.target.value })}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>

              {/* Section — Преимущества (edit mode only) */}
              {tariffDialog.editing && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">Преимущества</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TariffFeaturesEditor tariffId={tariffDialog.editing.id} />
                  </CardContent>
                </Card>
              )}
            </div>

            {/* RIGHT: Live Preview */}
            {!isMobile && (
              <div className="w-[420px] shrink-0 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Превью</span>
                  <div className="flex gap-1 border rounded-lg p-0.5">
                    <Button
                      variant={tariffPreviewMode === "desktop" ? "default" : "ghost"}
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => setTariffPreviewMode("desktop")}
                    >
                      Desktop
                    </Button>
                    <Button
                      variant={tariffPreviewMode === "mobile" ? "default" : "ghost"}
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => setTariffPreviewMode("mobile")}
                    >
                      Mobile
                    </Button>
                  </div>
                </div>
                <div className={cn(
                  "mx-auto border rounded-xl bg-muted/30 p-4 flex items-start justify-center",
                  tariffPreviewMode === "mobile" ? "w-[320px]" : "w-full"
                )}>
                  <div className="w-full">
                    <TariffCard
                      tariff={buildTariffCardViewModel({
                        id: tariffDialog.editing?.id || "preview",
                        code: tariffForm.code,
                        name: tariffForm.name || "Название тарифа",
                        description: tariffForm.description || null,
                        badge: tariffForm.badge || null,
                        subtitle: tariffForm.subtitle || null,
                        period_label: tariffForm.period_label,
                        is_popular: tariffForm.cc_style_variant === "highlighted",
                        current_price: tariffForm.cc_price_display,
                        meta: {
                          card_config: {
                            badge_text: tariffForm.badge || null,
                            price_display: tariffForm.cc_price_display,
                            old_price: tariffForm.cc_old_price,
                            price_suffix: tariffForm.cc_price_suffix,
                            cta_text: null,
                            footnote: tariffForm.cc_footnote || null,
                            is_highlighted: tariffForm.cc_style_variant === "highlighted",
                            style_variant: tariffForm.cc_style_variant,
                          }
                        },
                      }, tariffForm.cc_price_suffix || (product as any)?.landing_config?.price_suffix)}
                      features={tariffDialog.editing ? getFeaturesForTariff(tariffDialog.editing.id) : []}
                      offers={tariffDialog.editing ? getOffersForTariff(tariffDialog.editing.id) : []}
                      showButtons={!!tariffDialog.editing}
                       priceSuffix={tariffForm.cc_price_suffix || (product as any)?.landing_config?.price_suffix || "BYN"}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mobile preview: Collapsible */}
          {isMobile && (
            <Collapsible className="mt-4">
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full gap-2">
                  <Eye className="h-3.5 w-3.5" />
                  Показать превью
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="border rounded-xl bg-muted/30 p-3">
                  <TariffCard
                    tariff={buildTariffCardViewModel({
                      id: tariffDialog.editing?.id || "preview",
                      name: tariffForm.name || "Название тарифа",
                      description: tariffForm.description || null,
                      badge: tariffForm.badge || null,
                      subtitle: tariffForm.subtitle || null,
                      is_popular: tariffForm.cc_style_variant === "highlighted",
                      current_price: tariffForm.cc_price_display,
                      meta: {
                        card_config: {
                          badge_text: tariffForm.badge || null,
                          price_display: tariffForm.cc_price_display,
                          old_price: tariffForm.cc_old_price,
                          price_suffix: tariffForm.cc_price_suffix,
                          cta_text: null,
                          footnote: tariffForm.cc_footnote || null,
                          is_highlighted: tariffForm.cc_style_variant === "highlighted",
                          style_variant: tariffForm.cc_style_variant,
                        }
                      },
                    }, tariffForm.cc_price_suffix || (product as any)?.landing_config?.price_suffix)}
                    features={tariffDialog.editing ? getFeaturesForTariff(tariffDialog.editing.id) : []}
                    offers={tariffDialog.editing ? getOffersForTariff(tariffDialog.editing.id) : []}
                    showButtons={!!tariffDialog.editing}
                    priceSuffix={tariffForm.cc_price_suffix || (product as any)?.landing_config?.price_suffix || "BYN"}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          <DialogFooter className="pt-4 border-t border-border/40">
            <Button variant="outline" onClick={() => setTariffDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveTariff}>
              {tariffDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Offer Dialog */}
      <Dialog open={offerDialog.open} onOpenChange={(open) => setOfferDialog({ ...offerDialog, open })}>
        <DialogContent className="max-w-4xl w-[calc(100vw-1.5rem)] sm:w-full overflow-hidden p-0 bg-background">
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {offerDialog.editing ? "Редактировать кнопку" : "Новая кнопка оплаты"}
            </DialogTitle>
            <DialogDescription>
              Кнопка = способ покупки. Здесь задаётся цена и условия.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="main" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="main">Основное</TabsTrigger>
              <TabsTrigger value="payment">Оплата</TabsTrigger>
              <TabsTrigger value="renewal">Автопродление</TabsTrigger>
              <TabsTrigger value="documents">Документы</TabsTrigger>
              <TabsTrigger value="extra">Дополнительно</TabsTrigger>
            </TabsList>

            <TabsContent value="main" className="space-y-4 mt-4">
            {/* Основное */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Основное</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Тариф *</Label>
                  <Select
                    value={offerForm.tariff_id}
                    onValueChange={(v) => setOfferForm({ ...offerForm, tariff_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите тариф" />
                    </SelectTrigger>
                    <SelectContent>
                      {tariffs?.map((tariff) => (
                        <SelectItem key={tariff.id} value={tariff.id}>
                          {tariff.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Тип кнопки *</Label>
                  <Select
                    value={
                      offerForm.offer_type === "pay_now" && offerForm.payment_method === "internal_installment"
                        ? "installment"
                        : offerForm.offer_type
                    }
                    onValueChange={(v: "pay_now" | "trial" | "preregistration" | "installment") => {
                      if (v === "installment") {
                        // Кнопка «Рассрочка» = pay_now + internal_installment.
                        // Очищаем meta.recurring (взаимоисключение типов кнопки).
                        const { recurring, ...metaWithoutRecurring } = (offerForm.meta || {}) as any;
                        setOfferForm({
                          ...offerForm,
                          offer_type: "pay_now",
                          payment_method: "internal_installment",
                          button_label: "Оплатить в рассрочку",
                          requires_card_tokenization: true,
                          installment_count: Math.max(2, Math.min(12, offerForm.installment_count || 6)),
                          installment_interval_days: 30,
                          first_payment_delay_days: 0,
                          meta: metaWithoutRecurring,
                        });
                      } else {
                        setOfferForm({
                          ...offerForm,
                          offer_type: v,
                          // При выходе из «Рассрочки» возвращаем full_payment.
                          payment_method: offerForm.payment_method === "internal_installment" ? "full_payment" : offerForm.payment_method,
                          button_label: v === "trial" ? "Trial 1 BYN / 5 дней" : v === "preregistration" ? "Забронировать место" : "Оплатить",
                          requires_card_tokenization: v === "trial" || v === "preregistration",
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pay_now">Оплата (полная стоимость)</SelectItem>
                      <SelectItem value="trial">Trial (пробный период)</SelectItem>
                      <SelectItem value="preregistration">Предзапись (привязка карты)</SelectItem>
                      <SelectItem value="installment">Рассрочка</SelectItem>
                    </SelectContent>
                  </Select>
                  {offerForm.offer_type === "pay_now" && offerForm.payment_method === "internal_installment" && (
                    <p className="text-xs text-muted-foreground">
                      Клиент при оплате выберет срок от 2 до N месяцев. Сумма списывается равными платежами раз в 30 дней. Первый платёж — сразу при покупке.
                    </p>
                  )}
                </div>

                <Separator />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Текст кнопки *</Label>
                    <Input
                      placeholder="Оплатить"
                      value={offerForm.button_label}
                      onChange={(e) => setOfferForm({ ...offerForm, button_label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Сумма (BYN) *</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Например: 390"
                      value={offerForm.amount === 0 ? "" : offerForm.amount}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setOfferForm({ ...offerForm, amount: raw === "" ? 0 : Number(raw) || 0 });
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Повторное вступление */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Цена для повторного вступления</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Для клиентов, которые ранее были участниками и вышли из клуба. Оставьте пустым, если повышение не требуется.
                </p>
                <div className="space-y-2">
                  <Label>Сумма при повторном вступлении (BYN)</Label>
                  <Input
                    type="number"
                    placeholder="Например: 150"
                    value={offerForm.reentry_amount ?? ""}
                    onChange={(e) => setOfferForm({ 
                      ...offerForm, 
                      reentry_amount: e.target.value ? parseFloat(e.target.value) : null 
                    })}
                  />
                </div>
              </CardContent>
            </Card>

            {offerForm.offer_type === "pay_now" && offerForm.payment_method !== "internal_installment" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Способ оплаты</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <RadioGroup
                    value={offerForm.payment_method}
                    onValueChange={(v: PaymentMethod) => setOfferForm({ ...offerForm, payment_method: v })}
                    className="space-y-2"
                  >
                    <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value="full_payment" id="full_payment" />
                      <Label htmlFor="full_payment" className="cursor-pointer flex-1">
                        <div className="font-medium">100% оплата</div>
                        <div className="text-xs text-muted-foreground">Полная оплата сразу</div>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-3 p-3 rounded-lg border bg-muted/30 opacity-70">
                      <RadioGroupItem value="bank_installment" id="bank_installment" />
                      <Label htmlFor="bank_installment" className="cursor-pointer flex-1">
                        <div className="font-medium">Банковская рассрочка</div>
                        <div className="text-xs text-muted-foreground">Рассрочка через банк (настроим позже)</div>
                      </Label>
                    </div>
                  </RadioGroup>
                </CardContent>
              </Card>
            )}

            {offerForm.offer_type === "pay_now" && offerForm.payment_method === "internal_installment" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Настройка рассрочки
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Максимальный срок рассрочки, мес</Label>
                    <Input
                      type="number"
                      min={2}
                      max={12}
                      value={offerForm.installment_count === 0 ? "" : offerForm.installment_count}
                      onChange={(e) => {
                        const raw = e.target.value === "" ? 0 : parseInt(e.target.value) || 0;
                        setOfferForm({ ...offerForm, installment_count: raw });
                      }}
                      onBlur={() => {
                        const clamped = Math.max(2, Math.min(12, offerForm.installment_count || 6));
                        if (clamped !== offerForm.installment_count) {
                          setOfferForm({ ...offerForm, installment_count: clamped });
                        }
                      }}
                      className="w-32"
                    />
                    <p className="text-xs text-muted-foreground">
                      Допустимо 2..12. Это верхний лимит. Реальное число платежей выберет клиент или администратор при оплате (от 2 до выбранного максимума).
                    </p>
                  </div>

                  <div className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30 space-y-1">
                    <div>Интервал между платежами: <span className="font-medium text-foreground">30 дней</span> (фиксировано)</div>
                    <div>Первый платёж: <span className="font-medium text-foreground">сразу при покупке</span> (фиксировано)</div>
                  </div>

                  {offerForm.amount > 0 && offerForm.installment_count > 1 && (
                    <div className="pt-3 border-t">
                      <Label className="text-xs text-muted-foreground">
                        Пример при максимальном сроке ({offerForm.installment_count} мес):
                      </Label>
                      {(() => {
                        const N = offerForm.installment_count;
                        const total = offerForm.amount;
                        const perPayment = Math.round(total / N);
                        const totalInstallment = perPayment * N;
                        return (
                          <div className="mt-2 space-y-1.5 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{N} платежей × {perPayment} BYN</span>
                              <span className="font-medium">= ИТОГО {totalInstallment} BYN</span>
                            </div>
                            <div className="text-xs text-muted-foreground pt-1">
                              Сумма платежа округлена до целых BYN. Итог рассрочки рассчитан с учётом срока и может отличаться от полной цены ({total} BYN).
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {offerForm.offer_type === "pay_now" && offerForm.payment_method === "full_payment" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Подписка</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Subscription toggle - only for full payment */}
                  {true && (
                    <>
                      <Separator />
                      <div>
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={offerForm.requires_card_tokenization}
                            onCheckedChange={(checked) => setOfferForm({ ...offerForm, requires_card_tokenization: checked })}
                          />
                          <Label>Подписка (автопродление)</Label>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {offerForm.requires_card_tokenization 
                            ? "Продукт продлеваемый: карта сохраняется, авто-списания и напоминания о продлении включены." 
                            : "Разовый продукт: оплата без сохранения карты, напоминания о продлении не отправляются."}
                        </p>
                      </div>
                      
                      {/* Auto-renewal settings - ONLY for subscriptions */}
                      {offerForm.requires_card_tokenization && (
                        <Collapsible 
                          open={showAdvancedSettings}
                          onOpenChange={setShowAdvancedSettings}
                          className="mt-4 border-t pt-4"
                        >
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="w-full justify-between">
                            <span className="flex items-center gap-2">
                              <RefreshCw className="h-4 w-4" />
                              Настройки автопродления
                            </span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvancedSettings && "rotate-180")} />
                          </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-4 space-y-4">
                          <Card>
                            <CardContent className="pt-6 space-y-4">
                              
                              {/* Billing period */}
                              <div className="space-y-2">
                                <Label className="text-sm">Период списания</Label>
                                <RadioGroup
                                  value={offerForm.meta?.recurring?.billing_period_mode || 'month'}
                                  onValueChange={(v) => setOfferForm({
                                    ...offerForm,
                                    meta: {
                                      ...offerForm.meta,
                                      recurring: {
                                        ...offerForm.meta?.recurring,
                                        billing_period_mode: v as 'month' | 'days',
                                      }
                                    }
                                  })}
                                  className="flex flex-col gap-3 sm:flex-row sm:gap-4"
                                >
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="month" id="billing-month" />
                                    <Label htmlFor="billing-month" className="font-normal text-sm">1 календарный месяц</Label>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="days" id="billing-days" />
                                    <Label htmlFor="billing-days" className="font-normal text-sm">X дней</Label>
                                  </div>
                                </RadioGroup>
                                {offerForm.meta?.recurring?.billing_period_mode === 'days' && (
                                  <Input
                                    type="number"
                                    min={1}
                                    max={90}
                                    value={offerForm.meta?.recurring?.billing_period_days || 30}
                                    onChange={(e) => setOfferForm({
                                      ...offerForm,
                                      meta: {
                                        ...offerForm.meta,
                                        recurring: {
                                          ...offerForm.meta?.recurring,
                                          billing_period_days: parseInt(e.target.value) || 30,
                                        }
                                      }
                                    })}
                                    className="w-24"
                                  />
                                )}
                              </div>
                              
                              <Separator />

                              {/* Grace period and attempts */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                  <Label className="text-sm">Grace период (часов)</Label>
                                  <Input
                                    type="number"
                                    min={24}
                                    max={168}
                                    value={offerForm.meta?.recurring?.grace_hours || 72}
                                    onChange={(e) => setOfferForm({
                                      ...offerForm,
                                      meta: {
                                        ...offerForm.meta,
                                        recurring: {
                                          ...offerForm.meta?.recurring,
                                          grace_hours: parseInt(e.target.value) || 72,
                                        }
                                      }
                                    })}
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    Время для возврата по старой цене
                                  </p>
                                </div>
                                
                                <div className="space-y-2">
                                  <Label className="text-sm">Попыток в сутки</Label>
                                  <Select
                                    value={String(offerForm.meta?.recurring?.charge_attempts_per_day || 2)}
                                    onValueChange={(v) => setOfferForm({
                                      ...offerForm,
                                      meta: {
                                        ...offerForm.meta,
                                        recurring: {
                                          ...offerForm.meta?.recurring,
                                          charge_attempts_per_day: parseInt(v),
                                        }
                                      }
                                    })}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1 раз</SelectItem>
                                      <SelectItem value="2">2 раза (утро/вечер)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>

                              {/* Timezone */}
                              <div className="space-y-2">
                                <Label className="text-sm">Часовой пояс</Label>
                                <Select
                                  value={offerForm.meta?.recurring?.timezone || 'Europe/Minsk'}
                                  onValueChange={(v) => setOfferForm({
                                    ...offerForm,
                                    meta: {
                                      ...offerForm.meta,
                                      recurring: {
                                        ...offerForm.meta?.recurring,
                                        timezone: v,
                                      }
                                    }
                                  })}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Europe/Minsk">Europe/Minsk (UTC+3)</SelectItem>
                                    <SelectItem value="Europe/Moscow">Europe/Moscow (UTC+3)</SelectItem>
                                    <SelectItem value="Europe/Warsaw">Europe/Warsaw (UTC+1/+2)</SelectItem>
                                    <SelectItem value="UTC">UTC</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <Separator />

                              {/* Charge times */}
                              <div className="space-y-2">
                                <Label className="text-sm">Время попыток списания</Label>
                                <div className="flex gap-2 flex-wrap">
                                  {Array.from({ length: offerForm.meta?.recurring?.charge_attempts_per_day || 2 }).map((_, idx) => (
                                    <Input
                                      key={idx}
                                      type="time"
                                      value={(offerForm.meta?.recurring?.charge_times_local || ['09:00', '21:00'])[idx] || '12:00'}
                                      onChange={(e) => {
                                        const currentTimes = [...(offerForm.meta?.recurring?.charge_times_local || ['09:00', '21:00'])];
                                        currentTimes[idx] = e.target.value;
                                        setOfferForm({
                                          ...offerForm,
                                          meta: {
                                            ...offerForm.meta,
                                            recurring: {
                                              ...offerForm.meta?.recurring,
                                              charge_times_local: currentTimes,
                                            }
                                          }
                                        });
                                      }}
                                      className="w-24"
                                    />
                                  ))}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Время в выбранном часовом поясе (±15 мин допуск)
                                </p>
                              </div>
                              
                              {/* Pre-due reminders */}
                              <div className="space-y-2">
                                <Label className="text-sm">Напоминания до списания (дней)</Label>
                                <div className="flex gap-3">
                                  {[7, 3, 1].map(day => {
                                    const currentDays = offerForm.meta?.recurring?.pre_due_reminders_days || [7, 3, 1];
                                    const isChecked = currentDays.includes(day);
                                    return (
                                      <label key={day} className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={(e) => {
                                            const newDays = e.target.checked
                                              ? [...currentDays, day].sort((a, b) => b - a)
                                              : currentDays.filter(d => d !== day);
                                            setOfferForm({
                                              ...offerForm,
                                              meta: {
                                                ...offerForm.meta,
                                                recurring: {
                                                  ...offerForm.meta?.recurring,
                                                  pre_due_reminders_days: newDays,
                                                }
                                              }
                                            });
                                          }}
                                          className="rounded border-border"
                                        />
                                        <span className="text-sm">{day} {day === 1 ? 'день' : 'дней'}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              
                              <Separator />

                              {/* Notification toggles */}
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <Label className="text-sm font-normal">Уведомлять перед списанием</Label>
                                  <Switch
                                    checked={offerForm.meta?.recurring?.notify_before_each_charge ?? true}
                                    onCheckedChange={(checked) => setOfferForm({
                                      ...offerForm,
                                      meta: {
                                        ...offerForm.meta,
                                        recurring: {
                                          ...offerForm.meta?.recurring,
                                          notify_before_each_charge: checked,
                                        }
                                      }
                                    })}
                                  />
                                </div>
                                
                                <div className="flex items-center justify-between">
                                  <Label className="text-sm font-normal">Уведомления в grace (0/24/48/72ч)</Label>
                                  <Switch
                                    checked={offerForm.meta?.recurring?.notify_grace_events ?? true}
                                    onCheckedChange={(checked) => setOfferForm({
                                      ...offerForm,
                                      meta: {
                                        ...offerForm.meta,
                                        recurring: {
                                          ...offerForm.meta?.recurring,
                                          notify_grace_events: checked,
                                        }
                                      }
                                    })}
                                  />
                                </div>
                              </div>
                              
                            </CardContent>
                          </Card>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {offerForm.offer_type === "trial" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Настройки Trial</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Дней trial</Label>
                      <Input
                        type="number"
                        value={offerForm.trial_days === 0 ? "" : offerForm.trial_days}
                        onChange={(e) => setOfferForm({ ...offerForm, trial_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                        onBlur={() => { if (offerForm.trial_days < 1) setOfferForm({ ...offerForm, trial_days: 1 }); }}
                        min={1}
                      />
                    </div>
                    {/* auto_charge_delay_days removed: field exists in DB but is not used by runtime logic. Actual charge timing is determined by trial_days. */}
                  </div>

                  <Separator />

                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={offerForm.auto_charge_after_trial}
                      onCheckedChange={(checked) => setOfferForm({ ...offerForm, auto_charge_after_trial: checked })}
                    />
                    <Label>Автосписание после trial</Label>
                  </div>

                  {offerForm.auto_charge_after_trial && (
                    <div className="space-y-2">
                      <Label>Кнопка для автосписания *</Label>
                      <Select
                        value={offerForm.auto_charge_offer_id}
                        onValueChange={(v) => setOfferForm({ ...offerForm, auto_charge_offer_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите кнопку полной оплаты" />
                        </SelectTrigger>
                        <SelectContent>
                          {payNowOffersForTariff.length === 0 ? (
                            <div className="p-2 text-sm text-muted-foreground">
                              Сначала создайте кнопку "Оплата" для этого тарифа
                            </div>
                          ) : (
                            payNowOffersForTariff.map((offer: any) => (
                              <SelectItem key={offer.id} value={offer.id}>
                                {offer.button_label} — {offer.amount} BYN
                                {offer.is_primary && " (основная)"}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Preregistration settings */}
            {offerForm.offer_type === "preregistration" && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Настройки Предзаписи
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Дата первого списания
                      </Label>
                      <DatePicker
                        value={offerForm.preregistration_first_charge_date}
                        onChange={(v) => setOfferForm({ ...offerForm, preregistration_first_charge_date: v })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Bell className="h-3.5 w-3.5" />
                        Уведомить за (дней)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={30}
                        value={offerForm.preregistration_notify_before_days}
                        onChange={(e) => setOfferForm({ ...offerForm, preregistration_notify_before_days: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label>Кнопка для списания</Label>
                    <Select
                      value={offerForm.preregistration_charge_offer_id}
                      onValueChange={(v) => setOfferForm({ ...offerForm, preregistration_charge_offer_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите кнопку оплаты" />
                      </SelectTrigger>
                      <SelectContent>
                        {payNowOffersForTariff.length === 0 ? (
                          <div className="p-2 text-sm text-muted-foreground">
                            Сначала создайте кнопку "Оплата" для этого тарифа
                          </div>
                        ) : (
                          payNowOffersForTariff.map((offer: any) => (
                            <SelectItem key={offer.id} value={offer.id}>
                              {offer.button_label} — {offer.amount} BYN
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      После даты старта будет выполнено списание по этой кнопке
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Окно списания (с числа)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={28}
                        value={offerForm.preregistration_charge_window_start}
                        onChange={(e) => setOfferForm({ ...offerForm, preregistration_charge_window_start: parseInt(e.target.value) || 1 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>по (число месяца)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={28}
                        value={offerForm.preregistration_charge_window_end}
                        onChange={(e) => setOfferForm({ ...offerForm, preregistration_charge_window_end: parseInt(e.target.value) || 4 })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 pt-2">
                    <Switch
                      checked={offerForm.preregistration_auto_convert}
                      onCheckedChange={(checked) => setOfferForm({ ...offerForm, preregistration_auto_convert: checked })}
                    />
                    <div>
                      <Label>Автоматически скрыть после даты старта</Label>
                      <p className="text-xs text-muted-foreground">
                        Показывать вместо предзаписи связанную кнопку оплаты
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Advanced Settings - Collapsible */}
            <Collapsible className="border-t pt-4">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between px-0 hover:bg-transparent">
                  <span className="text-sm font-medium text-muted-foreground">Расширенные настройки</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                {/* Virtual card blocking */}
                {(offerForm.requires_card_tokenization || offerForm.offer_type === "trial" || offerForm.payment_method === "internal_installment") && (
                  <div className="flex items-center space-x-2 p-3 rounded-lg border">
                    <Switch
                      checked={offerForm.reject_virtual_cards}
                      onCheckedChange={(checked) => setOfferForm({ ...offerForm, reject_virtual_cards: checked })}
                    />
                    <div>
                      <Label className="cursor-pointer">Блокировать виртуальные карты</Label>
                      <p className="text-xs text-muted-foreground">
                        Принимать только физические банковские карты
                      </p>
                    </div>
                  </div>
                )}

                {/* GetCourse code */}
                <div className="space-y-2">
                  <Label>GetCourse код предложения</Label>
                  <Input
                    placeholder="например: offer_12345"
                    value={offerForm.getcourse_offer_id}
                    onChange={(e) => setOfferForm({ ...offerForm, getcourse_offer_id: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Код для автоматического проброса в GetCourse
                  </p>
                </div>

                {/* Welcome Message Editor */}
                <OfferWelcomeMessageEditor
                  offerId={offerDialog.editing?.id || null}
                  meta={offerForm.meta}
                  onMetaChange={(newMeta) => setOfferForm({ ...offerForm, meta: newMeta })}
                />

                {/* CRM Routing Section — Layer A: offer-driven первичная оплата */}
                <OfferCrmRoutingSection
                  value={offerForm.meta?.crm_routing}
                  onChange={(next) => setOfferForm({
                    ...offerForm,
                    meta: { ...offerForm.meta, crm_routing: next },
                  })}
                />

                {/* Sprint 10: defaults for document generation */}
                <OfferDocumentDefaultsCard
                  value={offerForm.meta?.document_defaults}
                  onChange={(next) => setOfferForm({
                    ...offerForm,
                    meta: { ...offerForm.meta, document_defaults: next },
                  })}
                />
              </CollapsibleContent>
            </Collapsible>

            <Separator />

            <div className="flex items-center space-x-2">
              <Switch
                checked={offerForm.is_active}
                onCheckedChange={(checked) => setOfferForm({ ...offerForm, is_active: checked })}
              />
              <Label>Активна</Label>
            </div>

            {offerForm.offer_type === "pay_now" && (
              <div className="flex items-center space-x-2">
                <Switch
                  checked={offerForm.is_primary}
                  onCheckedChange={(checked) => setOfferForm({ ...offerForm, is_primary: checked })}
                />
                <Label>Основная цена</Label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveOffer}>
              {offerDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Flow Dialog */}
      <Dialog open={flowDialog.open} onOpenChange={(open) => setFlowDialog({ ...flowDialog, open })}>
        <DialogContent className="w-[calc(100vw-1.5rem)] sm:w-full overflow-hidden p-0 bg-background">
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {flowDialog.editing ? "Редактировать поток" : "Новый поток"}
            </DialogTitle>
          </DialogHeader>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Настройки потока</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Код *</Label>
                  <Input
                    placeholder="flow_jan_2026"
                    value={flowForm.code}
                    onChange={(e) => setFlowForm({ ...flowForm, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Название *</Label>
                  <Input
                    placeholder="Поток январь 2026"
                    value={flowForm.name}
                    onChange={(e) => setFlowForm({ ...flowForm, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Дата старта</Label>
                  <DatePicker
                    value={flowForm.start_date}
                    onChange={(v) => setFlowForm({ ...flowForm, start_date: v })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Дата окончания</Label>
                  <DatePicker
                    value={flowForm.end_date}
                    onChange={(v) => setFlowForm({ ...flowForm, end_date: v })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Макс. участников (пусто = без ограничений)</Label>
                <Input
                  type="number"
                  value={flowForm.max_participants || ""}
                  onChange={(e) => setFlowForm({ 
                    ...flowForm, 
                    max_participants: e.target.value ? parseInt(e.target.value) : null 
                  })}
                />
              </div>
              <Separator />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={flowForm.is_default}
                    onCheckedChange={(checked) => setFlowForm({ ...flowForm, is_default: checked })}
                  />
                  <Label>По умолчанию</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={flowForm.is_active}
                    onCheckedChange={(checked) => setFlowForm({ ...flowForm, is_active: checked })}
                  />
                  <Label>Активен</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFlowDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveFlow}>
              {flowDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation — Tariff/Offer with safety check */}
      <TariffDeleteConfirmDialog
        open={!!deleteConfirm && (deleteConfirm.type === "tariff" || deleteConfirm.type === "offer")}
        entityType={(deleteConfirm?.type === "offer" ? "offer" : "tariff") as "tariff" | "offer"}
        entityId={deleteConfirm && (deleteConfirm.type === "tariff" || deleteConfirm.type === "offer") ? deleteConfirm.id : null}
        onClose={() => setDeleteConfirm(null)}
      />

      {/* Delete Confirmation — Flow (simple) */}
      <Dialog open={!!deleteConfirm && deleteConfirm.type === "flow"} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить поток?</DialogTitle>
            <DialogDescription>
              Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={!!bulkDeleteConfirm} onOpenChange={() => setBulkDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Удалить {bulkDeleteConfirm?.ids.length}{" "}
              {bulkDeleteConfirm?.type === "tariff" ? "тарифов" : bulkDeleteConfirm?.type === "offer" ? "кнопок оплаты" : "потоков"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Payment Dialog for Preview Testing */}
      {selectedOfferForPayment && (
        <PaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          productId={productId!}
          productName={`${product.name} – ${selectedOfferForPayment.tariff.name}`}
          offerId={selectedOfferForPayment.offer.id}
          price={String(selectedOfferForPayment.offer.amount)}
          tariffCode={selectedOfferForPayment.tariff.code}
          isTrial={selectedOfferForPayment.offer.offer_type === "trial"}
          trialDays={selectedOfferForPayment.offer.trial_days}
          isClubProduct={!!(product as any).telegram_club_id}
          isSubscription={
            !!selectedOfferForPayment.offer.requires_card_tokenization &&
            selectedOfferForPayment.offer.payment_method !== "internal_installment"
          }
          paymentMethod={selectedOfferForPayment.offer.payment_method}
          installmentCount={selectedOfferForPayment.offer.installment_count ?? null}
        />
      )}
    </AdminLayout>
  );
}
