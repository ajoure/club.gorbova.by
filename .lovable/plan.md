да, согласен, с учетом правок:

## **1. План принимается, root cause валидный**

Диагноз выглядит точным:

```text
PostgREST падает на permission denied for table kb_questions
UI маскирует ошибку под empty-state
```

Это объясняет все наблюдения:

- `/knowledge` доступен;
- раздел не закрыт;
- skeleton висит долго;
- потом появляется «Вопросы ещё не добавлены»;
- фактически контент есть: `kb_questions = 669`;
- ошибка не trial-specific, а общая для всех обычных пользователей.

---

## **2. GRANT — approved, но проверить связанные embedded-таблицы**

Хук делает embedded select:

```text
kb_questions with training_lessons → training_modules
```

Поэтому одного `GRANT SELECT ON kb_questions TO authenticated` может быть недостаточно.

До execute проверить grants/RLS также на:

```text
training_lessons
training_modules
```

Если PostgREST embedded select требует доступ к этим таблицам, добавить минимальные read grants:

```sql
GRANT SELECT ON public.training_lessons TO authenticated;
GRANT SELECT ON public.training_modules TO authenticated;
GRANT ALL ON public.training_lessons TO service_role;
GRANT ALL ON public.training_modules TO service_role;
```

Но только если эти таблицы реально участвуют в публичном `/knowledge` query и у них нет нужных grants.

В отчёте показать:

```text
kb_questions grant: PASS
training_lessons grant: PASS / not required
training_modules grant: PASS / not required
```

---





## **3.**

`anon` **не грантить**

Согласен:

```text
anon GRANT не нужен
```

Раздел требует login + `get_user_section_access`.  
Открывать `kb_questions` для `anon` нельзя.

---

## **4. RLS не переписывать без необходимости**

Согласен:

```text
RLS policies не трогать
```

Если `authenticated SELECT USING (true)` уже есть, проблема именно в table grants, не в policy.

---

## **5. Service role GRANT аккуратно**

`GRANT ALL TO service_role` допустим, но в отчёте нужно показать, зачем он нужен.

Если service role уже bypasses RLS, всё равно table privilege может быть нужен PostgREST/SQL-контексту. Достаточно зафиксировать:

```text
service_role grant added for operational/API compatibility
```

---

## **6. Frontend error-state обязателен**

Исправление grants решит текущий баг, но UI всё равно надо починить, потому что сейчас любая ошибка превращается в:

```text
Вопросы ещё не добавлены
```

Это неверно.

Approved:

- `useKbQuestions` отдаёт `isError`, `error`, `refetch`;
- `Knowledge.tsx` показывает отдельный error-state;
- empty-state показывается только при успешном `200` и пустом массиве.

---





## **7.**

`onError` **в React Query проверить по версии**

Если используется TanStack Query v5, `onError` в `useQuery` мог быть удалён/изменён.

Не завязываться строго на `onError`. Можно логировать так:

```ts
useEffect(() => {
  if (isError) console.error("[useKbQuestions]", error);
}, [isError, error]);
```

Главное — не сломать hook.

---

## **8. Error-state smoke не делать через permanent code change**

Фраза:

```text
временно вернуть select=* с несуществующим столбцом
```

Допустимо только локально/в тесте, не в прод-коде.

Лучше:

- Playwright route mock `kb_questions → 500`;
- или локальный dev временный mock;
- или unit/integration test.

В отчёте указать, что это не попало в deploy.

---

## **9. Verify под Safari/WebKit**

Согласен, но URL лучше проверять на том же домене, где пользователь видит проблему:

```text
https://gorbova.by/knowledge
```

`gorbova.lovable.app` можно использовать как дополнительный smoke, но primary proof — `gorbova.by`.

---

## **10. Проверить section access перед content query**

В runtime proof показать оба шага:

```text
get_user_section_access('knowledge') = true
kb_questions query = 200, rows > 0
```

Иначе можно спутать доступ к разделу и загрузку контента.

---

## **11. Проверить, что пустое состояние реально осталось для пустого ответа**

После error-state fix добавить smoke:

```text
successful query with [] → “Вопросы ещё не добавлены”
failed query → “Не удалось загрузить вопросы”
successful query with rows → карточки вопросов
```

То есть 3 состояния для контента:

```text
loading / error / empty / content
```

---

## **12. Финальный отчёт**

Заголовок:

```text
Отчет о выполненной работе: PATCH-KNOWLEDGE-CONTENT-EMPTY-FOR-TRIAL
```

Финальные строки:

```text
kb_questions authenticated grant: PASS
embedded tables grants checked: PASS
trial user section access: PASS
trial user questions_count > 0: PASS
admin/user query parity: PASS
network 200 body array: PASS
error-state separated from empty-state: PASS
Safari/WebKit private smoke: PASS
no-card trial subscriptions_v2 unchanged +0: PASS
PATCH-KNOWLEDGE-CONTENT-EMPTY-FOR-TRIAL: PASS
```

После этих правок план можно выполнять.

