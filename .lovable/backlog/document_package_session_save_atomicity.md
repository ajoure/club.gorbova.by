# Backlog: атомарность `useDocumentPackageSession.save()`

## Контекст

Sprint 1 закрыт. Сохранение persisted session в `useDocumentPackageSession.ts` сейчас работает по схеме:

1. `upsert` в `document_package_sessions` по `(profile_id, package_template_id)`.
2. `delete` всех строк `document_package_session_participants` с `session_id = <current>`.
3. `insert` нового набора участников.

Все три шага выполняются с клиента через `supabase-js` (НЕ в одной транзакции).

## Риски

- При ошибке `insert` после успешного `delete` session остаётся **без участников** (визуально «Требует заполнения», данные ролей потеряны).
- `delete` ограничен только `session_id`, но RLS — единственный гарант, что нельзя удалить чужих participants. Нужен явный regression-тест.
- Параллельные вкладки одного пользователя могут устроить гонку: `delete` одной вкладки уничтожит participants, которых только что записала другая.

## Целевое решение (Sprint 3+)

RPC `package_session_replace_participants(p_session_id uuid, p_participants jsonb)`:

- `SECURITY DEFINER`, `search_path = public`;
- проверяет владельца session по `auth.uid()`;
- внутри транзакции: `DELETE … WHERE session_id = p_session_id` + `INSERT … SELECT … FROM jsonb_to_recordset(p_participants)`;
- возвращает массив итоговых participants;
- идемпотентна по содержимому (можно вызывать повторно).

UI:

- `save()` → один `supabase.rpc('package_session_replace_participants', …)` вместо двух раздельных вызовов.
- При ошибке RPC — состояние не меняется, тост `normalizeEdgeFunctionError(...)`.

## Что делать сейчас

- В Sprint 2 RPC **НЕ внедряется**.
- Никаких искусственных failing constraints в production. Atomicity проверяется только как code-path analysis в proof Sprint 2.
- Этот файл — точка входа для Sprint 3 hardening.

## Связанные артефакты

- `src/hooks/useDocumentPackageSession.ts`
- `.lovable/proofs/package_documents_ideology_sprint1_persisted_session_2026_05.md`
- `.lovable/proofs/package_documents_ideology_sprint2_placeholder_namespace_2026_05.md`
