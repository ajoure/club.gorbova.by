
# План: Очистка и унификация payments_v2 за 2025 год

## Текущее состояние

### Данные корректны ✅
- **3328 записей** за 2025 год
- **0 дубликатов** (все UID уникальны)
- **3 записи** из эталона не синхронизированы (май и август)
- **100% записей** из payments_v2 присутствуют в эталоне

### Структура по origin (что можно упростить)
| Origin | Записей | Описание |
|--------|---------|----------|
| `bepaid` | 2341 | Из webhook (основные) |
| `statement_sync` | 906 | Из синхронизации (сентябрь-декабрь) |
| `import` | 81 | Старый ручной импорт ← **можно удалить** |

---

## Задачи

### 1. Удалить старые записи с origin='import' (81 шт.)
Эти записи дублируют данные, которые уже есть с origin='bepaid'.

**SQL:**
```sql
DELETE FROM payments_v2 
WHERE provider = 'bepaid' 
  AND origin = 'import'
  AND paid_at >= '2025-01-01' AND paid_at < '2026-01-01';
```

### 2. Досинхронизировать 3 недостающие записи
Добавить 3 записи из эталона, которых нет в payments_v2:
- `ec734e84-963d-40cc-95d8-a12a8b6dc1e5` (02.05.2025, 150 BYN)
- `ef98a726-b234-47e7-9dec-780e0c55b158` (01.05.2025, 250 BYN)
- `0b05964e-0972-4b53-bd64-f88d9d4ba2b3` (31.08.2025, 250 BYN)

### 3. Audit log
Записать в audit_logs действие очистки с counts.

---

## Ожидаемый результат

| Показатель | До | После |
|------------|-----|-------|
| Всего записей 2025 | 3328 | 3250 (−81 import +3 missing) |
| origin='import' | 81 | 0 |
| Совпадение с эталоном | 3328/3331 | 3250/3331 ≈ 97.6% |

---

## ВАЖНО: Проверка связей перед удалением

Прежде чем удалять 81 запись с `origin='import'`, нужно убедиться, что их связи (profile_id) сохранятся в записях с `origin='bepaid'`.

**Логика:**
1. Для каждой записи import найти соответствующую запись bepaid (по UID)
2. Если у bepaid нет profile_id, а у import есть — перенести
3. Только потом удалять import

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| Новая миграция SQL | Скрипт очистки с проверкой связей |
| Audit log | Запись о выполненной операции |

---

## DoD-пруфы

### DoD-1: origin='import' удалён
```sql
SELECT COUNT(*) FROM payments_v2 
WHERE provider='bepaid' AND origin='import' AND paid_at >= '2025-01-01' AND paid_at < '2026-01-01';
-- Ожидаем: 0
```

### DoD-2: 3 недостающие записи добавлены
```sql
SELECT COUNT(*) FROM payments_v2 
WHERE provider_payment_id IN (
  'ec734e84-963d-40cc-95d8-a12a8b6dc1e5',
  'ef98a726-b234-47e7-9dec-780e0c55b158',
  '0b05964e-0972-4b53-bd64-f88d9d4ba2b3'
);
-- Ожидаем: 3
```

### DoD-3: profile_id не потерян
```sql
SELECT COUNT(profile_id) FROM payments_v2 
WHERE provider='bepaid' AND paid_at >= '2025-01-01' AND paid_at < '2026-01-01';
-- Должно быть ≥ 2000 (как до очистки)
```

### DoD-4: Audit log
```sql
SELECT * FROM audit_logs 
WHERE action = 'payments.cleanup_2025_import' 
ORDER BY created_at DESC LIMIT 1;
-- Должна быть запись с counts
```
