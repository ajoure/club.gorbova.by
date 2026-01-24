import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BepaidMapping {
  id: string;
  bepaid_plan_title: string;
  bepaid_description: string | null;
  product_id: string | null;
  tariff_id: string | null;
  offer_id: string | null;
  is_subscription: boolean;
  auto_create_order: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  product_name?: string | null;
  tariff_name?: string | null;
  offer_name?: string | null;
}

export interface UnmappedProduct {
  bepaid_plan_title: string;
  count: number;
  sample_description?: string | null;
  sample_amount?: number | null;
}

export function useBepaidMappings() {
  const queryClient = useQueryClient();

  // Fetch existing mappings with joined product/tariff info
  const { data: mappings, isLoading: mappingsLoading, refetch: refetchMappings } = useQuery({
    queryKey: ["bepaid-mappings"],
    queryFn: async () => {
      // Use type assertion for new table
      const { data, error } = await supabase
        .from("bepaid_product_mappings" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get product, tariff, offer names
      const productIds = [...new Set((data || []).filter((m: any) => m.product_id).map((m: any) => m.product_id))];
      const tariffIds = [...new Set((data || []).filter((m: any) => m.tariff_id).map((m: any) => m.tariff_id))];
      const offerIds = [...new Set((data || []).filter((m: any) => m.offer_id).map((m: any) => m.offer_id))];

      const [productsResult, tariffsResult, offersResult] = await Promise.all([
        productIds.length > 0 ? supabase.from("products_v2").select("id, name").in("id", productIds) : { data: [] },
        tariffIds.length > 0 ? supabase.from("tariffs").select("id, name").in("id", tariffIds) : { data: [] },
        offerIds.length > 0 ? supabase.from("tariff_offers").select("id, button_label, amount, trial_days").in("id", offerIds) : { data: [] },
      ]);

      const productsMap = new Map((productsResult.data || []).map(p => [p.id, p.name]));
      const tariffsMap = new Map((tariffsResult.data || []).map(t => [t.id, t.name]));
      const offersMap = new Map((offersResult.data || []).map((o: any) => [
        o.id, 
        o.button_label || (o.amount ? `${o.amount} BYN${o.trial_days ? ` / ${o.trial_days}д` : ''}` : 'Offer')
      ]));

      return (data || []).map((m: any): BepaidMapping => ({
        ...m,
        product_name: productsMap.get(m.product_id) || null,
        tariff_name: tariffsMap.get(m.tariff_id) || null,
        offer_name: offersMap.get(m.offer_id) || null,
      }));
    },
  });

  // Find unmapped products from queue
  const { data: unmappedProducts, isLoading: unmappedLoading, refetch: refetchUnmapped } = useQuery({
    queryKey: ["bepaid-unmapped-products"],
    queryFn: async () => {
      // Get all queue items with raw_payload
      const { data: queue, error } = await supabase
        .from("payment_reconcile_queue")
        .select("raw_payload");

      if (error) throw error;

      // Get existing mappings
      const { data: existingMappings } = await supabase
        .from("bepaid_product_mappings" as any)
        .select("bepaid_plan_title");

      const mappedTitles = new Set((existingMappings || []).map((m: any) => m.bepaid_plan_title));

      // Extract unique plan titles from queue
      const titleCounts = new Map<string, { count: number; description: string | null; amount: number | null }>();

      (queue || []).forEach(q => {
        const payload = q.raw_payload as Record<string, any> | null;
        if (!payload) return;

        const plan = payload.plan || {};
        const additionalData = payload.additional_data || {};
        const planTitle = plan.title || plan.name;

        if (planTitle && !mappedTitles.has(planTitle)) {
          const existing = titleCounts.get(planTitle);
          if (existing) {
            existing.count++;
          } else {
            titleCounts.set(planTitle, {
              count: 1,
              description: additionalData.description || null,
              amount: plan.amount ? plan.amount / 100 : null,
            });
          }
        }
      });

      const result: UnmappedProduct[] = Array.from(titleCounts.entries())
        .map(([title, data]) => ({
          bepaid_plan_title: title,
          count: data.count,
          sample_description: data.description,
          sample_amount: data.amount,
        }))
        .sort((a, b) => b.count - a.count);

      return result;
    },
  });

  // Create mapping mutation
  const createMappingMutation = useMutation({
    mutationFn: async (mapping: Omit<BepaidMapping, 'id' | 'created_at' | 'updated_at' | 'product_name' | 'tariff_name' | 'offer_name'>) => {
      const { data, error } = await supabase
        .from("bepaid_product_mappings" as any)
        .insert(mapping)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-unmapped-products"] });
      toast.success("Маппинг создан");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Update mapping mutation
  const updateMappingMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<BepaidMapping>) => {
      const { data, error } = await supabase
        .from("bepaid_product_mappings" as any)
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-mappings"] });
      toast.success("Маппинг обновлён");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  // Delete mapping mutation
  const deleteMappingMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bepaid_product_mappings" as any)
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-unmapped-products"] });
      toast.success("Маппинг удалён");
    },
    onError: (error: Error) => {
      toast.error(`Ошибка: ${error.message}`);
    },
  });

  return {
    mappings: mappings || [],
    mappingsLoading,
    unmappedProducts: unmappedProducts || [],
    unmappedLoading,
    refetchMappings,
    refetchUnmapped,
    createMapping: createMappingMutation.mutate,
    updateMapping: updateMappingMutation.mutate,
    deleteMapping: deleteMappingMutation.mutate,
    isCreating: createMappingMutation.isPending,
    isUpdating: updateMappingMutation.isPending,
    isDeleting: deleteMappingMutation.isPending,
  };
}

// Hook to process queue items and create orders
export function useBepaidQueueActions() {
  const queryClient = useQueryClient();

  // Create order from queue item
  const createOrderFromQueueMutation = useMutation({
    mutationFn: async ({ queueItemId, profileId, productId, tariffId, offerId }: {
      queueItemId: string;
      profileId: string;
      productId?: string;
      tariffId?: string;
      offerId?: string;
    }) => {
      // Get queue item
      const { data: queueItem, error: queueError } = await supabase
        .from("payment_reconcile_queue")
        .select("*")
        .eq("id", queueItemId)
        .single();

      if (queueError) throw queueError;

      const payload = queueItem.raw_payload as Record<string, any>;
      const plan = payload?.plan || {};
      const additionalData = payload?.additional_data || {};
      const card = payload?.card || {};
      const customer = payload?.customer || {};
      
      // Get amount - fallback to offer price if queue amount is 0
      let amount = queueItem.amount || (plan.amount ? plan.amount / 100 : 0);
      
      // If amount is 0 and we have an offer, get price from offer
      if (amount === 0 && offerId) {
        const { data: offer } = await supabase
          .from("tariff_offers")
          .select("amount")
          .eq("id", offerId)
          .maybeSingle();
        if (offer?.amount) amount = Number(offer.amount);
      }

      // Get profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name")
        .eq("id", profileId)
        .single();

      if (profileError) throw profileError;

      // Get product info if provided
      let productName = plan.title || plan.name || "Продукт bePaid";
      let productCode = "bepaid-import";
      
      if (productId) {
        const { data: product } = await supabase
          .from("products_v2")
          .select("name, code")
          .eq("id", productId)
          .single();
        if (product) {
          productName = product.name;
          productCode = product.code;
        }
      }

      // Generate order number
      const orderNumber = `BP-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      
      // Determine correct payment date (use paid_at from queue, not created_at)
      const actualPaymentDate = queueItem.paid_at || queueItem.created_at;

      // Build customer data from queue item and payload
      const customerName = queueItem.customer_name || customer.first_name || "";
      const customerSurname = queueItem.customer_surname || customer.last_name || "";
      const customerFullName = [customerName, customerSurname].filter(Boolean).join(" ") || 
                               queueItem.card_holder || card.holder || "";

      // Create order with customer data in meta
      const { data: order, error: orderError } = await supabase
        .from("orders_v2")
        .insert([{
          order_number: orderNumber,
          user_id: profile.user_id || profile.id,
          product_id: productId || null,
          tariff_id: tariffId || null,
          status: "paid",
          final_price: amount,
          base_price: amount,
          currency: queueItem.currency || "BYN",
          customer_email: queueItem.customer_email || customer.email || profile.email,
          reconcile_source: "bepaid_import",
          purchase_snapshot: {
            product_name: productName,
            product_code: productCode,
            imported_from: "bepaid_queue",
            bepaid_plan_title: plan.title || null,
            bepaid_uid: queueItem.bepaid_uid,
            offer_id: offerId,
          },
          meta: {
            // Customer data from bePaid
            customer_name: customerName || null,
            customer_surname: customerSurname || null,
            customer_full_name: customerFullName || null,
            customer_email: queueItem.customer_email || customer.email || null,
            customer_phone: queueItem.customer_phone || customer.phone || null,
            // Card data
            card_holder: queueItem.card_holder || card.holder || null,
            card_last4: queueItem.card_last4 || card.last_4 || null,
            card_brand: queueItem.card_brand || card.brand || null,
            // Payment data
            ip_address: queueItem.ip_address || payload?.ip || null,
            receipt_url: queueItem.receipt_url || null,
            // Dates
            purchased_at: actualPaymentDate,
            imported_at: new Date().toISOString(),
            // Offer
            offer_id: offerId || null,
          },
        }])
        .select()
        .single();

      if (orderError) throw orderError;

      // Check if payment already exists (prevent duplicates)
      const { data: existingPayment } = await supabase
        .from("payments_v2")
        .select("id")
        .eq("provider_payment_id", queueItem.bepaid_uid)
        .maybeSingle();

      if (!existingPayment) {
        // Create payment only if it doesn't exist
        // Use paid_at from queue item (actual payment date), not created_at
        // Extract product name from description
        const description = additionalData.description || plan.title || "";
        
        const { error: paymentError } = await supabase
          .from("payments_v2")
          .insert([{
            order_id: order.id,
            user_id: profile.user_id || profile.id,
            amount: amount,
            currency: queueItem.currency || "BYN",
            status: "succeeded",
            provider: "bepaid",
            provider_payment_id: queueItem.bepaid_uid,
            card_last4: queueItem.card_last4 || card.last_4 || null,
            card_brand: queueItem.card_brand || card.brand || null,
            paid_at: actualPaymentDate,
            receipt_url: queueItem.receipt_url || null,
            product_name_raw: description,
            provider_response: payload,
          }]);

        if (paymentError) throw paymentError;
      }

      // Update queue item status first
      await supabase
        .from("payment_reconcile_queue")
        .update({ 
          status: "completed", 
          last_error: null,
          matched_profile_id: profileId,
        })
        .eq("id", queueItemId);

      // Call backend function to grant access reliably
      let accessWarning: string | null = null;
      try {
        const { data: accessResult, error: accessError } = await supabase.functions.invoke(
          "grant-access-for-order",
          { body: { orderId: order.id } }
        );

        if (accessError) {
          console.error("Error granting access:", accessError);
          accessWarning = "Доступы не выданы: " + accessError.message;
        } else if (accessResult?.warning === "no_user_id") {
          accessWarning = accessResult.message;
        }
      } catch (e) {
        console.error("Failed to call grant-access-for-order:", e);
        accessWarning = "Не удалось вызвать функцию выдачи доступов";
      }

      return { ...order, accessWarning };
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["bepaid-queue"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-payments"] });
      queryClient.invalidateQueries({ queryKey: ["bepaid-stats"] });
      if (result?.accessWarning) {
        toast.warning(`Сделка создана. ${result.accessWarning}`);
      } else {
        toast.success("Сделка создана, доступы выданы");
      }
    },
    onError: (error: Error) => {
      toast.error(`Ошибка создания сделки: ${error.message}`);
    },
  });

  // Bulk process queue items
  const bulkProcessMutation = useMutation({
    mutationFn: async (items: Array<{ queueItemId: string; profileId: string; productId?: string; tariffId?: string; offerId?: string }>) => {
      const results = [];
      for (const item of items) {
        try {
          const result = await createOrderFromQueueMutation.mutateAsync(item);
          results.push({ success: true, orderId: result.id });
        } catch (error) {
          results.push({ success: false, error: String(error) });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length;
      toast.success(`Обработано: ${successCount} из ${results.length}`);
    },
  });

  return {
    createOrderFromQueue: createOrderFromQueueMutation.mutate,
    createOrderFromQueueAsync: createOrderFromQueueMutation.mutateAsync,
    bulkProcess: bulkProcessMutation.mutate,
    isCreatingOrder: createOrderFromQueueMutation.isPending,
    isBulkProcessing: bulkProcessMutation.isPending,
  };
}
