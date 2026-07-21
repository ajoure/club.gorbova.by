# Отчет о выполненной работе: ledger proof

Баланс — сумма append-only entries по buckets `pending`, `available`, `held`, `paid`. UPDATE/DELETE блокируются триггером. Все суммы — minor units BYN. SQL contract test проверяет отсутствие клиентских write privileges.