План: PATCH-KNOWLEDGE-CONTENT-EMPTY-FOR-TRIAL

## Diagnose (выполнено)

1. **Источник списка вопросов** на `/knowledge` → хук `src/hooks/useKbQuestions.ts` → прямой select на таблицу `public.kb_questions` с embedded `training_lessons → training_modules`.
2. **RLS на `kb_questions**`: 2 политики:
  - `kb_questions_admin_all` — ALL для admin/superadmin
  - `kb_questions_select_authenticated` — SELECT `USING (true)` для роли `authenticated`
   Содержимое: 669 строк. Семантически — раздел публичен для всех залогиненных, ограничение пакетом доступа делается через `section_access` (это уже починили предыдущим патчем).
3. **Root cause найден** — `information_schema.role_table_grants` на `public.kb_questions`:
  ```
   grantee       | privilege
   sandbox_exec  | INSERT
   sandbox_exec  | SELECT
  ```
   **Нет ни одного GRANT'а ни для `anon`, ни для `authenticated`, ни для `service_role`.** PostgREST под ролью `authenticated` возвращает `permission denied for table kb_questions` ещё до проверки RLS. React-query ловит ошибку, `data=undefined`, `isLoading=false` → UI рендерит "Вопросы ещё не добавлены" (см. `Knowledge.tsx:111-120`).
4. **Почему админ "видит" контент** — админ обычно работает через `/admin/kb-import` (другая страница, тот же запрет, но он там не смотрит список). Реально 0 вопросов сейчас видят ВСЕ пользователи на `/knowledge`, включая админов; пользователь триала просто первым заметил.
5. **Empty-state vs error-state** — хук игнорирует `isError`; страница смотрит только на `isLoading` и пустоту массива → любая ошибка тихо превращается в "Вопросы ещё не добавлены".

Это **не trial-specific** и не связано с `subscriptions_v2` / entitlements: после правки GRANT кейс закрывается одинаково и для trial, и для платных, и для админа. Никакой подмены модели доступа делать не нужно.

## Fix

### 1. Миграция: GRANT'ы Data API на `public.kb_questions`

```sql
GRANT SELECT ON public.kb_questions TO authenticated;
GRANT ALL    ON public.kb_questions TO service_role;
-- anon НЕ грантим: раздел требует входа (section_access + RLS-policy для authenticated)
```

RLS не трогаем — текущие политики корректно описывают бизнес-правило ("залогинен → видишь раздел; admin → может писать"). Гейтинг по тарифу делает `get_user_section_access` на уровне страницы.

### 2. Frontend: разделить error и empty в `useKbQuestions` + `Knowledge.tsx`

- `useKbQuestions.ts`: пробросить `isError`, `error` дальше (уже доступны из `useQuery`, просто не использовались).
- `Knowledge.tsx → QuestionsContent`:
  - принять `isError` от хука;
  - при `isError` рендерить отдельный блок «Не удалось загрузить вопросы. Попробуйте обновить страницу» + кнопка Retry (вызов `refetch()`);
  - оставить существующий empty-state только для реально пустого ответа.
- Логировать `console.error("[useKbQuestions]", error)` в `onError` запроса, чтобы будущие fetch-ошибки были видны в логах, а не маскировались.

### 3. Verify

- SQL после миграции: `psql -c "SET role authenticated; SELECT count(*) FROM public.kb_questions;"` → 669.
- Playwright под триал-аккаунтом `1@ajoure.by` (auth.uid `37e91f59`): `/knowledge` → таб «Вопросы» → ожидаем >0 карточек, без skeleton-залипания. Скриншот в отчёт.
- Playwright Safari/WebKit (normal + private) поверх `https://gorbova.lovable.app/knowledge` после деплоя — тот же ассерт, чтобы закрыть пункт "Safari private smoke".
- Network: запрос `kb_questions?select=...` → 200, тело — массив, не `42501 permission denied`.
- Error-state smoke: временно вернуть `select=*` с несуществующим столбцом → убедиться, что UI показывает блок «Не удалось загрузить», а не "Вопросы ещё не добавлены".

## Out of scope

- Не выдаём ручной доступ.
- Не добавляем admin bypass.
- Не меняем тарифные правила и `get_user_section_access`.
- Не возвращаем `subscriptions_v2` для no-card trial.
- Не переписываем RLS на `kb_questions` — текущие политики верны.

## DoD

- `GRANT SELECT TO authenticated` и `GRANT ALL TO service_role` на `public.kb_questions` зафиксированы миграцией: PASS
- trial user `/knowledge` → questions_count > 0: PASS
- admin user тот же запрос → questions_count = trial questions_count: PASS
- no-card trial subscriptions_v2 +0 (не создаём подписку): PASS (не трогаем этот путь)
- `useKbQuestions` отдаёт `isError`; `Knowledge.tsx` рендерит отдельный error-state с retry: PASS
- Playwright WebKit normal + private поверх прод-домена: PASS
- Network 200, тело-массив: PASS
- PATCH-KNOWLEDGE-CONTENT-EMPTY-FOR-TRIAL: PASS