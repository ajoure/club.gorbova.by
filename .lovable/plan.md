

# План: Добавить URL кнопки в быструю рассылку + кнопка "Тест себе"

## Найденные проблемы

### Проблема 1: Отсутствует поле URL кнопки
**Файл:** `src/components/admin/communication/BroadcastsTabContent.tsx`

В "Быстрой рассылке" (строки 571-580):
- ✅ Есть: `buttonText` (текст кнопки)
- ❌ Нет: `buttonUrl` (ссылка кнопки)

Кнопка без URL — бесполезна. Edge function `telegram-mass-broadcast` ожидает параметр `button_url`, но он не передаётся.

### Проблема 2: Нет кнопки "Тест себе"
Администратор не может проверить сообщение перед отправкой всей аудитории.

---

## Изменения

### PATCH-1: Добавить state для buttonUrl

**Файл:** `src/components/admin/communication/BroadcastsTabContent.tsx`

Строка ~98-99:
```typescript
const [buttonText, setButtonText] = useState("Открыть платформу");
const [buttonUrl, setButtonUrl] = useState("https://club.gorbova.by/products");  // ДОБАВИТЬ
```

### PATCH-2: Добавить поле ввода URL

После "Текст кнопки" (строка 578) добавить:
```typescript
{includeButton && (
  <div className="space-y-2 pl-4 border-l-2 border-muted">
    <Label>Текст кнопки</Label>
    <Input
      value={buttonText}
      onChange={(e) => setButtonText(e.target.value)}
      placeholder="Открыть платформу"
    />
    <Label>URL кнопки</Label>       {/* ДОБАВИТЬ */}
    <Input                          {/* ДОБАВИТЬ */}
      value={buttonUrl}
      onChange={(e) => setButtonUrl(e.target.value)}
      placeholder="https://club.gorbova.by/products"
    />
  </div>
)}
```

### PATCH-3: Передать buttonUrl в mutation

Строки 256-259 и 287-289 — добавить `button_url`:
```typescript
// FormData вариант
formData.append("button_url", buttonUrl);  // ДОБАВИТЬ

// JSON вариант
body: {
  message: message.trim(),
  include_button: includeButton,
  button_text: includeButton ? buttonText : undefined,
  button_url: includeButton ? buttonUrl : undefined,  // ДОБАВИТЬ
  filters,
}
```

### PATCH-4: Добавить кнопку "Тест себе"

Рядом с кнопкой "Отправить" добавить вторую кнопку:
```typescript
// Новая мутация для теста
const sendTestMutation = useMutation({
  mutationFn: async () => {
    // Получить ID первого активного бота
    const { data: bots } = await supabase
      .from("telegram_bots")
      .select("id")
      .eq("is_active", true)
      .limit(1);
    
    if (!bots?.length) throw new Error("Нет активного бота");
    
    const { data, error } = await supabase.functions.invoke("telegram-send-test", {
      body: {
        botId: bots[0].id,
        messageText: message.trim(),
        buttonText: includeButton ? buttonText : undefined,
        buttonUrl: includeButton ? buttonUrl : undefined,
      },
    });
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    toast.success("Тестовое сообщение отправлено вам в Telegram");
  },
  onError: (error) => {
    toast.error("Ошибка: " + (error as Error).message);
  },
});
```

UI — добавить кнопку перед "Отправить":
```typescript
<div className="flex gap-2">
  <Button
    variant="outline"
    onClick={() => sendTestMutation.mutate()}
    disabled={!message.trim() || sendTestMutation.isPending}
  >
    {sendTestMutation.isPending ? (
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
    ) : (
      <Send className="h-4 w-4 mr-2" />
    )}
    🧪 Тест себе
  </Button>
  
  <Button size="lg" className="flex-1 gap-2" onClick={handleSend} disabled={isSendDisabled}>
    ...
  </Button>
</div>
```

---

## Файлы для изменения

| Файл | Изменение |
|------|-----------|
| `src/components/admin/communication/BroadcastsTabContent.tsx` | Добавить buttonUrl state, поле ввода, передачу в mutation, кнопку "Тест себе" |

---

## DoD

1. В "Быстрой рассылке" видно поле "URL кнопки"
2. При включённой кнопке и заполненном URL — сообщение уходит с рабочей inline-кнопкой
3. Кнопка "Тест себе" отправляет тестовое сообщение администратору в Telegram
4. Основная кнопка "Отправить" работает как раньше

