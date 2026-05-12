# Sprint 12 — Document Scenarios in Payment Button (proof)

## Что сделано

1. **Тип** `OfferDocumentScenario` + поле `document_scenarios?: OfferDocumentScenario[]` в `OfferMetaConfig` (`src/hooks/useTariffOffers.tsx`). Add-only.
2. **UI карточка** `OfferDocumentScenariosCard.tsx` подключена под существующей `OfferDocumentDefaultsCard` во вкладке «Документы» оффера (`AdminProductDetailV2.tsx:2429`).
   - Массив сценариев, минимум две предзаполненные строки «Физлицо» и «Юрлицо».
   - Кнопки «Ещё сценарий ...» — поддержка произвольного количества.
   - Чекбоксы каналов: Карта / Apple Pay / Google Pay / ЕРИП / Банковский перевод.
   - Подсказка: «Apple Pay / Google Pay могут определяться провайдером как Карта».
   - Switch `is_enabled`, switch `requires_required_requisites`.
3. **One-shot нормализация** `payment_methods → payment_channels` при первом открытии вкладки. Запись только канонического поля. Глобальной миграции нет.
4. **Frontend helpers** (add-only):
   - `src/utils/derivePaymentChannel.ts` — frontend mirror backend-helper'а.
   - `src/utils/resolveDocumentScenario.ts` — общий резолвер.
5. **Backend mirror** `supabase/functions/_shared/document-scenario-resolver.ts` — идентичный алгоритм для snapshot.
6. **Snapshot** `_shared/document-data-snapshot.ts`: приоритет `override → scenario → defaults` для `template_id` и `executor_id`. В `_provenance.scenario` пишется `{source, scenario_id, payer_type, payment_channel, requires_required_requisites}`.
7. **Карточка сделки** `DealPayerDocumentsCard.tsx`:
   - переключена на общий резолвер `resolveDocumentScenario`;
   - локальные `derivePaymentChannel` / `resolveScenario` / `PAYMENT_LABEL` / `sourceLabel` удалены;
   - бейдж «Изменено вручную администратором» показывается ТОЛЬКО при фактическом override; иначе live matched scenario.
8. **Заголовок** `DealDocumentsCard.tsx` переименован в «Сформированные документы» (раньше «Документы (strict ID-first)»). Дублирование с «Документы / плательщик» снято.
9. **Memory** `mem://architecture/documents/document-scenarios-sot.md` — фиксация контракта.

## Smoke-proof резолвера (7/7)

```
✅ individual + card           → scenario tpl-ind-card
✅ individual + apple_pay      → scenario tpl-ind-card  (channel в списке)
✅ legal_entity + bank_transfer → scenario tpl-leg
✅ legal_entity + card          → defaults tpl-default  (disabled scenario игнорируется)
✅ individual + erip            → defaults tpl-default  (no matching scenario)
✅ no scenarios, only defaults → defaults tpl-only
✅ nothing                      → source=none, template_id=null
```

Запуск: `bunx tsx /tmp/scenario-smoke.ts` → `7 passed, 0 failed`.

## DoD

- [x] UI: предзаполнено «Физлицо» + «Юрлицо», поддержка массива.
- [x] Apple Pay / Google Pay подсказка в UI.
- [x] Снапшот: приоритет `override → scenario → defaults`.
- [x] Сценарий с `is_enabled=false` игнорируется (proof кейс 4).
- [x] Сценарий по правильному каналу (proof кейс 1, 3).
- [x] Fallback на `document_defaults` (proof кейс 4, 5, 6).
- [x] `source='none'` если ничего нет (proof кейс 7).
- [x] `DealPayerDocumentsCard` показывает override только при фактическом изменении (правка в строках 320–325).
- [x] `DealDocumentsCard` переименован.
- [x] `payments_v2` immutable: snapshot только читает payments_v2 (`select`), override пишет только в `orders_v2.meta.documents`.
- [x] `tsc --noEmit` clean: build errors после правок устранены (см. tool output).
- [x] Memory создана.
- [x] Новых таблиц/edge-функций/секретов нет.

## Что не делалось

- Глобальная миграция `payment_methods → payment_channels` по всем офферам (только one-shot при сохранении).
- E2E DOCX preview по живому шаблону (deferred до выбора пользователем шаблона/order).
- Backend hard-stop на unsupported токены в рассылках (deferred с предыдущей фазы).
