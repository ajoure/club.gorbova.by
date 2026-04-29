/**
 * Единый predicate для классификации записей доступа.
 * 
 * Источник истины: access_rules (действующие правила доступа системы).
 * Subscription/entitlement — технические записи, но не самостоятельное основание.
 * 
 * Запись считается «текущим валидным доступом» только если:
 * 1. Статус подписки active или trial
 * 2. Срок не истёк (access_end_at в будущем или null)
 * 3. Существует активное правило доступа (access_rules.is_active = true) для product_id
 * 4. Продукт и тариф не деактивированы (дополнительный guard)
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Набор product_id, для которых есть хотя бы одно активное правило доступа */
export function useActiveAccessRuleProducts() {
  return useQuery({
    queryKey: ["active-access-rule-product-ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_rules")
        .select("product_id")
        .eq("is_active", true)
        .not("product_id", "is", null);
      if (error) throw error;
      const set = new Set<string>();
      (data || []).forEach((r) => {
        if (r.product_id) set.add(r.product_id);
      });
      return set;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export interface SubscriptionLike {
  status: string | null;
  access_end_at: string | null;
  product_id?: string | null;
  products_v2?: { id?: string; is_active?: boolean } | null;
  tariffs?: { id?: string; is_active?: boolean } | null;
}

/**
 * Текущий валидный доступ — запись, подтверждённая действующим правилом доступа системы.
 */
export function isCurrentValidAccess(
  sub: SubscriptionLike,
  productsWithRules: Set<string>
): boolean {
  // 1. Статус
  if (sub.status !== "active" && sub.status !== "trial") return false;

  // 2. Срок
  if (sub.access_end_at && new Date(sub.access_end_at) < new Date()) return false;

  // 3. Действующее правило доступа для продукта
  const productId = sub.product_id || (sub.products_v2 as any)?.id;
  if (!productId || !productsWithRules.has(productId)) return false;

  // 4. Дополнительные guard: продукт/тариф не деактивированы
  const product = sub.products_v2 as any;
  const tariff = sub.tariffs as any;
  if (product?.is_active === false) return false;
  if (tariff?.is_active === false) return false;

  return true;
}

/**
 * Историческая запись — всё, что не прошло проверку текущего доступа.
 */
export function isHistoricalAccess(
  sub: SubscriptionLike,
  productsWithRules: Set<string>
): boolean {
  return !isCurrentValidAccess(sub, productsWithRules);
}

export type ExtendBlockReason =
  | "нет_user_id"
  | "нет_product_id"
  | "продукт_деактивирован"
  | "тариф_деактивирован"
  | "не_оплачено"
  | "нет_текущего_подтверждённого_доступа"
  | "историческая_покупка_без_текущего_основания"
  | "нет_правила_доступа_в_системе"
  | "новый_срок_короче_текущего"
  | "неполные_данные_для_проверки"
  | "subscription_expired"
  | "subscription_canceled"
  | "admin_override_historical_allowed"
  | "order_subscription_product_mismatch";

export interface ExtendCheckResult {
  action: "применить" | "пропустить" | "заблокировано";
  reason: string;
  reasonCode?: ExtendBlockReason;
}

/**
 * Диагностика конкретной причины непрохождения predicate.
 * Возвращает точный reasonCode вместо generic текста.
 */
export function diagnoseAccessFailure(
  sub: SubscriptionLike | null,
  productsWithRules: Set<string>
): { reasonCode: ExtendBlockReason; reason: string } {
  if (!sub) {
    return { reasonCode: "нет_текущего_подтверждённого_доступа", reason: "Нет подписки для этого продукта" };
  }

  // Check status first
  if (sub.status === "canceled" || sub.status === "cancelled") {
    return { reasonCode: "subscription_canceled", reason: "Подписка отменена" };
  }
  if (sub.status !== "active" && sub.status !== "trial") {
    return { reasonCode: "subscription_expired", reason: `Подписка истекла (статус: ${sub.status})` };
  }

  // Check expiry
  if (sub.access_end_at && new Date(sub.access_end_at) < new Date()) {
    return { reasonCode: "subscription_expired", reason: `Срок доступа истёк (${sub.access_end_at})` };
  }

  // Check product rule
  const productId = sub.product_id || (sub.products_v2 as any)?.id;
  if (!productId || !productsWithRules.has(productId)) {
    return { reasonCode: "нет_правила_доступа_в_системе", reason: "Нет активного правила доступа для этого продукта" };
  }

  // Check product/tariff deactivation
  const product = sub.products_v2 as any;
  const tariff = sub.tariffs as any;
  if (product?.is_active === false) {
    return { reasonCode: "продукт_деактивирован", reason: "Продукт деактивирован" };
  }
  if (tariff?.is_active === false) {
    return { reasonCode: "тариф_деактивирован", reason: "Тариф деактивирован" };
  }

  // Incomplete data
  if (!sub.products_v2 && !sub.product_id) {
    return { reasonCode: "неполные_данные_для_проверки", reason: "Неполные данные подписки (нет продукта)" };
  }

  return { reasonCode: "историческая_покупка_без_текущего_основания", reason: "Техническая запись без текущего основания" };
}

export interface CheckExtendOptions {
  isAdminOverride?: boolean;
}

/**
 * Проверка сделки для массового продления.
 * С поддержкой admin override для исторических/expired кейсов.
 */
export function checkExtendEligibility(
  order: {
    user_id: string | null;
    product_id: string | null;
    status: string | null;
    products_v2?: { is_active?: boolean } | null;
  },
  activeSub: SubscriptionLike | null,
  productsWithRules: Set<string>,
  newEnd: Date | null,
  options?: CheckExtendOptions,
): ExtendCheckResult {
  const isAdmin = options?.isAdminOverride ?? false;

  if (!order.user_id) {
    return { action: "заблокировано", reason: "Нет user_id у сделки", reasonCode: "нет_user_id" };
  }
  if (!order.product_id) {
    return { action: "заблокировано", reason: "Нет product_id у сделки", reasonCode: "нет_product_id" };
  }
  
  const product = order.products_v2 as any;
  if (product && product.is_active === false) {
    return { action: "заблокировано", reason: "Продукт деактивирован — доступ не выдаётся", reasonCode: "продукт_деактивирован" };
  }
  
  if (!productsWithRules.has(order.product_id)) {
    return { action: "заблокировано", reason: "Нет активного правила доступа в системе для этого продукта", reasonCode: "нет_правила_доступа_в_системе" };
  }

  if (order.status !== "paid") {
    return { action: "пропустить", reason: `Сделка не оплачена (${order.status})`, reasonCode: "не_оплачено" };
  }

  // Admin override: if admin and order is paid and product has active rule,
  // allow even without active subscription
  if (isAdmin) {
    if (!activeSub) {
      return {
        action: "применить",
        reason: "⚠️ Админ-доступ: нет текущей подписки — будет создана новая через grant-access-for-order",
        reasonCode: "admin_override_historical_allowed",
      };
    }

    if (!isCurrentValidAccess(activeSub, productsWithRules)) {
      const diagnosis = diagnoseAccessFailure(activeSub, productsWithRules);
      return {
        action: "применить",
        reason: `⚠️ Админ-доступ: ${diagnosis.reason}`,
        reasonCode: "admin_override_historical_allowed",
      };
    }
  }

  // Standard flow (non-admin or admin with valid sub)
  if (!activeSub) {
    return { action: "заблокировано", reason: "Нет текущего подтверждённого доступа — продление невозможно", reasonCode: "нет_текущего_подтверждённого_доступа" };
  }

  // Guard: неполные данные
  if (!activeSub.products_v2 && !activeSub.product_id) {
    return { action: "заблокировано", reason: "Неполные данные подписки для проверки (нет продукта)", reasonCode: "неполные_данные_для_проверки" };
  }

  if (!isCurrentValidAccess(activeSub, productsWithRules)) {
    const diagnosis = diagnoseAccessFailure(activeSub, productsWithRules);
    return { action: "заблокировано", reason: diagnosis.reason, reasonCode: diagnosis.reasonCode };
  }

  // Админ имеет право уменьшать срок (исправление неверной даты, корректировки).
  // Для не-админа сокращение блокируется как защита от случайного уменьшения.
  if (!isAdmin && newEnd && activeSub.access_end_at && newEnd < new Date(activeSub.access_end_at)) {
    return { action: "заблокировано", reason: "Новый срок короче текущего — сокращение заблокировано", reasonCode: "новый_срок_короче_текущего" };
  }

  return { action: "применить", reason: "" };
}
