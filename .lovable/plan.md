

## PATCH CONTACT-SHEET-UI.2 — Ширина 60% + полный ID подписки + навигация в BePaid

### Изменения — 3 файла

---

### 1) Ширина карточки: 75vw → 60vw

**Файлы:**
- `src/components/admin/ContactDetailSheet.tsx` (строка 1341)
- `src/components/admin/DealDetailSheet.tsx` (строка 450)

Заменить `sm:max-w-[75vw] lg:max-w-4xl` → `sm:max-w-[60vw] lg:max-w-3xl`

---

### 2) Полный ID подписки BePaid + ссылка-навигация

**Файл:** `src/components/admin/ContactDetailSheet.tsx` (строки 1793-1794)

Сейчас:
```tsx
<p className="text-xs text-muted-foreground">
  ID: {sub.provider_subscription_id?.slice(0, 12)}...
</p>
```

Заменить на:
```tsx
<a
  href={`/admin/payments/bepaid-subscriptions?search=${sub.provider_subscription_id}`}
  onClick={(e) => {
    e.preventDefault();
    navigate(`/admin/payments/bepaid-subscriptions?search=${sub.provider_subscription_id}`);
  }}
  className="text-xs text-blue-600 hover:underline cursor-pointer break-all"
>
  ID: {sub.provider_subscription_id}
</a>
```

- Показываем полный ID (убираем `.slice(0, 12)`)
- Клик → навигация на `/admin/payments/bepaid-subscriptions?search=sbs_xxxxx`
- Страница BePaid-подписок подхватит `?search=` и покажет отфильтрованный результат

Нужно убедиться, что `navigate` из `react-router-dom` доступен в компоненте (проверю наличие `useNavigate`).

---

### Итого

| Файл | Что меняем |
|------|-----------|
| ContactDetailSheet.tsx | Ширина 60vw, полный ID, ссылка-навигация |
| DealDetailSheet.tsx | Ширина 60vw |

### DoD
- Карточки контакта и сделки ~60% ширины экрана
- ID подписки BePaid показан полностью, без обрезки
- Клик по ID переходит на страницу BePaid-подписок с фильтром по этому ID

