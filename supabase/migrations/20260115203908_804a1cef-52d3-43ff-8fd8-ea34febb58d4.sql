-- Разрешить NULL для order_id и user_id в payments_v2
-- Это нужно для refunds без найденного parent payment
-- Такие refunds будут иметь needs_manual_link=true в meta

ALTER TABLE payments_v2 ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE payments_v2 ALTER COLUMN user_id DROP NOT NULL;

-- Добавить комментарии для документации
COMMENT ON COLUMN payments_v2.order_id IS 'Order ID. NULL allowed for orphan refunds that need manual linking.';
COMMENT ON COLUMN payments_v2.user_id IS 'User ID. NULL allowed for orphan refunds that need manual linking.';