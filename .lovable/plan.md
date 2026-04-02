# да, согласен, с учетом правок:

&nbsp;

1. **Это действительно не только UI-баг, а ещё и DB-level блокер.**
  Если trigger запрещает training_content для чужого product_id, то flow Использовать через правило никогда не станет рабочим без миграции. Это нужно зафиксировать как обязательную часть патча, а не optional.
2. **Миграция должна быть add-only и точечной.**
  Нельзя переписывать всю функцию с риском сломать другие проверки.
  Нужно убрать только один guard:
  training_modules.product_id = access_rules.product_id
  Все остальные проверки в validate_training_content_rule() оставить без изменений:
  &nbsp;
  - target_ref существует
  - target_ref = root module
  - partial/full validation
  - allowed_module_ids / allowed_lesson_ids validation
  &nbsp;
3. **Нужен отдельный proof по миграции.**
  После deploy:
  &nbsp;
  - показать diff старой/новой проверки
  - выполнить insert/update training_content rule для external training
  - убедиться, что DB больше не возвращает owner-match error
  - при этом invalid non-root training по-прежнему блокируется
  &nbsp;
4. **В UI нельзя полагаться только на useViaRuleTraining state.**
  Если пользователь обновит страницу, откроет dialog повторно или попадёт в edit-mode, preselected training не должен теряться.
  Поэтому источник истины:
  &nbsp;
  - основной: [form.target](http://form.target)_ref / [form.target](http://form.target)_label
  - вспомогательный: useViaRuleTraining только как hydration helper для первого открытия
  &nbsp;
5. **rootTrainings нельзя просто расширять вручную только в рендере.**
  Нужно сделать нормализованный список options:
  &nbsp;
  - обычные rootTrainings текущего продукта
  - плюс externalSelectedTraining, если [form.target](http://form.target)_ref задан и не найден в обычном списке
    И уже этот объединённый список использовать и для Select, и для label resolution, и для validation.
  &nbsp;
6. **Нужен явный режим external training selected.**
  Для него в UI показать:
  &nbsp;
  - badge или helper text: внешний тренинг
  - пояснение: используется через правило доступа, владелец не меняется
    Иначе пользователь не понимает, почему выбран тренинг, который не числится в списке тренингов продукта.
  &nbsp;
7. **Save handler нужно править не только в месте target_label.**
  Если сейчас есть проверка вида:
  &nbsp;
  - training must be found in rootTrainings
  - если нет — показать “сначала привяжите тренинг”
    её нужно удалить/разделить.
    Новая логика:
  - если [form.target](http://form.target)_ref пустой → ошибка
  - если training по target_ref существует в БД и это root module → валидно
  - owner-match не нужен
  &nbsp;
8. **Нужен fetch training by id для preselected external training.**
  Не через хардкод в state, а через нормальный query:
  &nbsp;
  - если [form.target](http://form.target)_ref задан
  - и он отсутствует в rootTrainings
  - загрузить training по id
  - проверить, что это root module
  - подмешать в options как externalSelectedTraining
  &nbsp;
9. **useAccessRules.ts toast надо менять, но только как fallback.**
  Основной fix — миграция и form hydration.
  Новый toast нужен на случай:
  &nbsp;
  - миграция не применена
  - окружение отстаёт
  - пришёл старый DB error
    Сообщение лучше сделать таким:
    Этот тренинг принадлежит другому продукту. Для использования через правило доступа должна быть применена новая миграция.
  &nbsp;
10. **Добавь явный proof-step на regression:**
  После фикса нужно проверить оба сценария:
  &nbsp;
  - use via rule для external training → работает
  - обычное создание training_content rule для training текущего продукта → не сломалось
  &nbsp;
11. **Нужен ещё один guard:**
  Если external training выбран через use via rule, а потом пользователь вручную меняет grant_target_type на другой тип, нужно:
  &nbsp;
  - либо очистить useViaRuleTraining
  - либо очистить target_ref/target_label
    чтобы не остался “висячий” prefilled state.
  &nbsp;
12. **DoD дополни двумя пунктами:**
  &nbsp;
  - edit existing training_content rule с external training тоже открывается корректно и показывает target
  - после refresh/reopen формы выбранный внешний training не превращается в пустое поле, если target_ref уже сохранён
  &nbsp;

&nbsp;

&nbsp;

**Итог:** направление плана правильное. Без миграции этот flow не починить. Но рекомендую усилить план тем, что canonical selected state должен строиться вокруг [form.target](http://form.target)_ref, а не только вокруг временного useViaRuleTraining.

&nbsp;

План: Fix "Использовать через правило" flow для training_content

## Диагноз

Проблема двухуровневая:

1. **DB trigger** (`validate_training_content_rule`, строки 31-41 в миграции `20260331142140`) — жёстко требует `training_modules.product_id = access_rules.product_id`. Это блокирует создание правила для тренинга, принадлежащего другому продукту.
2. **UI: `rootTrainings` query** (строка 265-279 `ProductAccessRulesTab.tsx`) — фильтрует `.eq("product_id", productId)`. Тренинг другого продукта не попадает в список → Select не содержит preselected option → визуально пустой, валидатор считает что ничего не выбрано.

## Что делаем

### Фаза 1: Миграция — ослабить DB trigger

Заменить блок проверки `product_id must match` на мягкую проверку: разрешить cross-product usage, но оставить проверку что target_ref — root module.

```sql
CREATE OR REPLACE FUNCTION validate_training_content_rule()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grant_target_type = 'training_content' THEN
    -- Must be root module
    IF NOT EXISTS (
      SELECT 1 FROM training_modules
      WHERE id::text = NEW.target_ref AND parent_module_id IS NULL
    ) THEN
      RAISE EXCEPTION 'training_content rule target must be a root training module';
    END IF;

    -- conditions validation (access_mode, partial allowlists) — без изменений
    ...
  END IF;
  RETURN NEW;
END;
```

Удаляется **только** блок `product_id must match` (строки 31-41). Все остальные проверки остаются.

### Фаза 2: UI — добавить sourceMode и гидрацию

**Файл: `ProductAccessRulesTab.tsx**`

1. Добавить state `useViaRuleTraining`:

```typescript
const [useViaRuleTraining, setUseViaRuleTraining] = useState<{id: string, title: string} | null>(null);
```

2. В `openCreateTrainingContentRule` сохранять это:

```typescript
const openCreateTrainingContentRule = useCallback((targetRef: string, targetLabel: string) => {
  setUseViaRuleTraining({ id: targetRef, title: targetLabel });
  setEditing(null);
  setForm({...defaultForm, grant_target_type: "training_content", target_ref: targetRef, target_label: targetLabel, tariff_id: ""});
  setAdvancedOpen(false);
  setDialogOpen(true);
}, []);
```

3. При закрытии диалога — сбрасывать: `setUseViaRuleTraining(null)`.
4. В блоке рендера Select для тренинга (строка 1224-1264):

- Если `useViaRuleTraining` не null и его id нет в `rootTrainings` — добавить его как дополнительный option в Select
- Если `rootTrainings.length === 0` **и** `useViaRuleTraining` не null — показать Select с одним option (а не заглушку "Сначала привяжите")
- Под полем показать helper: `"Тренинг используется через правило доступа. Владелец не меняется."`

5. В save handler (строка 610-612): если `useViaRuleTraining` и training не найден в `rootTrainings`, использовать `form.target_label` напрямую вместо lookup.

### Фаза 3: Error handler — смягчить toast

**Файл: `src/hooks/useAccessRules.ts**` (строки 191-192, 225-226)

Изменить обработку ошибки `product must match` — вместо "Сначала привяжите тренинг" показать "Тренинг принадлежит другому продукту. Используйте flow «Использовать через правило»." (на случай если миграция ещё не применена или edge case).

## Файлы для изменения


| Файл                                                     | Что                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Новая миграция SQL                                       | Убрать product_id match check из trigger                                   |
| `src/components/admin/product/ProductAccessRulesTab.tsx` | `useViaRuleTraining` state, гидрация Select, helper text, save handler fix |
| `src/hooks/useAccessRules.ts`                            | Обновить toast сообщение для product match error                           |


## DoD

1. «Использовать через правило» → create-dialog открывается с заполненным полем «Тренинг»
2. Тренинг другого продукта отображается как валидный selected option
3. Сохранение правила проходит без ошибки
4. `training_modules.product_id` не меняется
5. `tariff_id` пустой — пользователь выбирает сам
6. Helper text под полем тренинга при sourceMode = use_via_rule
7. DB trigger проверяет root module, но не owner match