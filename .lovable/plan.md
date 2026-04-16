# да, согласен, с учетом правок:

&nbsp;

1. Глобальную замену Package → Layers оставить в этом же патче и выполнить сразу по всем перечисленным product-контекстам. Document package-контексты и прочие не-product смыслы не трогать.
2. Для useAdminMenuSettings.tsx отдельно проверить, что там действительно используется именно lucide icon mapping/JSX, а не строковый ключ с другой системой иконок. Если там не прямой импорт Package, заменить корректно по месту без костылей.
3. src/archive/pages/AdminProducts.tsx можно менять только если страница реально участвует в сборке или доступна из интерфейса. Если это мёртвый архивный файл и он не влияет на runtime/UI, достаточно отметить его отдельно в отчёте как “archived / non-runtime”. Основной proof нужен по живым экранам.
4. В StudentProgressModal props studentName?: string и productTitle?: string делать строго add-only, без ломки текущих вызовов. Старые места открытия модалки должны продолжить работать без доработки.
5. В шапке StudentProgressModal приоритет показа имени зафиксировать так:
  &nbsp;
  - studentName
  - profile.full_name
  - [profile.email](http://profile.email)
  - "Неизвестный ученик"
    Не возвращать больше "Без имени".
  &nbsp;
6. В ContactArtifactsTab пробрасывать contactName из ContactDetailSheet, а productTitle — не из “group.label по ситуации”, а из канонического product group header / artifact product context, чтобы не было рассинхрона между списком и модалкой.
7. Визуальное улучшение секций по продуктам поддерживаю, но без перегруза:
  &nbsp;
  - белая карточка,
  - цветной левый бордер,
  - мягкая тень,
  - цветная product icon,
  - аккуратные badges.
    Не делать слишком много ярких цветов и градиентов одновременно.
  &nbsp;
8. Training logic больше не трогать:
  &nbsp;
  - training item → только existing StudentProgressModal
  - site form item → только existing SiteFormDetailDialog
  - никаких новых training renderers / normalizers / resolver chains.
  &nbsp;
9. В финальном отчёте отдельно показать:
  &nbsp;
  - какой canonical icon выбран (Layers);
  - список реально изменённых runtime-файлов;
  - 2–3 живых UI-скрина из разных разделов, где старая product icon заменена;
  - StudentProgressModal с именем, продуктом, уроком, статусом;
  - карточку контакта со сгруппированной вкладкой и корректным открытием training/site form.
  &nbsp;

&nbsp;

План: визуальное обновление вкладки «Анкеты и обучение», StudentProgressModal и глобальная замена product icon

## 1. Глобальная замена product icon

**Canonical icon:** `Layers` (из lucide-react) — современная, нейтральная, хорошо масштабируется.
**Canonical color:** `text-indigo-500` (основной), `text-indigo-400` (muted варианты).

### Файлы для замены (Package → Layers, где используется как иконка продукта):


| #   | Файл                                                             | Контекст                 |
| --- | ---------------------------------------------------------------- | ------------------------ |
| 1   | `src/components/admin/contact/ContactArtifactsTab.tsx`           | Product group header     |
| 2   | `src/components/admin/ContactPaymentsTab.tsx`                    | Payment product icon     |
| 3   | `src/components/admin/payments/BulkCreateDealsDialog.tsx`        | Deal creation            |
| 4   | `src/components/admin/payments/LinkDealDialog.tsx`               | Deal linking             |
| 5   | `src/components/admin/payments/LinkSubscriptionDealDialog.tsx`   | Subscription deal        |
| 6   | `src/components/admin/AdminChargeDialog.tsx`                     | Charge dialog            |
| 7   | `src/components/admin/AdminPaymentLinkDialog.tsx`                | Payment link             |
| 8   | `src/components/admin/trainings/ProductTariffAccessSelector.tsx` | Tariff selector          |
| 9   | `src/components/admin/live/LiveEventProductCtaBindings.tsx`      | CTA bindings             |
| 10  | `src/components/telegram/TelegramClubsTab.tsx`                   | Club settings            |
| 11  | `src/components/purchases/PreregistrationListItem.tsx`           | Preregistration          |
| 12  | `src/components/admin/site-builder/blocks/FormBlockEditor.tsx`   | Form block               |
| 13  | `src/pages/admin/ProductClubMappings.tsx`                        | Club mappings            |
| 14  | `src/hooks/useAdminMenuSettings.tsx`                             | Sidebar menu icon string |
| 15  | `src/archive/pages/AdminProducts.tsx`                            | Archived page            |


**НЕ трогаем** (Package = «пакет документов», семантически корректно):

- `AiDocumentsGenerateView.tsx`
- `AiDocumentPackagesManager.tsx`
- `AiDocumentsHistoryView.tsx`
- `ContactInstallments.tsx` (пакет рассрочки — другой смысл)

## 2. StudentProgressModal — шапка с контекстом

**Add-only изменения** (не ломают существующие вызовы):

- Добавить optional props: `studentName?: string`, `productTitle?: string`
- В шапке показывать:
  - **Имя** = `studentName || profile?.full_name || profile?.email || "Неизвестный ученик"`
  - **Продукт** = badge с `productTitle` (если передан)
  - **Урок** = `lessonTitle` (если передан)
  - **Статус** = badge «Завершён» / «В процессе»
- Убрать generic «Без имени» — всегда показывать лучший доступный идентификатор
- Заменить `User` icon на аватар-placeholder с инициалами (цветной круг)
- Карточки блоков — добавить мягкий цветной левый бордер по типу блока

## 3. ContactArtifactsTab — визуальное улучшение

### Product group sections:

- Заменить `bg-muted/60` на белую карточку с `border-l-4 border-indigo-300 shadow-sm`
- Product icon `Layers` в `bg-indigo-50 text-indigo-500` кружке
- Badges количеств — мягкие цветные фоны (`bg-emerald-50 text-emerald-600`, `bg-blue-50 text-blue-600`)

### Artifact rows:

- Иконки типов в цветных кружках (`bg-blue-50`, `bg-emerald-50`, `bg-amber-50`)
- Hover — `hover:bg-accent/40` с мягким transition

### Передать contactName:

- `ContactDetailSheet.tsx` → передать `contactName={contact.full_name}` в `ContactArtifactsTab`
- `ContactArtifactsTab` → пробросить в `StudentProgressModal` как `studentName`
- Также пробросить `productTitle` из `group.label`

## 4. Scope guard

- **Training details** = только reuse `StudentProgressModal`, никаких новых renderers
- **Site forms** = отдельный `SiteFormDetailDialog`
- Никаких новых training renderers, normalizers, resolver chains

## Файлы для изменения


| Файл                       | Что меняется                                                  |
| -------------------------- | ------------------------------------------------------------- |
| ~15 файлов с Package       | Import `Layers` вместо `Package`, применить `text-indigo-500` |
| `StudentProgressModal.tsx` | +studentName/productTitle props, улучшенная шапка             |
| `ContactArtifactsTab.tsx`  | +contactName prop, визуал секций/строк, передача имени        |
| `ContactDetailSheet.tsx`   | Передать contactName в ContactArtifactsTab                    |


## DoD

1. `Package` как product icon заменён на `Layers` во всех 15 файлах
2. Document-package файлы НЕ затронуты
3. В `StudentProgressModal` показывается имя, продукт, урок, статус — нет «Без имени»
4. Секции по продуктам — белые карточки с цветным бордером, тень, цветные иконки
5. Training item → existing `StudentProgressModal`
6. Site form item → existing `SiteFormDetailDialog`
7. Никаких новых training renderers не создано