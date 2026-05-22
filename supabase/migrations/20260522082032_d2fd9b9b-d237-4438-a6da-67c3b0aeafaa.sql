
-- Отключаем 2 правила, связывающие «Платная консультация» с Gorbova Club
-- Dry-run подтвердил: 0 entitlements, 0 grants, 0 paid-заказов на этом тарифе.
UPDATE public.access_rules
SET is_active = false,
    notes = COALESCE(notes, '') ||
            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END ||
            '[2026-05-22] Disabled: продукт «Платная консультация» не должен участвовать в клубных доступах (Telegram, auto-revoke/kick, grace, reminders). Dry-run: 0 entitlements/0 grants/0 paid orders на момент отключения.',
    updated_at = now()
WHERE id IN (
  'e99097e0-e000-470f-b758-0b288d0dcf27',
  'bba87359-af85-42a4-b7c5-e46b3c98a395'
)
AND is_active = true;
