# да, согласен, с учетом правок:

&nbsp;

1. **После removePricingBlockMutation обязательно инвалидировать те же query keys, что и после add/unbind.**
  Иначе статус страницы, canonical pricing URL и diagnostic badge могут не обновиться сразу.
2. **Для удаления блока добавить STOP-guard:**
  если linkedPage отсутствует или matching pricing block не найден, mutation не выполнять и не писать пустой update.
3. **Для linked_pricing_multiple зафиксировать поведение явно в тексте плана:**
  кнопка “Убрать блок тарифов” удаляет **все** pricing blocks текущего продукта на этой странице, а не один случайный.
4. **На время removePricingBlockMutation заблокировать повторный клик по кнопке.**
  Иначе можно получить двойной update и лишние race-condition в UI.
5. **После удаления блока показать отдельный success-text:**
  именно “Блок тарифов убран со страницы”, чтобы не путать с откреплением страницы.

&nbsp;

&nbsp;

Копируемый блок для Lovable:

```
Закрой PATCH E только в рамках `src/components/admin/product/ProductSitePageBinding.tsx`.

Правки к текущему плану:

1. Добавь `removePricingBlockMutation`:
- удалить из `linkedPage.blocks` все блоки, где `type === 'pricing' && content.product_id === productId`;
- сохранить страницу через update `site_pages.blocks`;
- страницу не удалять;
- `product_id` у страницы не менять.

2. После успешного удаления обязательно инвалидировать те же query keys, что используются после bind / unbind / add pricing block, чтобы:
- resolver пересчитался сразу,
- diagnostic badge обновился сразу,
- canonical pricing URL исчез сразу.

3. Добавь STOP-guard:
- если `linkedPage` отсутствует — mutation не выполнять;
- если matching pricing block не найден — mutation не выполнять и пустой update не отправлять.

4. Для состояния `linked_pricing_ready` добавить кнопку “Убрать блок тарифов”.

5. Для состояния `linked_pricing_multiple` добавить ту же кнопку.
Поведение зафиксировать явно:
- удаляются все pricing blocks текущего продукта на этой странице.

6. На время `removePricingBlockMutation` блокировать повторный клик по кнопке.

7. После удаления показать success message:
- “Блок тарифов убран со страницы”.

8. Кнопку “Открепить страницу” не менять — текущая реализация корректна.

Итоговый DoD:
- создать продающую страницу можно;
- открепить страницу можно;
- добавить pricing block можно;
- убрать pricing block можно;
- после удаления pricing block canonical pricing URL исчезает сразу;
- статус в resolver/diagnostics обновляется сразу без перезагрузки;
- все базовые действия выполняются прямо из карточки продукта.

План: Закрывающие правки PATCH E — обратимость действий
```

## Scope

Только `ProductSitePageBinding.tsx`. Никаких новых сущностей, таблиц, рефакторингов.

## Изменения

### 1. Добавить mutation "Убрать блок тарифов"

Новый `removePricingBlockMutation`:

- Фильтрует `linkedPage.blocks`, убирая блоки где `type === 'pricing' && content.product_id === productId`
- Сохраняет через `supabase.from("site_pages").update({ blocks: filteredBlocks }).eq("id", linkedPage.id)`
- Не удаляет страницу, не снимает привязку

### 2. Обновить `DiagnosticBadge`

- `linked_pricing_ready`: добавить кнопку "Убрать блок тарифов" (иконка Minus/Trash2, вызывает `onRemovePricingBlock`)
- `linked_pricing_multiple`: добавить ту же кнопку (убирает все matching блоки)

### 3. Кнопка "Открепить страницу" уже есть

Кнопка `Unlink` на строке 266-274 уже вызывает `unbindMutation` (ставит `product_id = null`). Это уже реализовано корректно.

### Файлы

- `src/components/admin/product/ProductSitePageBinding.tsx` — единственный файл

### DoD

- Можно создать продающую страницу ✓ (уже работает)
- Можно открепить страницу ✓ (уже работает)
- Можно добавить pricing block ✓ (уже работает)
- **Можно убрать pricing block** ← новое
- Canonical pricing URL исчезает если block удалён ✓ (автоматически через resolver)
- Базовые действия из карточки продукта без захода в конструктор