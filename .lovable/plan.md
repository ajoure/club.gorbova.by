План: Исправление системы «1 Payment = 1 Order» (фиксированный, без перепланирования)

Ключевые корректировки (обязательные, согласованы)

Корректировка	Текущее состояние	Требуемое изменение
DoD-1 закрытие	orphan_succeeded остаётся >0, потому что для части succeeded платежей не создаётся order / не проставляется order_id	bepaid-webhook на successful ВСЕГДА вызывает ensureOrderForPayment() и гарантирует, что у payment будет order_id: либо на paid order, либо на needs_mapping order
Card-based recovery	card_profile_links даёт profile_id, а не user_id	Recovery делает JOIN: card_profile_links.profile_id → profiles.id → profiles.user_id
Card collision guards	Нет строгого guard	0 match → requires_manual_mapping; 2+ match → audit payment.card_link_collision, STOP (без auto-grant), order всё равно создаётся как needs_mapping и payment.linked
Grant rules	Блок по meta.source	Блок строго по условию: order.status='needs_mapping' AND mapping_applied_at IS NULL
UI workflow	needs_mapping могут “прятаться”	Прятать можно, но Badge “Требуют маппинга: N” всегда виден + вкладка “Проблемные”
Admin API	Нет dry-run	admin-map-order-product: dry-run → execute, SYSTEM ACTOR audit logs
Backfill/Reconcile	Делается кусочно	После фикса webhook — reconcile батчами для закрытия DoD-1 до 0


⸻

PATCH 1: ensure-order-for-payment — Card-based user recovery + collision guards + ALWAYS create order

Файл: supabase/functions/_shared/ensure-order-for-payment.ts

1.1. Изменение recoverProductTariffForOrphan (точечная правка)

async function recoverProductTariffForOrphan(
  supabase: SupabaseClient,
  userId: string | null,
  _amount: number,
  _currency: string,
  cardLast4: string | null,  // NEW
  cardBrand: string | null   // NEW
): Promise<{
  productId: string | null;
  tariffId: string | null;
  offerId: string | null;
  source: string | null;
  requiresMapping: boolean;
  mappingReason: string | null;
  recoveredUserId: string | null;  // NEW
  cardCollision: boolean;          // NEW
}> {
  let productId: string | null = null;
  let tariffId: string | null = null;
  let offerId: string | null = null;
  let source: string | null = null;

  let recoveredUserId = userId;
  let cardCollision = false;

  // ============= PRIORITY 0: Card-based user recovery (STRICT GUARDED) =============
  if (!recoveredUserId && cardLast4 && cardBrand) {
    const normalizedBrand = normalizeBrand(cardBrand);

    // JOIN: card_profile_links.profile_id → profiles.id → profiles.user_id
    const { data: cardLinks, error: cardErr } = await supabase
      .from('card_profile_links')
      .select('profile_id, profiles!inner(id, user_id)')
      .eq('card_last4', cardLast4)
      .eq('card_brand', normalizedBrand);

    if (!cardErr && Array.isArray(cardLinks)) {
      if (cardLinks.length === 1) {
        recoveredUserId = cardLinks[0].profiles?.user_id || null;
        source = 'card_profile_link';
      } else if (cardLinks.length >= 2) {
        // Collision: do NOT pick one
        cardCollision = true;
      }
      // 0 matches → keep recoveredUserId null
    }
  }

  // Priority 1: User latest subscription
  if (recoveredUserId) {
    const { data: userSub } = await supabase
      .from('subscriptions_v2')
      .select('product_id, tariff_id, offer_id')
      .eq('user_id', recoveredUserId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (userSub?.product_id) {
      productId = userSub.product_id;
      tariffId = userSub.tariff_id;
      offerId = userSub.offer_id;
      source = source || 'user_subscription';
    }
  }

  // Priority 2: User last paid order
  if (!productId && recoveredUserId) {
    const { data: lastOrder } = await supabase
      .from('orders_v2')
      .select('product_id, tariff_id, offer_id')
      .eq('user_id', recoveredUserId)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOrder?.product_id) {
      productId = lastOrder.product_id;
      tariffId = lastOrder.tariff_id;
      offerId = lastOrder.offer_id;
      source = source || 'last_paid_order';
    }
  }

  const requiresMapping = !productId || cardCollision;

  let mappingReason: string | null = null;
  if (cardCollision) mappingReason = 'card_collision';
  else if (!productId) mappingReason = recoveredUserId ? 'no_subscription_or_order_found' : 'no_user_id';

  return {
    productId,
    tariffId,
    offerId,
    source,
    requiresMapping,
    mappingReason,
    recoveredUserId,
    cardCollision,
  };
}

