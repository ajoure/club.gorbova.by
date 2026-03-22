## Now let me check the public checkout route situation:

# План: UI PROOF + PATCH-PUBLIC-CHECKOUT-E2E

## Часть 1: UI proof вкладки «Платежи» на реальном платеже

Через browser tools (пользователь уже залогинен):

1. Открыть `/payments`

2. Убедиться что реальный платёж (7ca540ff, 1 BYN, visa *0000) виден в таблице

3. Кликнуть на строку — открыть detail dialog — скрин

4. Проверить поиск по UID/amount

5. Проверить фильтр по статусу "Успешные"

6. Проверить row actions (копировать UID, открыть в bePaid, чек)

7. Дать proof-скрины

## Часть 2: PATCH-PUBLIC-CHECKOUT-E2E

### Что создаём

Два новых публичных route без AuthGuard:

#### 1. `/pay/:token` — PublicPayPage

- Берёт `token` из URL params

- Загружает `payment_link` по `url_token` (через edge function или напрямую — нужна публичная endpoint)

- Показывает: название, сумма, кнопка «Оплатить»

- По клику вызывает `create-bepaid-checkout` (без JWT — нужна публичная версия или proxy)

- Получает `redirect_url` → `window.location.href = redirect_url`

**Проблема:** `create-bepaid-checkout` требует JWT (admin). Для публичного flow нужен отдельный edge function `public-checkout` который:

- Не требует JWT

- Принимает `url_token` (не payment_link_id)

- Валидирует payment_link (active, not expired, under max_uses)

- Создаёт order и checkout так же как admin-версия

- Инкрементирует `current_uses`

#### 2. `/payment/result` — PaymentResultPage

- Query params: `status`, `order_id`

- Показывает результат: "Оплата успешна" / "Оплата отклонена" / "Ошибка"

- Иконка + текст + кнопка "Закрыть" или "Повторить"

- Без AuthGuard, публичная страница

### Файлы

| Файл | Действие |

|---|---|

| `supabase/functions/public-checkout/index.ts` | **create** — публичный checkout по url_token |

| `src/pages/PublicPayPage.tsx` | **create** — /pay/:token |

| `src/pages/PaymentResultPage.tsx` | **create** — /payment/result |

| `src/App.tsx` | **update** — добавить 2 публичных route |

### Edge function `public-checkout`

```

POST /public-checkout

Body: { url_token: string }

Response: { redirect_url, order_id }

```

- verify_jwt = false

- Ищет payment_link по url_token

- Проверяет: status=active, не expired, current_uses < max_uses (если max_uses задан)

- Ищет default bepaid integration для tenant

- Далее — тот же checkout flow что в create-bepaid-checkout

- Инкрементирует current_uses после успеха

- Не требует аутентификации

### Redirect URLs

Уже исправлен fallback `APP_BASE_URL → APP_ORIGIN`. Callback URLs формируются как:

- `{APP_ORIGIN}/payment/result?status=success&order_id={id}`

- `{APP_ORIGIN}/payment/result?status=declined&order_id={id}`

- `{APP_ORIGIN}/payment/result?status=failed&order_id={id}`

### Hard no-touch

- Не трогать bePaid webhook ядро

- Не трогать admin checkout flow

- Не трогать AutoRenewals

- Не трогать donor parity / ZIP / widget

### DoD

1. `/pay/:token` показывает payment_link данные и запускает checkout

2. `/payment/result` показывает результат оплаты

3. `public-checkout` edge function работает без JWT

4. E2E proof: payment_link → /pay/:token → bePaid → webhook → payments

5. Существующий admin checkout flow не сломан

&nbsp;

PATCH 6 FIX — три конкретных бага + копирование ID полей

### Что исправляем

**1. Schema bug в PersonLinkedEntitiesBlock**
Таблица `legal_details_roles_catalog` содержит поле `label`, а не `name`. В select-запросе на строке 39 написано `name` — это вернёт null или ошибку.

- Файл: `src/components/ai-requisites/PersonLinkedEntitiesBlock.tsx`
- Строка 39: `name` → `label`
- Строка 56: `roleCatalog?.name` → `roleCatalog?.label`

**2. Stale state в PersonFieldsForm**
Форма использует `useState(initialData?.field)` без синхронизации при смене `initialData`. При переключении view→edit или между разными персонами форма покажет старые значения.

- Файл: `src/components/ai-requisites/PersonRecordSheet.tsx`
- Добавить `key={person?.id ?? 'create'}` на `PersonFieldsForm` в `renderFormContent()` (строка 253). Это принудительно ремонтирует форму при смене персоны или режима.

**3. Нет копирования ID полей в карточке физлица**
В `PersonFieldsForm` не передаётся `fieldIds` в `StructuredAddressBlock`. Для физлиц нет зарегистрированных полей в `fields_registry` с префиксом `person_address_*`, поэтому `fieldIds` для address block сейчас недоступен.

Однако в карточке просмотра (view mode) в `PersonRecordSheet` у `InfoRow` уже есть `copyable` на ключевых полях (личный номер, паспорт, ID, телефон, email). Это покрывает копирование значений.

Для полного копирования ID полей адреса физлица нужна регистрация полей `person_address_*` в `fields_registry` — это выходит за рамки текущего фикса и требует миграции. Сейчас копирование значений уже работает через `copyable` prop.

### Файлы к изменению


| Файл                            | Что меняем                                             |
| ------------------------------- | ------------------------------------------------------ |
| `PersonLinkedEntitiesBlock.tsx` | `name` → `label` в select и mapping                    |
| `PersonRecordSheet.tsx`         | `key` на PersonFieldsForm для ремонта при смене данных |


### Что НЕ трогаем

- StructuredAddressBlock
- EntityRecordSheet
- formatStructuredAddress
- AI.tsx
- settings flow