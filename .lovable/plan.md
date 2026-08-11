# План: PLAN-ONLY ревизия PR #296 (SHA 5e99bb78) — VERDICT: PASS

Мутаций нет: код не менялся, миграции/функции/данные не трогались.

## 1) Синхронизация SHA — PASS
Managed HEAD = `5e99bb7857937a23625542dec8196ee6b8dc827b`, совпадает с merged GitHub main. Изменённые файлы в scope присутствуют: `src/components/admin/RefundDialog.tsx` (471 строка) и `src/components/admin/RefundAccessActionSelector.test.tsx`.

## 2) Проверка целей патча (read-only)
- Экспортирован контролируемый `RefundAccessActionSelector` с props `value / isFullRefund / onValueChange` — состояние `accessAction` управляется родителем.
- Клик работает по всей карточке (`onClick` на контейнере), по тексту (`Label` с `preventDefault` + прямой вызов) и по радио (`RadioGroup.onValueChange`), без двойного срабатывания (`stopPropagation` на радио).
- Уникальные id: `useId()` + суффикс значения, `htmlFor` связан с `RadioGroupItem`.
- Выделение выбранной карточки: `data-selected` + классы `border-primary bg-primary/5`.
- Частичный возврат: карточка `revoke` `disabled`, плюс `adjustRefundAccessActionForAmount` в `useEffect` переводит `revoke → reduce`.
- Безопасный default из предыдущего патча сохранён: `useState(DEFAULT_REFUND_ACCESS_ACTION)` = `keep`, в запрос уходит `access_action: accessAction`.
- Тесты в scope: 7/7 PASS (`RefundAccessActionSelector.test.tsx` + `refundPreserveAccess.test.ts`).

## 3) Backend — изменений не требуется
Патч чисто фронтовый: нет новых таблиц/колонок/RPC, нет правок Edge Functions, нет DML. Ранее развёрнутые `subscription-admin-actions` (default `keep`) и `telegram-revoke-access` (`respect_remaining_access`) остаются актуальными.

## 4) Security — critical findings в scope нет
Компонент не работает с секретами, ролями и RLS; меняется только выбор действия, который валидируется на бэкенде.

## EXECUTE-план (после одобрения)
1. Подтвердить, что managed HEAD всё ещё `5e99bb78…`; при расхождении — STOP.
2. Production build текущего SHA (тесты + сборка). При ошибке — STOP.
3. Publish фронтенда на `https://gorbova.lovable.by`/`gorbova.lovable.app` (только UI, без функций и миграций).
4. Безопасная UI-проверка без реального возврата: открыть админ-заказ, открыть диалог возврата, убедиться что по умолчанию выбрано «Сохранить доступ»; кликнуть по тексту и по карточке всех четырёх опций — выбор переключается и подсвечивается; ввести частичную сумму — «Аннулировать доступ» недоступен, а `revoke` не остаётся выбранным. Диалог закрыть **без** нажатия кнопки подтверждения возврата.
5. Скриншоты опубликованного результата: десктоп и мобильный viewport, без персональных/платёжных данных.

## Явно вне scope
Другие задачи, шаблоны, биллинг, роли, чаты, данные пользователей, любые миграции и деплой функций.