1.2. Изменение createOrderForOrphanPayment (ключевая гарантия DoD-1)

Требование: при любом payment.status='succeeded' + order_id IS NULL — создаём order всегда.
Если product неизвестен или collision — создаём orders_v2.status='needs_mapping', но всё равно привязываем payment к order.

Дополнительно: если cardCollision=true — обязательно audit log payment.card_link_collision.

// 1) Вызвать recover... с card данными
const recovery = await recoverProductTariffForOrphan(
  supabase,
  payment.user_id,
  payment.amount,
  payment.currency || 'BYN',
  payment.card_last4 ?? null,
  payment.card_brand ?? null
);

if (recovery.cardCollision) {
  await supabase.from('audit_logs').insert({
    action: 'payment.card_link_collision',
    actor_type: 'system',
    actor_user_id: null,
    actor_label: callerLabel,
    target_user_id: null,
    meta: {
      payment_id: payment.id,
      card_last4: payment.card_last4,
      card_brand: payment.card_brand,
      reason: 'multiple_profiles_for_card',
    },
  });
}

// 2) Определить статус order
const orderStatus =
  recovery.requiresMapping || !recovery.productId ? 'needs_mapping' : 'paid';

// 3) Создать order (product_id может быть NULL)
const { data: newOrder, error: createErr } = await supabase
  .from('orders_v2')
  .insert({
    order_number: orderNumber,
    user_id: recovery.recoveredUserId || payment.user_id,
    profile_id: profileId,
    status: orderStatus,
    currency: payment.currency || 'BYN',
    base_price: payment.amount,
    final_price: payment.amount,
    paid_amount: payment.amount,
    is_trial: false,
    product_id: recovery.productId, // может быть NULL при needs_mapping
    tariff_id: recovery.tariffId,
    offer_id: recovery.offerId,
    meta: {
      source: 'orphan_payment_fix',
      payment_id: payment.id,
      created_by: callerLabel,
      product_source: recovery.source,
      requires_manual_mapping: recovery.requiresMapping,
      mapping_reason: recovery.mappingReason,
      card_collision: recovery.cardCollision || false,
    },
  })
  .select('id, order_number, status')
  .single();

// 4) ALWAYS link payment to order (закрываем DoD-1)
await relinkPaymentToOrder(
  supabase,
  payment,
  newOrder.id,
  null,
  callerLabel,
  'orphan'
);


⸻

PATCH 2: bepaid-webhook — ensureOrderForPayment всегда, grant только если не needs_mapping

Файл: supabase/functions/bepaid-webhook/index.ts

Правило:
	•	На successful после update payment — всегда вызываем ensureOrderForPayment.
	•	Если итоговый order имеет status='needs_mapping' и mapping_applied_at отсутствует — не выдаём доступ, логируем audit, webhook не фейлим.

