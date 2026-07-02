## да, согласен, с учетом правок:

1. **Сначала сделать dependency check по** `invoice-checkout-issue`**.**  
Проверить, кто ещё вызывает Edge Function и с каким payload. Если есть старые вызовы с `requisites_id`, нельзя просто сломать контракт.
2. **Добавить временную backward compatibility.**  
На переходный период EF должна принимать:
  &nbsp;
  ```text
  legal_details_id — новый основной путь
  requisites_id — legacy fallback, только если старый UI ещё где-то вызывает
  ```
  Но новый `InvoiceCheckoutDialog` должен отправлять только `legal_details_id`.
3. **Проверить точный API** `OrganizationDetailsForm`**.**  
Перед внедрением убедиться, что форма действительно может использоваться без `PayerTypeSelector` и не завязана на страницу настроек. Если внутри есть page-specific логика — вынести минимальный reusable режим, а не копировать форму.
4. **Не полагаться на** `org_form` **как единственный источник типа.**  
Для сохранения через `createDetails(data)` нужно явно выставлять/сохранять:
  &nbsp;
  ```text
  client_type = legal_entity | entrepreneur
  ```
  Если форма определяет ИП по `org_form`, это должно быть синхронизировано с `client_type`, иначе фильтр списка может не увидеть новую запись.
5. **Снапшот реквизитов в** `orders_v2.meta` **должен быть whitelisted.**  
Писать не “все поля подряд”, а только безопасный документный набор:
  &nbsp;
  ```text
  legal_details_id
  client_type
  leg_*
  ent_*
  address fields
  unp
  display_name
  snapshot_created_at
  ```
  Не тащить служебные поля, audit, profile_id сверх необходимости.
6. **В EF обязательно проверить ownership.**  
Условие должно быть жёстким:
  &nbsp;
  ```text
  client_legal_details.id = legal_details_id
  client_legal_details.profile_id = user.id
  client_type in ('legal_entity','entrepreneur')
  ```
  Иначе возможна выписка счёта на чужие реквизиты.
7. **Проверить документы/генератор.**  
До merge подтвердить, что `canonical-document-generate-strict` уже умеет брать snapshot из `orders_v2.meta` в формате `client_legal_details`. Если генератор ждёт старую структуру `legal_entities_requisites`, нужен compatibility mapping в EF.
8. **Список плательщиков в диалоге должен совпадать с настройками.**  
Но физлица исключить только в invoice-flow. В `settings/legal-details` физлица не удалять и не менять.
9. **Добавить пустое состояние.**  
Если нет ЮЛ/ИП реквизитов:
  &nbsp;
  ```text
  У вас пока нет реквизитов для выставления счёта. Добавьте организацию или ИП.
  ```
  И сразу показывать кнопку/форму добавления.
10. **Добавить обработку ошибок GRP lookup.**  
Если УНП не найден или сервис недоступен, пользователь должен иметь возможность заполнить реквизиты вручную.
11. **DoD дополнить regression по старым реквизитам.**  
Проверить:

- существующая запись из `settings/legal-details` видна в invoice dialog;
- новая запись из invoice dialog появляется в settings;
- default-реквизиты выбираются автоматически;
- ИП и ЮЛ оба работают.

12. **DoD дополнить backend proof.**  
В отчёте нужны:

- payload с `legal_details_id`;
- успешный ответ EF;
- созданный `orders_v2.id/public_id`;
- `orders_v2.meta.legal_details_id`;
- подтверждение PDF/email/Telegram;
- проверка отказа при чужом `legal_details_id`.

13. **Не трогать** `requisites-v2` **сейчас.**  
Согласен: старые компоненты оставить для админских/legacy сценариев. После успешного перехода можно отдельным follow-up решить, удалять ли legacy.
14. **Обязательное требование для Lovable.dev:**

```text
План должен быть составлен на русском языке.
Отчет о выполненной работе должен быть составлен на русском языке.
Вся переписка, все пояснения и все результаты должны предоставляться только на русском языке.

План: переиспользовать существующую форму реквизитов в InvoiceCheckoutDialog
```

