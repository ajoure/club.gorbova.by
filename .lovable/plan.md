# План: Единый "Мастер добавления контента" для всех разделов меню

## ✅ ВЫПОЛНЕНО

### Создано:
- `src/components/admin/trainings/UniversalLessonFormFields.tsx` — универсальный компонент формы урока

### Изменено:
- `src/components/admin/trainings/LessonFormFieldsSimple.tsx` — расширен интерфейс `LessonFormDataSimple` с полями даты/времени/вопросов
- `src/components/admin/trainings/ContentCreationWizard.tsx`:
  - Интегрирована универсальная форма на шаге 3 (lesson flow)
  - Обновлена логика создания урока для всех разделов (published_at, video blocks, questions)

### Результат:
| # | Проверка | Статус |
|---|----------|--------|
| 1 | Мастер из не-KB раздела показывает "Название урока *" | ✅ |
| 2 | Мастер из KB раздела показывает "Номер выпуска *" | ✅ |
| 3 | Общие поля (дата/время/kinescope/вопросы) работают везде | ✅ |
| 4 | Урок с видео и вопросами создаётся в любом разделе | ✅ |

