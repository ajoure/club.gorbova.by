# План: переиспользование CRM-контакта

| Потребность | Канонический объект | Решение |
|---|---|---|
| Партнёр | `profiles.id` | Расширение через `referral_partners.profile_id`, без новой CRM |
| Вход в кабинет | `profiles.user_id` | Nullable; ghost-profile виден админу, но кабинет недоступен до приглашения |
| Публичный ID | Не подтверждён у `profiles` | Не показывать UUID; использовать public ID партнёра |
| Дубли | `duplicate_group_id`, `merged_to_profile_id`, `primary_in_group` | Привязка только к primary profile; merge-поведение подтвердить live |
| Карточка | `ContactDetailSheet` | Новый `ContactReferralsTab`, отдельные query keys |
| Realtime | Канал карточки уже слушает orders/subscriptions/payments | Добавить инвалидирование referral projections после появления таблиц |

Existing contact: автоматическая ретроатрибуция запрещена; ручная — только RPC, permission, причина, audit/event.
