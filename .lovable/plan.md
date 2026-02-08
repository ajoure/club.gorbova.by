================================================================================
PATCH P0.9.2 — ВЫПОЛНЕН ✅ (2026-02-08)
================================================================================

## SQL-пруфы:

### DoD-1: Pravo.by выключен
```
name: Pravo.by - Нац. реестр
is_active: false ✅
url: https://pravo.by
```

### DoD-2: proxy_mode = enhanced у 6 источников
```
КГК РБ:                     proxy_mode=enhanced, last_error_code=NULL ✅
Минтруд России:             proxy_mode=enhanced, last_error_code=NULL ✅
Минцифры России:            proxy_mode=enhanced, last_error_code=NULL ✅
Минэкономразвития России:   proxy_mode=enhanced, last_error_code=NULL ✅
ФАС России:                 proxy_mode=enhanced, last_error_code=NULL ✅
ФТС России:                 proxy_mode=enhanced, last_error_code=NULL ✅
```

## Что сделано:

1. **P0.9.2-1**: Pravo.by - Нац. реестр → is_active = false
2. **P0.9.2-2**: 6 источников с 408 → proxy_mode = "enhanced" (jsonb_set)
3. **P0.9.2-3**: Очистка ошибок только для 408/timeout (с условием)
4. **P0.9.2-4**: Очистка ошибок для отключённого Pravo.by

## Следующий шаг:

После запуска monitor-news проверить audit_logs:

```sql
SELECT
  meta->>'source_name' AS source_name,
  meta->>'status_code' AS status_code,
  meta->>'error_class' AS error_class
FROM audit_logs
WHERE action = 'news_scrape_attempt'
  AND meta->>'source_name' IN (
    'КГК РБ','Минтруд России','Минцифры России',
    'Минэкономразвития России','ФАС России','ФТС России'
  )
ORDER BY created_at DESC LIMIT 30;
```

================================================================================
