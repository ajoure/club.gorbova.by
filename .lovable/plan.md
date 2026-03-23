## да, согласен, с учетом правок:

1. **PATCH 7 остаётся provisional**, пока формально не закрыт PATCH 6:
  - ручной `probable duplicate`
  - ручной `keyboard select`
  - cleanup тестовых person-records
2. В `useEntityPersonLinks.ts` лучше зафиксировать тип явно, а не через расплывчатый `Partial`:
  - `updateLink(payload: LinkUpdatePayload & { id: string; old_person_id?: string })`
  - чтобы не потерять `person_id` снова при следующей правке
3. В `updateLink` нужно явно подтвердить, что в `.update(payload)` теперь реально уходит:
  - `person_id`
  - `role_catalog_id`
  - `role_type`
  - `position_catalog_id`
  - `custom_position_text`
  - `custom_role_text`
  - `share_percent`
  - `acts_on_basis`
  - `is_primary`
  - `notes`  
  И что `old_person_id` туда **не** попадает.
4. В invalidation лучше описать точнее:
  - `['entity-person-links', legalDetailsId]` инвалидируется всегда один раз
  - `['person-linked-entities', old_person_id]` инвалидируется, если был old
  - `['person-linked-entities', new_person_id]` инвалидируется, если отличается от old  
  То есть не дёргать лишний раз один и тот же person-block.
5. В proof round после FIX-1 обязательно добавить отдельный кейс:
  - редактирование связи и **смена person_id**
  - после save link исчез из старой карточки физлица
  - появился в новой карточке физлица
  - в карточке юрлица отображается новый человек, а не старый
6. Отдельно в proof round зафиксировать:
  - delete удаляет **только link**
  - person не деактивируется
  - entity не меняется
7. В финальном отчёте по PATCH 7 нужен отдельный блок:
  - **FIX-1**
  - затем **PATCH 7 PROOF-1**
  - затем **Не затронуто**

Итог: сам фикс правильный, его можно делать именно в таком направлении. После него сразу нужен runtime proof, особенно на сценарий **reassign link другому person**.

PATCH 7 FIX-1: Исправление edit path + подготовка к proof round

### Баг

Строка 167 в `EntityPersonLinksBlock.tsx`:

```
onSubmit={editingLink ? (p) => updateLink({ ...p, id: editingLink.id, person_id: editingLink.person_id } as any) : createLink}
```

Проблема двойная:

1. `person_id: editingLink.person_id` затирает новый `person_id` из формы — нельзя перевесить связь на другого человека
2. `updateLink` в хуке деструктурирует `person_id` из payload и **не включает его в `.update()**` (строка 181: `{ id, person_id, ...payload }` — `person_id` уходит в rest-деструктуризацию, но используется только для invalidation)

### Исправления

**Файл 1: `src/components/ai-requisites/EntityPersonLinksBlock.tsx**` (строка 167)

Убрать затирание `person_id`. Передавать `id` и **оба** person_id (старый для invalidation, новый в payload):

```typescript
onSubmit={editingLink 
  ? (p) => updateLink({ ...p, id: editingLink.id, old_person_id: editingLink.person_id } as any) 
  : createLink}
```

**Файл 2: `src/hooks/useEntityPersonLinks.ts**` (строки 180-198)

Изменить `updateLink` mutation:

- Принимать `old_person_id` отдельно
- Включить `person_id` в `.update()` payload (чтобы связь реально перевешивалась)
- При invalidation инвалидировать **и** старый, **и** новый `person_id`

```typescript
const updateLink = useMutation({
  mutationFn: async ({ id, old_person_id, ...payload }: Partial<LinkInsertPayload> & { id: string; old_person_id?: string }) => {
    const { data, error } = await supabase
      .from("legal_details_entity_person_links")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      const friendly = parseUniqueViolation(error);
      throw new Error(friendly || error.message);
    }
    return { ...data, old_person_id };
  },
  onSuccess: (data, variables) => {
    invalidateLinks(variables.old_person_id);
    if (data.person_id && data.person_id !== variables.old_person_id) {
      invalidateLinks(data.person_id);
    }
    toast.success("Связь обновлена");
  },
  onError: (error) => toast.error(error.message),
});
```

**Файл 3: `src/components/ai-requisites/EntityPersonLinkForm.tsx**` (строки 118-123)

Форма уже корректно передает `person_id` из state в payload (строка 104). Проблема была только в затирании на уровне `EntityPersonLinksBlock`. Форму не трогаем.

### Не трогаем

- `PersonPicker` — без изменений
- `PersonLinkedEntitiesBlock` — read-only, без изменений  
- `PersonFieldsForm` / `PersonRecordSheet` — без изменений
- `/settings/legal-details` — без изменений
- Documents / billing / edge functions — без изменений

### После FIX-1 — proof round PATCH 7

Runtime proof по всем обязательным сценариям из DoD.