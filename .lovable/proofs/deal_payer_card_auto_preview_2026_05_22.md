# Proof: показ дефолтной карточки реквизитов в режиме «По умолчанию»

Дата: 2026-05-22
Тип: UI-only patch (без SQL, миграций, edge-функций, изменения backend resolver, без изменения данных в карточках реквизитов).

## Проблема
В сделке (пример — Багинская, `#REBILL-14d419cb-e1e`) поле «Карточка реквизитов плательщика» в режиме `auto` показывало захардкоженную строку «По умолчанию (карточка пользователя)». Документ при этом генерируется корректно (бэкенд берёт `is_default DESC, updated_at DESC LIMIT 1` из `individual_requisites` / `legal_entities_requisites`), но админ в карточке сделки не видит, какая именно карточка будет использована.

## Backend-резолв (read-only проверка)
`supabase/functions/document-field-resolver-v2/index.ts`, строки 66–84:
```ts
.from('legal_entities_requisites')
.select('id, data, is_default, updated_at')
.eq('owner_user_id', ownerUserId)
.order('is_default', { ascending: false })
.order('updated_at', { ascending: false })
.limit(1);
// аналогично для individual_requisites
```
`canonical-document-generate-strict` ходит через `document-resolver-v2` и не использует `payer_entity_override` (override на бэке не материализован — это backlog, не покрывается этим патчем).

## Изменения
Один файл: `src/components/admin/DealPayerDocumentsCard.tsx`.

1. Вынесен общий helper `isEntrepreneurReq(r)` (был дублирован в JSX) и добавлен fallback в `reqLabel` — пустой/битый label превращается в `Карточка {id8}`, никогда не `undefined`/`null`.
2. Добавлен memo `defaultRequisiteCard`:
   - `individual` → `individuals.find(is_default) ?? individuals[0]`
   - `entrepreneur` → `legalEntities.filter(isEntrepreneurReq).find(is_default) ?? первый ИП`
   - `legal_entity` → `legalEntities.filter(!isEntrepreneurReq).find(is_default) ?? первый ЮЛ`
   Порядок массивов не меняем — `load()` уже сортирует `is_default DESC`.
3. `SelectItem value="auto"` теперь рендерит:
   - guest/public-link (`!order.user_id`) → «По умолчанию (карточка пользователя)»;
   - карточка найдена → `«По умолчанию · {reqLabel(card)}»`;
   - карточек нет → «По умолчанию (нет карточки — заполнит автоматически по профилю)».
   `<SelectValue/>` в свёрнутом виде автоматически подхватит этот текст.

Бейдж справа от заголовка (`По умолчанию` / `Изменено вручную`) не менялся.

## Verify
- Багинская (ФЛ, `owner_user_id` есть, заполнена индивидуальная карточка) → в свёрнутом селекте видно «По умолчанию · Багинская …».
- ИП/ЮЛ → видно `ent_short_name` / `leg_short_name` из дефолтной записи.
- Пользователь без карточек → подсказка «нет карточки — заполнит автоматически по профилю».
- Override → бейдж «Изменено вручную», в селекте выбранная карточка (без изменений).
- Смена `effectivePayerType` ФЛ ↔ ИП ↔ ЮЛ → текст пункта `auto` пересчитывается через `useMemo`, выбранный `edEntityKey` не сбрасывается, кнопка «Сохранить» работает по `dirty`.
- Гостевая сделка (`user_id = null`) → fallback-текст «карточка пользователя».

## Что НЕ менялось
- Backend: edge functions, SQL, миграции, RPC.
- Данные в `individual_requisites` / `legal_entities_requisites`.
- Override-флоу (`canonical-deal-document-overrides`), бейджи источника, кнопки «Сохранить» / «Сбросить».
- Другие компоненты, кроме `DealPayerDocumentsCard.tsx`.
