СПРИНТ: AdminLessonProgress — починить отображение учеников + добавить ContactDetailSheet

ЦЕЛЬ:
1) Исправить привязку профилей к lesson_progress_state.user_id (auth.users.id).
2) На клике по имени ученика открывать ContactDetailSheet справа, без перезагрузки страницы.
3) Сохранить текущую модалку StudentProgressModal (“Просмотр”) без регрессий.

---------------------------------------
PATCH-1 (BLOCKER): Исправить JOIN profiles по user_id
---------------------------------------
ПРОБЛЕМА:
lesson_progress_state.user_id = auth.users.id
а profiles связаны через profiles.user_id, не profiles.id.

Файл: src/pages/admin/AdminLessonProgress.tsx

ИЗМЕНЕНИЯ:
1) Запрос профилей:
БЫЛО:
.from("profiles").select("id, email, full_name").in("id", userIds)

СТАЛО:
.from("profiles").select("id, user_id, email, full_name").in("user_id", userIds)

2) Map для быстрого доступа:
БЫЛО:
new Map(profiles?.map(p => [p.id, p]) || [])

СТАЛО:
new Map(profiles?.map(p => [p.user_id, p]) || [])

STOP-GUARD:
- userIds пустой → profiles запрос не выполнять, profileMap = empty Map.

DoD:
- В таблице прогресса появляются full_name и email для всех учеников, где есть profiles.user_id.

---------------------------------------
PATCH-2 (BLOCKER): ContactDetailSheet — открыть справа по клику на имя ученика
---------------------------------------
ВАЖНО: В системе “контакт” может быть НЕ равен “profile”.
Поэтому делаем открытие ContactDetailSheet через корректный идентификатор контакта, без угадываний.

Dry-run (обязательный):
A) Найти, что ожидает ContactDetailSheet:
- props: contactId? contact? profile? (посмотреть компонент)
B) Найти, где хранится связь profile → contact:
- возможные поля: profiles.contact_id / profiles.amo_contact_id / profiles.email match contacts.email
- если прямой связи нет — используем безопасный fallback: открывать Sheet по profile.user_id, но внутри Sheet показывать профильные данные (минимально), и пометить как “нет связанного контакта”.

Файл: src/pages/admin/AdminLessonProgress.tsx

ИЗМЕНЕНИЯ (универсальный безопасный вариант):
1) Импорт:
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";

2) State:
const [contactSheetOpen, setContactSheetOpen] = useState(false);
const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
const [selectedProfile, setSelectedProfile] = useState<any>(null); // только для fallback UI/поиска

3) Функция открытия:
const openContactSheet = async (profile: { id: string; user_id: string; email?: string | null }) => {
  // НЕ логировать email. Только технические статусы.
  setSelectedProfile(profile);

  // Step 1: попытаться найти contact_id прямой связью (если поле существует)
  // - если в проекте есть profiles.contact_id → используем его
  // - иначе (add-only) аккуратно ищем контакт по email (если это допустимо в вашей модели)
  // - если контакт не найден → fallback: открыть sheet в режиме “нет контакта”
  
  // Псевдокод (конкретику выбрать после dry-run структуры таблиц):
  // 1) if (profile.contact_id) { setSelectedContactId(profile.contact_id); setContactSheetOpen(true); return; }
  // 2) else if (profile.email) { find in contacts by email (eq). if found -> open. }
  // 3) else { setSelectedContactId(null); setContactSheetOpen(true); }

  setContactSheetOpen(true);
};

4) Сделать имя кликабельным:
- В ячейке ученика заменить текст на button:
<button
  className="font-medium text-left hover:underline hover:text-primary"
  onClick={() => profile && openContactSheet(profile)}
>
  {profile?.full_name || "—"}
</button>

5) Рендер ContactDetailSheet (внизу компонента):
ВАРИАНТ A (если sheet принимает contactId):
<ContactDetailSheet
  contactId={selectedContactId}
  open={contactSheetOpen}
  onOpenChange={setContactSheetOpen}
  fallbackProfile={selectedProfile}   // add-only prop ТОЛЬКО если нужно и компонент позволяет
/>

ВАРИАНТ B (если sheet принимает contact объект):
- загрузить contact объект перед open (но без PII логов), и передавать contact={selectedContact}

STOP-GUARDS:
- Если контакт не найден → Sheet всё равно открывается, но показывает “Контакт не найден / не связан”, и кнопку “Открыть профиль” (если такая логика у вас есть) либо просто информацию профиля (имя/email) без падения.
- Не менять существующую логику “Просмотр” (StudentProgressModal).

DoD:
- Клик по имени ученика открывает правый ContactDetailSheet без перезагрузки.
- Если контакт связан — видны данные контакта/сделки/платежи (как в других местах).
- Если контакт не связан — виден корректный fallback, без краша.

---------------------------------------
PATCH-3 (NON-BLOCKER): Сохранить модалку “Просмотр” как есть
---------------------------------------
Файл: src/pages/admin/AdminLessonProgress.tsx
Проверить, что кнопка “Просмотр” продолжает открывать StudentProgressModal и не зависит от ContactDetailSheet state.

DoD:
- “Просмотр” работает как раньше.

---------------------------------------
ФАЙЛЫ ДЛЯ ИЗМЕНЕНИЯ
---------------------------------------
1) src/pages/admin/AdminLessonProgress.tsx
(+ возможно add-only расширение ContactDetailSheet только если по dry-run выяснится, что без этого нельзя показать fallback)

---------------------------------------
ТЕСТ-КЕЙСЫ / DoD
---------------------------------------
A) Прогресс работает
1) /admin/training-modules → вкладка “Прогресс” → открыть урок
2) Таблица учеников показывает full_name + email (где есть profiles.user_id)

B) ContactDetailSheet
1) Клик по имени ученика → открывается правый sheet
2) Страница не перезагружается
3) “Просмотр” по-прежнему открывает модалку ответов

C) Безопасность
- В консоли/логах нет email/телефонов/ответов
- Только тех. статусы/счётчики