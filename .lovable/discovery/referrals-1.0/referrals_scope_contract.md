# План: scope contract

Generated types не показывают `workspace_id`/`tenant_id` у `profiles`, `products_v2`, `orders_v2`, `payments_v2`. Предварительное заключение — global single-tenant, но оно **не заморожено** без production catalogs. Новые таблицы не должны самовольно добавлять scope-column.
