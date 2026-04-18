-- Fix: payment_links_enriched_v падал по statement timeout (57014).
-- Корень: три коррелированных subquery в orders_v2 по meta->>'payment_link_id'
-- без индекса -> seq-scan по 2876 строкам на каждую ссылку.
-- Add-only: создаём частичный B-tree индекс по выражению JSONB.
-- View, RLS, GRANTы НЕ трогаем.

CREATE INDEX IF NOT EXISTS idx_orders_v2_payment_link_id
  ON public.orders_v2 ((meta->>'payment_link_id'))
  WHERE meta ? 'payment_link_id';