// After ensureOrderForPayment
if (ensureResult.orderId) {
  const { data: orderCheck } = await supabase
    .from('orders_v2')
    .select('status, meta, user_id')
    .eq('id', ensureResult.orderId)
    .single();

  const orderMeta = (orderCheck?.meta || {}) as Record<string, any>;
  const isNeedsMapping = orderCheck?.status === 'needs_mapping';
  const hasMappingApplied = !!orderMeta.mapping_applied_at;

  if (isNeedsMapping && !hasMappingApplied) {
    await supabase.from('audit_logs').insert({
      action: 'access.grant_skipped_needs_mapping',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'bepaid-webhook',
      target_user_id: orderCheck?.user_id,
      meta: {
        payment_id: paymentV2.id,
        order_id: ensureResult.orderId,
        bepaid_uid: transactionUid,
      },
    });

    // Continue webhook processing but SKIP grant/subscription side-effects.
    // Ensure: payment is linked to order already (DoD-1 satisfied).
    return new Response(JSON.stringify({ success: true, skipped: 'needs_mapping' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}


⸻

PATCH 3: grant-access-for-order — блок только по статусу needs_mapping

Файл: supabase/functions/grant-access-for-order/index.ts

const orderMeta = (order.meta || {}) as Record<string, any>;
const isNeedsMapping = order.status === 'needs_mapping';
const hasMappingApplied = !!orderMeta.mapping_applied_at;

if (isNeedsMapping && !hasMappingApplied) {
  await supabase.from('audit_logs').insert({
    action: 'access.grant_blocked_needs_mapping',
    actor_type: 'system',
    actor_user_id: null,
    actor_label: 'grant-access-for-order',
    target_user_id: order.user_id,
    meta: {
      order_id: orderId,
      order_status: order.status,
      reason: 'needs_mapping_without_applied_at',
    },
  });

  return new Response(
    JSON.stringify({
      success: false,
      error: 'needs_mapping_blocked',
      message: 'Order requires manual product mapping before access can be granted.',
      orderId,
    }),
    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// If mapping applied — allow regardless of meta.source


⸻

PATCH 4: grant-access-for-payment — единый блок по needs_mapping

Файл: supabase/functions/grant-access-for-payment/index.ts

if (resolvedOrderId) {
  const { data: orderCheck } = await supabase
    .from('orders_v2')
    .select('status, meta')
    .eq('id', resolvedOrderId)
    .single();

  const orderMeta = (orderCheck?.meta || {}) as Record<string, any>;
  const isNeedsMapping = orderCheck?.status === 'needs_mapping';
  const hasMappingApplied = !!orderMeta.mapping_applied_at;

  if (isNeedsMapping && !hasMappingApplied) {
    await supabase.from('audit_logs').insert({
      action: 'access.grant_blocked_needs_mapping',
      actor_type: 'system',
      actor_user_id: null,
      actor_label: 'grant-access-for-payment',
      meta: {
        payment_id: paymentId,
        order_id: resolvedOrderId,
        reason: 'needs_mapping_without_applied_at',
      },
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: 'needs_mapping_blocked',
        message: 'Order requires manual product mapping before access can be granted.',
        paymentId,
        orderId: resolvedOrderId,
      }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}


⸻

PATCH 5: admin-map-order-product — endpoint для ручного маппинга (dry-run → execute)

Новый файл: supabase/functions/admin-map-order-product/index.ts

Требования:
	•	admin only (RBAC)
	•	dry_run=true по умолчанию
	•	execute обновляет order: product_id/tariff_id/offer_id, status='paid', meta.mapping_applied_at, meta.mapping_applied_by
	•	SYSTEM ACTOR audit log: order.mapping_applied
	•	optional grant_access вызывает grant-access-for-order

(Код оставляем как в текущем плане — он соответствует требованиям. Единственное требование: не менять actor_type — строго system + actor_user_id=NULL.)

⸻

PATCH 6: UI — Badge + вкладка «Проблемные» + список needs_mapping

6.1 AdminPaymentsHub.tsx — новая вкладка

Файл: src/pages/admin/AdminPaymentsHub.tsx

{ id: "needs-mapping", label: "Проблемные", icon: AlertTriangle, path: "/admin/payments/needs-mapping" },

и рендер:

{activeTab === "needs-mapping" && <NeedsMappingTabContent />}

6.2 NeedsMappingTabContent.tsx — новый компонент

Новый файл: src/components/admin/payments/NeedsMappingTabContent.tsx

Функции:
	•	грузит orders_v2 со status='needs_mapping' (+ связанный payment)
	•	показывает: order_id, payment_id, card_last4, brand, amount, paid_at, mapping_reason
	•	CTA “Смаппить” → вызывает admin-map-order-product (сначала dry-run, потом execute)
	•	optional “Смаппить и выдать доступ”

6.3 AdminDeals.tsx — Badge “Требуют маппинга: N” всегда виден

Файл: src/pages/admin/AdminDeals.tsx
	•	needsMappingCount через useMemo
	•	Badge кликабельный → ведёт на /admin/payments/needs-mapping
	•	toggle show/hide в списке можно оставить

⸻

PATCH 7: admin-backfill-renewal-orders — reconcile после фикса webhook

Файл: supabase/functions/admin-backfill-renewal-orders/index.ts

Смысл: после PATCH 1–4 backfill может безопасно прогнать исторические succeeded AND order_id IS NULL и довести DoD-1 до 0, потому что ensure теперь всегда создаёт order (paid или needs_mapping) и всегда линкует payment.

Требования:
	•	dry_run → execute
	•	батчи + timebox + cursor
	•	audit_logs system actor на execute

⸻

Порядок применения (без перепланирования)

Шаг	Действие	Тип
1	PATCH 1: Card recovery + collision + ALWAYS create order + ALWAYS link payment	Edge
2	PATCH 2: bepaid-webhook — ensure всегда; grant только если not needs_mapping	Edge
3	PATCH 3–4: grant blocks by status needs_mapping	Edge
4	PATCH 5: admin-map-order-product (dry-run→execute)	Edge
5	Deploy edge functions	Deploy
6	PATCH 6: UI (Badge + вкладка + компонент)	Frontend
7	PATCH 7: backfill/reconcile исторических orphan	Execute
8	Verify DoD (SQL + UI)	Check


⸻

DoD — обязательные пруфы (SQL)

-- DoD-1: главный инвариант (должен быть 0)
SELECT count(*) FROM payments_v2
WHERE status='succeeded' AND amount>0 AND order_id IS NULL;

-- DoD-2: управляемый хвост needs_mapping (виден в UI и маппится)
SELECT count(*) FROM payments_v2 p
JOIN orders_v2 o ON o.id=p.order_id
WHERE p.status='succeeded' AND o.status::text='needs_mapping';

-- DoD-3: audit_logs proof (SYSTEM ACTOR)
SELECT action, count(*)
FROM audit_logs
WHERE action IN (
  'payment.order_ensured',
  'payment.ensure_order_failed',
  'payment.card_link_collision',
  'order.mapping_applied',
  'access.grant_blocked_needs_mapping',
  'access.grant_skipped_needs_mapping'
)
AND actor_type='system' AND actor_user_id IS NULL
GROUP BY action
ORDER BY count DESC;


⸻

UI DoD
	•	Badge “Требуют маппинга: N” всегда виден в AdminDeals и ведёт на “Проблемные”
	•	Вкладка “Проблемные” показывает needs_mapping orders
	•	“Смаппить” делает dry-run → execute
	•	После execute order становится paid, появляется mapping_applied_at
	•	Доступ выдаётся только после маппинга (через кнопку/флаг grant_access)

⸻

Изменяемые файлы

Файл	Тип изменения
supabase/functions/_shared/ensure-order-for-payment.ts	PATCH 1: Card recovery + collision + ALWAYS create order + ALWAYS link payment
supabase/functions/bepaid-webhook/index.ts	PATCH 2: ensure всегда, grant только если not needs_mapping
supabase/functions/grant-access-for-order/index.ts	PATCH 3: block by status needs_mapping
supabase/functions/grant-access-for-payment/index.ts	PATCH 4: block by status needs_mapping
supabase/functions/admin-map-order-product/index.ts	PATCH 5: NEW endpoint (dry-run→execute + system audit)
src/pages/admin/AdminPaymentsHub.tsx	PATCH 6: New tab
src/components/admin/payments/NeedsMappingTabContent.tsx	PATCH 6: NEW component
src/pages/admin/AdminDeals.tsx	PATCH 6: Badge always visible
supabase/functions/admin-backfill-renewal-orders/index.ts	PATCH 7: reconcile historical orphans using updated ensure


⸻
