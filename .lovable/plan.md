да, согласен, с учетом правок:

&nbsp;

1. В патче заменить getClaims() на getUser(), как ты описал. Это правильная правка.
2. В EF не передавать токен в getUser(...) параметром. Делать так:  

  - создать userClient с Authorization header
  - вызвать именно await userClient.auth.getUser()
  - взять callerUser?.id  
  То есть источник пользователя должен быть только из JWT запроса.
3. &nbsp;
4. После патча нужен повторный proof именно из UI, не через curl:  

  - нажать Обновить сейчас на /admin/docs
  - проверить в audit_logs:  

    - system_docs.manual_refresh_started
    - system_docs.manual_refresh_completed
    - actor_type='user'
    - actor_user_id заполнен реальным UUID
  - &nbsp;
5. &nbsp;
6. В финальный proof-пакет добавить этот отдельный блок:  

  - “manual refresh actor proof”
  - до фикса: actor_user_id = NULL
  - после фикса: actor_user_id != NULL
7. &nbsp;
8. Остальные пункты можно считать подтвержденными только после этого последнего proof. Без него патч документации ещё не закрывать окончательно.

&nbsp;

&nbsp;

После этого уже можно считать модуль документации закрытым.

&nbsp;

# План: Финальный корректирующий патч — actor_user_id для manual refresh

## Обнаруженное расхождение

**Критическое:** В EF `system-docs-nightly-refresh` для manual refresh используется несуществующий метод `userClient.auth.getClaims()`. Метод молча возвращает ошибку, `callerUserId` остаётся `null`.

**Proof из audit_logs:**

```
manual_refresh_completed: actor_type=user, actor_user_id=NULL ← должен быть user_id
manual_refresh_started:   actor_type=user, actor_user_id=NULL ← должен быть user_id
```

## Остальные proofs — ОК


| Проверка                                                                  | Статус |
| ------------------------------------------------------------------------- | ------ |
| 7 AUTO-CURRENT, по 1 на section_key                                       | ✅      |
| products_sales: POINT A (archived), B (archived), C (active) — не тронуты | ✅      |
| Seed: actor_type='user', actor_label='admin_system_docs_seed'             | ✅      |
| AdminProductsDocs — чистая preset-обёртка (6 строк)                       | ✅      |
| Deep-link: domain/mode/version в URL                                      | ✅      |
| auto mode очищает version                                                 | ✅      |
| Cron: 1 job, schedule `0 * * * *`                                         | ✅      |


## Патч (1 файл)

**Файл:** `supabase/functions/system-docs-nightly-refresh/index.ts`, строки 49-61

**Было:**

```ts
const userClient = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: authHeader } },
});
const { data: claimsData } = await userClient.auth.getClaims(...);
if (claimsData?.claims?.sub) {
  callerUserId = claimsData.claims.sub;
}
```

**Нужно:**

```ts
const userClient = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: authHeader } },
});
const { data: { user: callerUser } } = await userClient.auth.getUser();
if (callerUser?.id) {
  callerUserId = callerUser.id;
}
```

`getUser()` — стандартный метод Supabase JS SDK, валидирует JWT серверно и возвращает `user.id`.

## После патча — повторный proof

Вызвать manual refresh из UI и проверить в audit_logs:

- `actor_type = 'user'`
- `actor_user_id` ≠ NULL (реальный UUID)