### Проблема

В диалоге "Счёт на оплату" сейчас используется `LegalEntityRequisitesForm` из `requisites-v2` — она рендерит поля с уродскими подписями «[Пользовательские] [ЮЛ] …» (тянутся из `fields_registry` для системной сущности) и не имеет автозаполнения по УНП.
На странице `Настройки → Реквизиты для документов` живёт красивая, годами вылизанная форма `OrganizationDetailsForm` с `PayerTypeSelector`, автоподхватом организации по УНП через `useGrpLookup`, структурированным адресом и валидациями. Её и нужно переиспользовать один-в-один.

### Что делаем

1. `**src/components/payment/InvoiceCheckoutDialog.tsx**` — переписать источник данных:
  - Убрать импорты `useRequisitesV2`, `LegalEntityRequisitesForm`.
  - Использовать `useLegalDetails()` (тот же хук, что и `settings/LegalDetails.tsx`).
  - Список плательщиков — из `legalDetails`, отфильтрованных по `client_type in ('legal_entity','entrepreneur')` (физлицо исключаем: счёт только для ЮЛ/ИП).
  - Автовыбор: `is_default` → первый.
  - Кнопка «Добавить реквизиты» показывает `OrganizationDetailsForm` (тот же, что в настройках), без `PayerTypeSelector` — форма сама переключается между ЮЛ и ИП по `org_form` (`Индивидуальный предприниматель` → ИП). Заголовок над формой: «Добавить организацию или ИП».
  - `onSubmit` формы → `createDetails(data)` из `useLegalDetails`; после успеха — автоселект новой записи и возврат к списку.
  - В сводке шага «Подтверждение» и в лейблах карточек использовать `getDisplayName` по аналогии со страницей настроек (`leg_org_form «leg_name»` / `ent_name`).
2. `**supabase/functions/invoice-checkout-issue/index.ts**` — переключить источник реквизитов:
  - В теле запроса вместо `requisites_id` принимать `legal_details_id`.
  - Читать `client_legal_details` (а не `legal_entities_requisites`), проверять `profile_id === user.id` и `client_type in ('legal_entity','entrepreneur')`.
  - В `orders_v2.meta` писать `legal_details_id` + snapshot всех `leg_*`/`ent_*` полей записи (то, что уже используется остальной документной инфраструктурой).
  - Всё остальное (CRM-роутинг, invoice_number, вызов `canonical-document-generate-strict` с `pre_payment_invoice: true`, email/Telegram) — без изменений.
3. **Клиент → EF** — обновить payload в диалоге: `legal_details_id: selected.id`.

### Что НЕ делаем

- Ничего нового в БД, никаких новых таблиц/полей.
- `LegalEntityRequisitesForm` и `useRequisitesV2` не трогаем — они продолжают жить для админских сценариев.
- `PayerTypeSelector` не показываем в диалоге — счёт возможен только для ЮЛ/ИП, физлицо отсутствует по определению.
- Логику `PaymentDialog` (блокировка карты/ЕРИП/Apple/Google Pay для invoice-only офферов) и детектор `isInvoiceOnlyOffer` не трогаем.

### DoD

- Кнопка «Оплата по счёту» на `/ideologicheskaya-rabota` открывает диалог, визуально идентичный форме из `settings/legal-details` (та же типографика, тот же `StructuredAddressBlock`, тот же UNP-автозаполнитель).
- В форме нет ни одного лейбла вида «[Пользовательские] [ЮЛ] …».
- Ввод УНП `193405000` автоматически подтягивает название, форму и адрес организации через `useGrpLookup`.
- ИП создаётся выбором «Индивидуальный предприниматель» в org_form (поля директора скрываются).
- Сохранённые реквизиты появляются в `settings/legal-details` и наоборот — список в диалоге совпадает с настройками.
- Выписка счёта продолжает работать: PDF генерируется, `orders_v2` создаётся, письмо и Telegram уходят.