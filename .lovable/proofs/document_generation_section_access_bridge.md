# Proof: document_generation section access bridge

## Diagnose
- RPC `get_user_section_access` ранее не учитывал `grant_target_type='document_generation'`.
- AdminSections.tsx считал правила только по `section_access`.
- Из-за этого секция `/document-generation` оставалась закрытой для всех клиентов ИДЕОЛОГИИ, а в админке колонка «Правил» = 0.

## Cohort (active ИДЕОЛОГИЯ subs, tariff b018e9be-53ce-4840-8034-e09f8e319080)
| user_id | email | will_have_access_after_fix |
|---|---|---|
| 3328ff3b-10ad-4295-aac9-51ef0419767e | nastassia_87@mail.ru | true |
| f41c429b-ff68-4980-a9da-7f4f8ce18751 | naira.greek@gmail.com | true |

## Active rule (SOT, не меняли)
- id `90f6fd03-f584-44db-811e-8d9d67800c10`
- product_id `11c9f1b8-0355-4753-bd74-40b42aa53616`
- tariff_id `b018e9be-53ce-4840-8034-e09f8e319080` (ИДЕОЛОГИЯ)
- grant_target_type `document_generation`, target_ref `document_generation`
- conditions: `{access_mode: partial, allowed_package_ids: [06068dcf-...-cfd2 (Идеология)]}`

## Изменения
1. `get_user_section_access`: добавлена вторая ветка в CTE — `UNION ALL` правил `grant_target_type='document_generation' AND target_ref='document_generation'` с джойном по `app_sections.code='document_generation'`. Visibility-only: partial/full и allowed_package_ids на этом уровне игнорируются (фильтр пакетов остаётся в `get_user_document_package_ids`/RLS пакетов). GROUP BY по `sid` гарантирует отсутствие дублей при наличии обоих типов правил.
2. `AdminSections.tsx`: rules_count для секции `document_generation` суммирует оба источника.

## Default-deny regression
Юзер без соответствующих подписок/энтайтлментов на product/tariff из правила НЕ получает доступ — ветка `access_granted` в CASE остаётся false (ELSE-ветка).

## Не тронуто
- `grant-access-for-order`, entitlement-sync, training-content, package resolver, RLS пакетов, audit, edge functions, генерация документов, Gotenberg.
