

## План: фильтр «Бан-лист» в шестерёнке + внесение 9 контактов в бан-лист

---

### Данные из файла — все 9 контактов НАЙДЕНЫ в базе

| Email | Имя | profile_id | Статус сейчас |
|-------|-----|-----------|---------------|
| sestra73@mail.ru | Ольга Леонидовна | 3e56970f-... | imported |
| lenka_pinsk@mail.ru | Елена Ильючик | fa62d1ef-... | imported |
| dasha.burmakina@gmail.com | Дарья Протопопова | fac1c317-... | imported |
| natalya.akulich78@gmail.com | Наталья Акулич | ba3397c7-... | imported |
| elisabeth.mordik@gmail.com | Елизавета | 54c8ba0b-... | imported |
| olgaapavlichenko@mail.ru | Ольга | 746db201-... | imported |
| kekushova@yandex.ru | Ксения | 7fa29b25-... | imported |
| nikita.rogovski.03@gmail.com | Никита Роговский | face2fde-... | imported |
| ksukam@mail.ru | Оксана Грищенко | e98919df-... | imported |

Для каждого профиля будут использоваться существующие данные: **email**, **phone**, **telegram_username**, **telegram_user_id** (где заполнены). Все данные уже есть в profiles — создавать новые профили не нужно.

---

### 1. Фильтр «Бан-лист» в gear-меню

**Файл:** `src/pages/admin/AdminContacts.tsx`

**1.1** Добавить пресет `"banned"` в серверные фильтры (строка ~506):
```
} else if (activePreset === "banned") {
  query = query.eq("status", "banned");
}
```

**1.2** В gear-меню (строка ~1318) рядом с «Архивные / удалённые» добавить:
```
<DropdownMenuItem onClick={() => handleTabChange("banned")}>
  <Ban className="h-4 w-4 mr-2" />
  Бан-лист ({bannedCount})
</DropdownMenuItem>
```

**1.3** Pill-badge при активном пресете `"banned"` — аналогично архивному (красный pill с крестиком):
```
{activePreset === "banned" && (
  <button className="... bg-destructive/20 text-destructive ..."
    onClick={() => handleTabChange("active")}>
    <Ban /> Бан-лист ({bannedCount}) <XCircle />
  </button>
)}
```

**1.4** Обновить `get_contact_tab_counts` — добавить ключ `banned`:
```sql
'banned', (select count(*) from prof where status = 'banned')
```

**1.5** Импорт `Ban` из lucide-react.

---

### 2. Внесение 9 контактов в бан-лист

Для каждого из 9 профилей:
1. Вызвать edge-функцию `ban-list-manage` с `action: "add"`, передав `profileId`
2. Это создаст `ban_case`, заполнит `ban_identifiers` всеми имеющимися данными (email, phone, tg), выставит `profiles.status = 'banned'`

Причина бана: «Импорт бан-листа от администратора (03.03.2026)»

---

### Список файлов

| Файл | Что |
|------|-----|
| `src/pages/admin/AdminContacts.tsx` | Пресет "banned", gear-menu пункт, pill-badge |
| SQL-миграция | `get_contact_tab_counts` — добавить `banned` count |
| Data operation | 9 профилей → `status='banned'` + `ban_cases` + `ban_identifiers` через edge-функцию |

