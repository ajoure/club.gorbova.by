
# План исправления: Build-ошибка TypeScript + Бесконечная перезагрузка на мобильном

## Проблемы обнаружены

### Проблема 1: Ошибки сборки TypeScript в AdminKbImport.tsx
Тип поля `timecode` в интерфейсе `ParsedRow` указан как `string | number`, но ExcelJS возвращает также `Date` объекты. Это несовместимость типов на строках 221 и 286.

**Текущий код (строка 60):**
```typescript
interface ParsedRow {
  ...
  timecode: string | number;  // ❌ Не включает Date
  ...
}
```

**Проблемные строки:**
- Строка 221: `const episodeNumber = parseEpisodeNumber(episodeRaw);` — передача `Date` в функцию, ожидающую `string | number`
- Строка 286: `timecode: timecodeRaw` — присвоение `Date` в поле типа `string | number`

### Проблема 2: Бесконечная перезагрузка на мобильном Safari
В `ProtectedRoute.tsx` (строки 34-45) есть логика retry, которая при определённых условиях вызывает `window.location.reload()`:

```typescript
if (!loading && !isInitializing && !user && retryCount < 2) {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      window.location.reload();  // ❌ ЦИКЛ!
    }
  });
  setRetryCount(prev => prev + 1);
}
```

**Причина цикла:** На мобильном Safari задержка 1500ms недостаточна. Если сессия восстанавливается после этого таймаута, `retryCount` сбрасывается при каждой перезагрузке, и цикл повторяется бесконечно.

---

## Исправления

### 1. Исправление типов в AdminKbImport.tsx

**Файл:** `src/pages/admin/AdminKbImport.tsx`

**Изменение интерфейса ParsedRow (строка 60):**
```typescript
timecode: string | number | Date;  // ✅ Добавляем Date
```

Это соответствует тому, что ExcelJS может возвращать объект `Date` для ячеек с датами/временем.

### 2. Исправление бесконечной перезагрузки в ProtectedRoute.tsx

**Файл:** `src/components/layout/ProtectedRoute.tsx`

**Проблема:** `retryCount` сбрасывается при каждой перезагрузке страницы, т.к. это состояние React. Нужно использовать `sessionStorage` для персистентности между перезагрузками.

**Новая логика (строки 16-45):**
```typescript
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();
  
  const [isInitializing, setIsInitializing] = useState(true);
  
  // Защита от бесконечного цикла перезагрузок
  const RELOAD_KEY = 'protected_route_reload_count';
  const MAX_RELOADS = 2;
  
  useEffect(() => {
    const isMobileSafari = /iPhone|iPad|iPod/.test(navigator.userAgent) && 
                           /Safari/.test(navigator.userAgent) &&
                           !/Chrome/.test(navigator.userAgent);
    
    // Увеличиваем задержку для мобильного Safari до 2500ms
    const delay = isMobileSafari ? 2500 : 800;
    
    const timer = setTimeout(() => setIsInitializing(false), delay);
    return () => clearTimeout(timer);
  }, []);

  // Улучшенная retry-логика с защитой от цикла
  useEffect(() => {
    if (!loading && !isInitializing && !user) {
      const reloadCount = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10);
      
      if (reloadCount < MAX_RELOADS) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            sessionStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
            window.location.reload();
          }
        });
      }
      // Если MAX_RELOADS достигнут — просто редиректим на /auth
    }
  }, [loading, isInitializing, user]);

  // Очищаем счётчик при успешной авторизации
  useEffect(() => {
    if (user) {
      sessionStorage.removeItem(RELOAD_KEY);
    }
  }, [user]);

  // ... остальной код без изменений
}
```

---

## Итог изменений

| Файл | Изменение |
|------|-----------|
| `src/pages/admin/AdminKbImport.tsx` | Тип `timecode` расширен до `string \| number \| Date` |
| `src/components/layout/ProtectedRoute.tsx` | Защита от цикла через `sessionStorage`, увеличена задержка для мобильного Safari |

## Ожидаемый результат

- Build-ошибки TypeScript исправлены
- Мобильный Safari: максимум 2 перезагрузки, после чего редирект на `/auth`
- Задержка для мобильного Safari увеличена с 1500ms до 2500ms для более надёжного восстановления сессии

---

## Техническая секция

### Почему sessionStorage, а не localStorage?

`sessionStorage` очищается при закрытии вкладки, что предотвращает накопление счётчика между сессиями. Это безопаснее для UX — пользователь может просто перезапустить браузер для сброса.

### Почему увеличена задержка?

Согласно Memory `auth/session-and-route-restoration-mobile`, мобильный Safari требует больше времени для восстановления сессии из-за особенностей работы с IndexedDB и cookie. 2500ms даёт больше запаса.
