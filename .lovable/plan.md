# bePaid Provider-Managed Subscriptions — PATCH-лист (ВЫПОЛНЕНО ✅)

## Статус: ВСЕ ПАТЧИ ПРИМЕНЕНЫ

Дата применения: 2026-02-04

---

## Выполненные исправления

### PATCH-1.0: Порядок проверки BasicAuth + RSA Signature ✅
- Реализована единая логика: сначала BasicAuth, затем RSA
- Убраны все fallback "принять без подписи"
- 401 + orphan при invalid_signature
- 500 + alert при missing_public_key/secret_key

### PATCH-1.1: normalizePemPublicKey() ✅
- Добавлена функция нормализации PEM (base64 по 64 символа)
- Используется integration_instances.config.public_key

### PATCH-1.2: Убран BEPAID_PUBLIC_KEY ✅
- Удалён захардкоженный ключ (строки 420-428)

### PATCH-1.3: verifyWebhookSignature без fallback ✅
- Сигнатура теперь строго требует publicKeyPem
- Убрано логирование фрагментов ключа

### PATCH-1.4/1.5: 500 misconfig при отсутствии credentials ✅
- Нет public_key + нет secret_key → 500 + alert + orphan
- Есть Content-Signature, но нет public_key → 500 + alert + orphan

### PATCH-1.6: Safe subset для provider_webhook_orphans ✅
- Заменено `raw_data: body` → `createSafeOrphanData(body, trackingId)`
- Применено в 4 местах

### PATCH-1.7: 401 unauthorized при invalid signature ✅
- Статус код 401 для неверной/отсутствующей подписи

### PATCH-1.8: Идемпотентность по transaction.uid ✅
- Уже была реализована, оставлена без изменений

### PATCH-2: Email collision 409 ✅
- Заменён `.maybeSingle()` на проверку массива
- При >1 профиле → 409 + остановка

### PATCH-3: PaymentDialog ✅
- Условие без `!savedCard` подтверждено

### PATCH-4: PaymentMethods UX ✅
- Пояснения MIT vs bePaid
- Tooltip "Изменить карту"

---

## Развёрнутые функции

- `bepaid-webhook` — deployed ✅
- `bepaid-create-subscription-checkout` — deployed ✅

---

## SQL-пруфы (актуальное состояние)

### integration_instances config
```
shop_id: 33524
public_key: present (392 chars)
secret_key: present
status: connected
```

### provider_webhook_orphans
- Старые orphans содержат полный body (до патча)
- Новые будут содержать только safe subset

### audit_logs
- Записи `bepaid-webhook-security` с action `webhook.rejected_invalid_signature`

---

## DoD: Что проверить после следующего webhook

1. **Подпись OK** → обработка продолжится
2. **Подпись FAIL** → 401 + orphan с safe subset
3. **Нет credentials** → 500 + alert + orphan

Ожидаемый результат при успешном webhook:
- `orders_v2.status = 'paid'`
- `subscriptions_v2.status = 'active', billing_type = 'provider_managed'`
- `provider_subscriptions.state = 'active'`
- `payments_v2` создан с `provider_payment_id = {transaction.uid}`
- `audit_logs` запись с `actor_label = 'bepaid-webhook'`
