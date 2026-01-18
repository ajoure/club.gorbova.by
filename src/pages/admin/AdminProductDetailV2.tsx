import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParams, useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GlassCard } from "@/components/ui/GlassCard";
import { 
  ArrowLeft, Plus, Tag, MousePointer, Users, Eye, Globe, CreditCard, ChevronDown, Calendar, Bell
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { TariffFeaturesEditor } from "@/components/admin/TariffFeaturesEditor";
import { TariffCardCompact } from "@/components/admin/product/TariffCardCompact";
import { OfferRowCompact } from "@/components/admin/product/OfferRowCompact";
import { TariffPreviewCard } from "@/components/admin/product/TariffPreviewCard";
import { TariffWelcomeMessageEditor, type TariffMetaConfig } from "@/components/admin/product/TariffWelcomeMessageEditor";
import { OfferWelcomeMessageEditor } from "@/components/admin/product/OfferWelcomeMessageEditor";
import { PaymentDialog } from "@/components/payment/PaymentDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useProductV2,
  useTariffs, useCreateTariff, useUpdateTariff, useDeleteTariff,
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

  const { data: product, isLoading: productLoading } = useProductV2(productId || null);
  const { data: tariffs, refetch: refetchTariffs } = useTariffs(productId);
  const { data: flows } = useFlows(productId);
  const { data: offers, refetch: refetchOffers } = useProductOffers(productId);
  
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
    period_label: "BYN/мес",
    is_popular: false,
    badge: "",
    access_days: 30,
    is_active: true,
    meta: {} as TariffMetaConfig,
  });

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
      // Parse meta from tariff
      const meta = (tariff.meta || {}) as TariffMetaConfig;
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
      });
      setTariffDialog({ open: true, editing: tariff });
    } else {
      setTariffForm({
        code: "",
        name: "",
        description: "",
        subtitle: "",
        period_label: "BYN/мес",
        is_popular: false,
        badge: "",
        access_days: 30,
        is_active: true,
        meta: {},
      });
      setTariffDialog({ open: true, editing: null });
    }
  };

  const handleSaveTariff = async () => {
    if (!tariffForm.code || !tariffForm.name) {
      toast.error("Заполните код и название");
      return;
    }
    // Build data with meta field
    const { meta, ...formWithoutMeta } = tariffForm;
    const data: any = { 
      ...formWithoutMeta, 
      product_id: productId!,
      meta: Object.keys(meta).length > 0 ? meta : null,
    };
    if (tariffDialog.editing) {
      await updateTariff.mutateAsync({ id: tariffDialog.editing.id, ...data });
    } else {
      await createTariff.mutateAsync(data);
    }
    setTariffDialog({ open: false, editing: null });
    refetchTariffs();
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
    const isInstallment = offerForm.payment_method === "internal_installment";
    const isPreregistration = offerForm.offer_type === "preregistration";
    
    // Build meta object with preregistration settings if applicable
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
      // Installment fields
      payment_method: offerForm.offer_type === "pay_now" ? offerForm.payment_method : "full_payment",
      installment_count: isInstallment ? offerForm.installment_count : null,
      installment_interval_days: isInstallment ? offerForm.installment_interval_days : null,
      first_payment_delay_days: isInstallment ? offerForm.first_payment_delay_days : null,
      // Meta field for welcome message + preregistration settings
      meta: Object.keys(metaToSave).length > 0 ? metaToSave : null,
    };
    if (offerDialog.editing) {
      await updateOffer.mutateAsync({ id: offerDialog.editing.id, ...data });
    } else {
      await createOffer.mutateAsync(data);
    }
    setOfferDialog({ open: false, editing: null });
    refetchOffers();
  };

  const handleToggleOfferActive = async (id: string, isActive: boolean) => {
    await updateOffer.mutateAsync({ id, is_active: isActive });
    refetchOffers();
  };

  const handleUpdateOfferLabel = async (id: string, label: string) => {
    await updateOffer.mutateAsync({ id, button_label: label });
    refetchOffers();
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

  // Delete handler
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    switch (deleteConfirm.type) {
      case "tariff":
        await deleteTariff.mutateAsync(deleteConfirm.id);
        refetchTariffs();
        break;
      case "offer":
        await deleteOffer.mutateAsync(deleteConfirm.id);
        refetchOffers();
        break;
      case "flow":
        await deleteFlow.mutateAsync(deleteConfirm.id);
        break;
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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin/products-v2")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{product.name}</h1>
              <Badge variant={product.is_active ? "default" : "secondary"}>
                {product.is_active ? "Активен" : "Неактивен"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Код: <code className="bg-muted px-2 py-0.5 rounded">{product.code}</code>
            </p>
          </div>
          {(product as any).primary_domain && (
            <Button variant="outline" asChild>
              <a href={`https://${(product as any).primary_domain}`} target="_blank" rel="noopener noreferrer">
                <Globe className="h-4 w-4 mr-2" />
                {(product as any).primary_domain}
              </a>
            </Button>
          )}
        </div>

        <Tabs defaultValue="tariffs">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="tariffs" className="gap-2">
              <Tag className="h-4 w-4" />
              Тарифы
            </TabsTrigger>
            <TabsTrigger value="offers" className="gap-2">
              <MousePointer className="h-4 w-4" />
              Кнопки оплаты
            </TabsTrigger>
            <TabsTrigger value="flows" className="gap-2">
              <Users className="h-4 w-4" />
              Потоки
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-2">
              <Eye className="h-4 w-4" />
              Превью
            </TabsTrigger>
          </TabsList>

          {/* Tariffs Tab */}
          <TabsContent value="tariffs" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">Тарифы</h2>
                <p className="text-sm text-muted-foreground">
                  Тариф = пакет доступа. Цены задаются в кнопках оплаты.
                </p>
              </div>
              <Button onClick={() => openTariffDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить тариф
              </Button>
            </div>

            {!tariffs?.length ? (
              <GlassCard className="py-12 text-center text-muted-foreground">
                Нет тарифов. Создайте первый тариф для этого продукта.
              </GlassCard>
            ) : (
              <div className="space-y-3">
                {tariffs.map((tariff) => (
                  <TariffCardCompact
                    key={tariff.id}
                    tariff={tariff}
                    offers={getOffersForTariff(tariff.id)}
                    onEdit={() => openTariffDialog(tariff)}
                    onDelete={() => setDeleteConfirm({ type: "tariff", id: tariff.id })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Offers Tab */}
          <TabsContent value="offers" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">Кнопки оплаты</h2>
                <p className="text-sm text-muted-foreground">
                  Кнопка = способ покупки тарифа. Здесь задаётся цена.
                </p>
              </div>
              <Button onClick={() => openOfferDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить кнопку
              </Button>
            </div>

            {!offers?.length ? (
              <GlassCard className="py-12 text-center text-muted-foreground">
                Нет кнопок оплаты. Создайте кнопки для отображения на сайте.
              </GlassCard>
            ) : (
              <div className="space-y-6">
                {tariffs?.map((tariff) => {
                  const tariffOffers = getOffersForTariff(tariff.id);
                  if (!tariffOffers.length) return null;
                  
                  const hasActivePayOffer = tariffOffers.some((o: any) => o.offer_type === 'pay_now' && o.is_active);
                  
                  return (
                    <GlassCard key={tariff.id} className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{tariff.name}</span>
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{tariff.code}</code>
                        {!hasActivePayOffer && (
                          <Badge variant="destructive" className="text-xs">
                            Нет основной цены
                          </Badge>
                        )}
                      </div>
                      <div className="space-y-2">
                        {tariffOffers.map((offer: any) => (
                          <OfferRowCompact
                            key={offer.id}
                            offer={offer}
                            onToggleActive={handleToggleOfferActive}
                            onUpdateLabel={handleUpdateOfferLabel}
                            onSetPrimary={(offerId) => setPrimaryOffer.mutate({ offerId, tariffId: tariff.id })}
                            onEdit={() => openOfferDialog(offer)}
                            onDelete={() => setDeleteConfirm({ type: "offer", id: offer.id })}
                            hasPrimaryInTariff={hasActivePayOffer}
                          />
                        ))}
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Flows Tab */}
          <TabsContent value="flows" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">Потоки</h2>
                <p className="text-sm text-muted-foreground">
                  Потоки для запуска продукта в разное время
                </p>
              </div>
              <Button onClick={() => openFlowDialog()}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить поток
              </Button>
            </div>

            {!flows?.length ? (
              <GlassCard className="py-12 text-center text-muted-foreground">
                Нет потоков.
              </GlassCard>
            ) : (
              <div className="space-y-2">
                {flows.map((flow) => (
                  <GlassCard key={flow.id} className="p-4">
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
                      <div className="flex items-center gap-2">
                        <Badge variant={flow.is_active ? "default" : "secondary"}>
                          {flow.is_active ? "Активен" : "Неактивен"}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => openFlowDialog(flow)}>
                          Редактировать
                        </Button>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Preview Tab */}
          <TabsContent value="preview" className="space-y-4 mt-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-lg font-semibold">Превью секции тарифов</h2>
                <p className="text-sm text-muted-foreground">
                  Так будет выглядеть секция на сайте
                </p>
              </div>
            </div>

            <GlassCard className="p-8">
              {/* Section Header */}
              <div className="text-center mb-8">
                <h2 className="text-3xl font-bold mb-2">
                  {(product as any).public_title || "Тарифы"}
                </h2>
                <p className="text-muted-foreground">
                  {(product as any).public_subtitle || "Выберите подходящий вариант"}
                </p>
              </div>

              {/* Tariff Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {tariffs?.filter(t => t.is_active).map((tariff: any) => (
                  <TariffPreviewCard
                    key={tariff.id}
                    tariff={tariff}
                    features={getFeaturesForTariff(tariff.id)}
                    offers={getOffersForTariff(tariff.id)}
                    onSelectOffer={handlePreviewSelectOffer}
                  />
                ))}
              </div>

              {/* Disclaimer */}
              {(product as any).payment_disclaimer_text && (
                <p className="text-center text-sm text-muted-foreground mt-8">
                  {(product as any).payment_disclaimer_text}
                </p>
              )}
            </GlassCard>
          </TabsContent>
        </Tabs>
      </div>

      {/* Tariff Dialog */}
      <Dialog open={tariffDialog.open} onOpenChange={(open) => setTariffDialog({ ...tariffDialog, open })}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tariffDialog.editing ? "Редактировать тариф" : "Новый тариф"}
            </DialogTitle>
            <DialogDescription>
              Тариф определяет пакет доступа. Цены задаются отдельно в кнопках оплаты.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Код *</Label>
                <Input
                  placeholder="full"
                  value={tariffForm.code}
                  onChange={(e) => setTariffForm({ ...tariffForm, code: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input
                  placeholder="CLUB FULL"
                  value={tariffForm.name}
                  onChange={(e) => setTariffForm({ ...tariffForm, name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Подзаголовок</Label>
                <Input
                  placeholder="Самый популярный"
                  value={tariffForm.subtitle}
                  onChange={(e) => setTariffForm({ ...tariffForm, subtitle: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Период (label)</Label>
                <Input
                  placeholder="BYN/мес"
                  value={tariffForm.period_label}
                  onChange={(e) => setTariffForm({ ...tariffForm, period_label: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                <Label>Бейдж (на карточке)</Label>
                <Input
                  placeholder="Популярный"
                  value={tariffForm.badge}
                  onChange={(e) => setTariffForm({ ...tariffForm, badge: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Описание</Label>
              <Textarea
                value={tariffForm.description}
                onChange={(e) => setTariffForm({ ...tariffForm, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center space-x-2">
                <Switch
                  checked={tariffForm.is_popular}
                  onCheckedChange={(checked) => setTariffForm({ ...tariffForm, is_popular: checked })}
                />
                <Label>Популярный</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch
                  checked={tariffForm.is_active}
                  onCheckedChange={(checked) => setTariffForm({ ...tariffForm, is_active: checked })}
                />
                <Label>Активен</Label>
              </div>
            </div>

            {/* Features Editor */}
            {tariffDialog.editing && (
              <div className="border-t pt-4">
                <Label className="mb-3 block">Преимущества (галочки)</Label>
                <TariffFeaturesEditor tariffId={tariffDialog.editing.id} />
              </div>
            )}

            {/* Welcome Message Editor */}
            <div className="border-t pt-4">
              <TariffWelcomeMessageEditor
                tariffId={tariffDialog.editing?.id || null}
                meta={tariffForm.meta}
                onMetaChange={(newMeta) => setTariffForm({ ...tariffForm, meta: newMeta })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTariffDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveTariff}>
              {tariffDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Offer Dialog */}
      <Dialog open={offerDialog.open} onOpenChange={(open) => setOfferDialog({ ...offerDialog, open })}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="pr-8">
            <DialogTitle>
              {offerDialog.editing ? "Редактировать кнопку" : "Новая кнопка оплаты"}
            </DialogTitle>
            <DialogDescription>
              Кнопка = способ покупки. Здесь задаётся цена и условия.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
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
                      {tariff.name} ({tariff.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Тип кнопки *</Label>
              <Select
                value={offerForm.offer_type}
                onValueChange={(v: "pay_now" | "trial" | "preregistration") => {
                  setOfferForm({ 
                    ...offerForm, 
                    offer_type: v,
                    button_label: v === "trial" ? "Trial 1 BYN / 5 дней" : v === "preregistration" ? "Забронировать место" : "Оплатить",
                    requires_card_tokenization: v === "trial" || v === "preregistration",
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pay_now">Оплата (полная стоимость)</SelectItem>
                  <SelectItem value="trial">Trial (пробный период)</SelectItem>
                  <SelectItem value="preregistration">Предзапись (привязка карты)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
                  value={offerForm.amount}
                  onChange={(e) => setOfferForm({ ...offerForm, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            {/* Reentry pricing - for former club members */}
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <span className="font-medium text-sm">💰 Цена для повторного вступления</span>
              </div>
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
            </div>

            {offerForm.offer_type === "pay_now" && (
              <div className="border-t pt-4 space-y-4">
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Способ оплаты</Label>
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
                    <div className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <RadioGroupItem value="internal_installment" id="internal_installment" />
                      <Label htmlFor="internal_installment" className="cursor-pointer flex-1">
                        <div className="font-medium flex items-center gap-2">
                          <CreditCard className="h-4 w-4" />
                          Внутренняя рассрочка
                        </div>
                        <div className="text-xs text-muted-foreground">Автоматические списания по графику</div>
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
                </div>

                {/* Installment settings */}
                {offerForm.payment_method === "internal_installment" && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg space-y-4">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <CreditCard className="h-4 w-4" />
                      <span className="font-medium text-sm">Настройка рассрочки</span>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Количество платежей</Label>
                        <Input
                          type="number"
                          min={2}
                          max={24}
                          value={offerForm.installment_count === 0 ? "" : offerForm.installment_count}
                          onChange={(e) => setOfferForm({ ...offerForm, installment_count: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                          onBlur={() => { if (offerForm.installment_count < 2) setOfferForm({ ...offerForm, installment_count: 2 }); }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Интервал (дней)</Label>
                        <Input
                          type="number"
                          min={7}
                          max={90}
                          value={offerForm.installment_interval_days === 0 ? "" : offerForm.installment_interval_days}
                          onChange={(e) => setOfferForm({ ...offerForm, installment_interval_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                          onBlur={() => { if (offerForm.installment_interval_days < 7) setOfferForm({ ...offerForm, installment_interval_days: 7 }); }}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Первый платёж через (дней)</Label>
                      <div className="flex items-center gap-4">
                        <Input
                          type="number"
                          min={0}
                          max={30}
                          value={offerForm.first_payment_delay_days}
                          onChange={(e) => setOfferForm({ ...offerForm, first_payment_delay_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                          className="w-24"
                        />
                        <span className="text-sm text-muted-foreground">
                          {offerForm.first_payment_delay_days === 0 ? "Сразу при покупке" : `Через ${offerForm.first_payment_delay_days} дней`}
                        </span>
                      </div>
                    </div>

                    {/* Payment schedule preview */}
                    {offerForm.amount > 0 && offerForm.installment_count > 1 && (
                      <div className="pt-3 border-t border-amber-200 dark:border-amber-800">
                        <Label className="text-xs text-amber-700 dark:text-amber-300">График платежей:</Label>
                        <div className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
                          {Array.from({ length: offerForm.installment_count }, (_, i) => {
                            const perPayment = offerForm.amount / offerForm.installment_count;
                            const delay = offerForm.first_payment_delay_days + (i * offerForm.installment_interval_days);
                            return (
                              <div key={i} className="flex justify-between text-sm">
                                <span className="text-amber-700 dark:text-amber-300">
                                  {i + 1}. {delay === 0 ? "При покупке" : `Через ${delay} дн.`}
                                </span>
                                <span className="font-medium text-amber-900 dark:text-amber-100">
                                  {perPayment.toFixed(2)} BYN
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800 flex justify-between text-sm font-medium">
                          <span className="text-amber-700 dark:text-amber-300">Итого:</span>
                          <span className="text-amber-900 dark:text-amber-100">{offerForm.amount} BYN</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Subscription toggle - only for full payment */}
                {offerForm.payment_method === "full_payment" && (
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
                        ? "Карта будет сохранена для автоматического продления" 
                        : "Разовый платёж без сохранения карты"}
                    </p>
                  </div>
                )}
              </div>
            )}

            {offerForm.offer_type === "trial" && (
              <>
                <div className="border-t pt-4">
                  <h4 className="font-medium mb-3 text-sm">Настройки Trial</h4>
                  <div className="grid grid-cols-2 gap-4">
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
                    <div className="space-y-2">
                      <Label>Автосписание через (дн.)</Label>
                      <Input
                        type="number"
                        value={offerForm.auto_charge_delay_days === 0 ? "" : offerForm.auto_charge_delay_days}
                        onChange={(e) => setOfferForm({ ...offerForm, auto_charge_delay_days: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 })}
                        onBlur={() => { if (offerForm.auto_charge_delay_days < 1) setOfferForm({ ...offerForm, auto_charge_delay_days: 1 }); }}
                        min={1}
                      />
                    </div>
                  </div>
                </div>

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

            {/* Preregistration settings */}
            {offerForm.offer_type === "preregistration" && (
              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <Calendar className="h-4 w-4" />
                  <h4 className="font-medium text-sm">Настройки Предзаписи</h4>
                </div>
                
                <div className="space-y-4 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Дата первого списания
                      </Label>
                      <Input
                        type="date"
                        value={offerForm.preregistration_first_charge_date}
                        onChange={(e) => setOfferForm({ ...offerForm, preregistration_first_charge_date: e.target.value })}
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

                  <div className="grid grid-cols-2 gap-4">
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
                </div>
              </div>
            )}

            {/* Virtual card blocking - show when tokenization is required or installment */}
            {(offerForm.requires_card_tokenization || offerForm.offer_type === "trial" || offerForm.payment_method === "internal_installment") && (
              <div className="border-t pt-4">
                <div className="flex items-center space-x-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <Switch
                    checked={offerForm.reject_virtual_cards}
                    onCheckedChange={(checked) => setOfferForm({ ...offerForm, reject_virtual_cards: checked })}
                  />
                  <div>
                    <Label className="cursor-pointer">Блокировать виртуальные карты</Label>
                    <p className="text-xs text-muted-foreground">
                      Принимать только физические банковские карты (для рассрочки)
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t pt-4 space-y-2">
              <Label>GetCourse код предложения</Label>
              <Input
                placeholder="например: offer_12345"
                value={offerForm.getcourse_offer_id}
                onChange={(e) => setOfferForm({ ...offerForm, getcourse_offer_id: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Код предложения для автоматического проброса в GetCourse при выдаче доступа
              </p>
            </div>

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

            {/* Welcome Message Editor for Offer */}
            <div className="border-t pt-4">
              <OfferWelcomeMessageEditor
                offerId={offerDialog.editing?.id || null}
                meta={offerForm.meta}
                onMetaChange={(newMeta) => setOfferForm({ ...offerForm, meta: newMeta })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveOffer}>
              {offerDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Flow Dialog */}
      <Dialog open={flowDialog.open} onOpenChange={(open) => setFlowDialog({ ...flowDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {flowDialog.editing ? "Редактировать поток" : "Новый поток"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Дата старта</Label>
                <Input
                  type="date"
                  value={flowForm.start_date}
                  onChange={(e) => setFlowForm({ ...flowForm, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Дата окончания</Label>
                <Input
                  type="date"
                  value={flowForm.end_date}
                  onChange={(e) => setFlowForm({ ...flowForm, end_date: e.target.value })}
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
            <div className="flex items-center gap-6">
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFlowDialog({ open: false, editing: null })}>
              Отмена
            </Button>
            <Button onClick={handleSaveFlow}>
              {flowDialog.editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подтвердите удаление</DialogTitle>
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

      {/* Payment Dialog for Preview Testing */}
      {selectedOfferForPayment && (
        <PaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          productId={productId!}
          productName={`${product.name} – ${selectedOfferForPayment.tariff.name}`}
          offerId={selectedOfferForPayment.offer.id}
          price={String(selectedOfferForPayment.offer.amount)}
          isTrial={selectedOfferForPayment.offer.offer_type === "trial"}
          trialDays={selectedOfferForPayment.offer.trial_days}
          isClubProduct={!!(product as any).telegram_club_id}
        />
      )}
    </AdminLayout>
  );
}
