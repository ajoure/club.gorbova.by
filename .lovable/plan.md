Да, согласен, с учетом правок:

&nbsp;

1. Не писать в плане, что нужны «2 правки». По факту кодовая правка одна:  
src/hooks/useTrainingModules.tsx — заменить  
const tariffIds = (tcData.userTariffIds || []).sort().join(",");  
на  
const tariffIds = [...(tcData.userTariffIds || [])].sort().join(",");
2. Отдельно зафиксировать, что stale guard уже проверен и дополнительных кодовых правок не требует. Это не task на изменение, а task на proof. В отчете явно указать:  

  - guard перед setModules — есть;
  - guard перед error/toast branch — есть;
  - guard перед setLoading(false) — есть;
  - setError в этом хуке не используется.
3. &nbsp;
4. Не закрывать патч формулировкой «по коду всё ок». Нужен обязательный runtime-proof в 3 сценариях:  

  - hard refresh;
  - прямой вход по URL;
  - SPA navigation без refresh.
5. &nbsp;
6. Добавить обязательную proof-таблицу по продуктам пользователя, чтобы подтвердить гипотезу, что выживает именно base/direct access, а раньше исчезали secondary sources:  
product | access_source | before refresh | after refresh | should survive | actual
7. В proof отдельно проверить и отразить гипотезу:  

  - Бухгалтерия как бизнес остается как base/direct product access;
  - исчезали продукты с источником:  

    - entitlement-only
    - rule-based
    - module-based
    - mixed
  - &nbsp;
8. &nbsp;
9. DoD переформулировать жёстко:  

  - после hard refresh список тренингов совпадает с реальными доступами;
  - sidebar и страница тренингов показывают одинаковую картину;
  - secondary access sources не исчезают;
  - нет пустого контейнера/пустого дерева уроков после reload;
  - proof приложен по 3 сценариям.
10. &nbsp;

&nbsp;

&nbsp;

Копируемый блок для отправки:

Финализируй план с учетом правок:

&nbsp;

1. Кодовая правка по факту одна:

   Файл: src/hooks/useTrainingModules.tsx

   Было:

   const tariffIds = (tcData.userTariffIds || []).sort().join(",");

   Нужно:

   const tariffIds = [...(tcData.userTariffIds || [])].sort().join(",");

&nbsp;

2. Stale guard не выносить как отдельную кодовую правку — он уже проверен и дополнительных изменений не требует.

   В отчете отдельно зафиксируй proof:

   - guard перед setModules — есть

   - guard перед error/toast branch — есть

   - guard перед setLoading(false) — есть

   - setError в хуке не используется

&nbsp;

3. Патч не закрывать без runtime-proof в 3 сценариях:

   - hard refresh

   - прямой вход по URL

   - SPA navigation без refresh

&nbsp;

4. Добавь обязательную proof-таблицу:

   product | access_source | before refresh | after refresh | should survive | actual

&nbsp;

5. Отдельно проверь и докажи гипотезу:

   - “Бухгалтерия как бизнес” остается как base/direct product access

   - раньше исчезали secondary access sources:

     - entitlement-only

     - rule-based

     - module-based

     - mixed

&nbsp;

6. Финальный DoD:

   - после hard refresh список тренингов совпадает с реальными доступами

   - sidebar и страница тренингов показывают одинаковую картину

   - secondary access sources не исчезают

   - нет пустого контейнера/пустого дерева уроков после reload

   - приложен proof по всем 3 сценариям

&nbsp;

## План: Финализация патча — 2 правки + runtime-proof

---

### Правка 1: Мутация массива в tcFingerprint

**Файл:** `src/hooks/useTrainingModules.tsx`, строка 71

Сейчас:

```typescript
const tariffIds = (tcData.userTariffIds || []).sort().join(",");
```

`.sort()` мутирует оригинальный массив `tcData.userTariffIds`. Нужно:

```typescript
const tariffIds = [...(tcData.userTariffIds || [])].sort().join(",");
```

---

### Правка 2: Проверка stale guard — УЖЕ ОК

Проверено по коду: `fetchId !== fetchIdRef.current` стоит перед **каждым** setState:

- Строка 320: перед `setModules(finalModules)` ✓
- Строка 323: перед `console.error` + `toast.error` ✓  
- Строка 327: перед `setLoading(false)` ✓

`setError` не используется — нет `useState` для error. Ошибки обрабатываются через `toast.error`.

**Вывод:** stale guard полный, правок не требует.

---

### Правка 3: Runtime-proof (3 сценария)

После применения правки 1, требуется runtime-proof на реальном пользователе с несколькими источниками доступа:

1. **Hard refresh** страницы кабинета
2. **Прямой вход по URL** в тренинги
3. **SPA navigation** без refresh

Во всех трёх случаях список тренингов должен совпадать.

Дополнительно — proof-таблица по гипотезе:


| product | access_source | before refresh | after refresh | should survive | actual |
| ------- | ------------- | -------------- | ------------- | -------------- | ------ |


---

### Файлы для изменения


| Файл                               | Изменение                      |
| ---------------------------------- | ------------------------------ |
| `src/hooks/useTrainingModules.tsx` | Строка 71: spread перед sort() |


### DoD

1. `sort()` не мутирует исходный массив
2. Stale guard подтверждён перед каждым setState
3. Runtime-proof в 3 сценариях пройден
4. Proof-таблица по access sources предоставлена