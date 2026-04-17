# Карта функций «Конструктор сайтов» (Site Builder)

Discovery-артефакт. Источник истины для встроенной справки и пользовательской документации.

**Маршрут:** `/admin/site-pages` → редактор страницы.

## 1. Жизненный цикл страницы

| Функция | Где в UI | Для чего | Куда сохраняется | Где увидеть |
|---|---|---|---|---|
| Создать страницу | `/admin/site-pages` → «Новая страница» | Создаёт draft | `site_pages` (status=draft) | `/admin/site-pages` |
| Редактировать | Страница → «Редактировать» | Меняет блоки и настройки | `site_pages.blocks` (jsonb) | Превью |
| Превью | Кнопка «Превью» | Посмотреть до публикации | — | Правая панель `SitePreview` |
| Публикация | Кнопка «Опубликовать» | Делает страницу доступной по URL | `site_pages.status=published` | Привязанный домен/slug |
| Снятие с публикации | «Снять с публикации» | Скрыть страницу | `site_pages.status=draft` | — |

## 2. Настройки страницы (`SiteSettingsPanel.tsx`)

| Функция | Для чего | Куда сохраняется |
|---|---|---|
| Название | Внутреннее название | `site_pages.title` |
| Адрес (slug) | Часть URL после домена | `site_pages.slug` |
| SEO meta title / description / OG | Поисковики и соцсети | `site_pages.seo_settings` |
| Тема (цвет, шрифт) | Визуальные токены страницы | `site_pages.theme_settings` |
| Привязка доменов | Сделать страницу доступной по домену | `site_domain_bindings` |
| «Сделать главной» | Корень домена `/` ведёт на эту страницу | `site_domain_bindings.is_home` |
| Привязка продукта | Связать страницу с продуктом (1:1) | `site_pages.product_id` |

## 3. Операции с блоками (`SiteBlockEditor.tsx`)

| Функция | Где | Что делает |
|---|---|---|
| Добавить блок | «+ Добавить блок» (низ списка) | Добавляет в конец |
| Перетаскивание | Иконка ≡ слева | Меняет порядок (drag-n-drop) |
| Настройки блока | Иконка ⚙ в заголовке | Anchor, видимость, отступы, фон |
| Удалить блок | Иконка корзины | Безвозвратно |

## 4. Настройки блока (`BlockSettingsEditor.tsx`)

| Поле | Назначение |
|---|---|
| Якорь (anchor ID) | Стабильный id блока для прокрутки и `#anchor` в URL. Латиница, цифры, дефис. Уникален в пределах страницы. |
| Начальная видимость | `visible` или `hidden` (показывается через действие кнопки) |
| Отступы (px) | Сверху/снизу |
| Цвет фона / Цвет текста / Фоновое изображение | Локальное оформление блока |
| Максимальная ширина | sm/md/lg/xl/full |
| На всю ширину | Игнорировать max-width |
| Скрыть на мобильных / десктопе | Адаптивная видимость |

## 5. Типы блоков (27)

| Тип | Назначение | Ключевые поля |
|---|---|---|
| hero | Главный экран с CTA | title, subtitle, buttonText, buttonLink, background |
| text | Форматированный текст (HTML) | html |
| heading | Заголовок H1–H6 | text, level |
| image | Изображение | url, alt, width, linkUrl |
| features | Список преимуществ (сетка) | items, columns |
| cta | Призыв к действию | title, buttonText, buttonLink |
| faq | Аккордеон вопрос-ответ | items |
| divider | Разделитель | style, height |
| video | Видео (YouTube/Vimeo/Kinescope) | url, autoplay, aspectRatio |
| button | Отдельная кнопка с действием | text, action.type, action.target |
| columns | 2–4 колонки контента | items, columns, gap |
| timer | Таймер обратного отсчёта | targetDate |
| html | Произвольный HTML | code |
| gallery | Галерея картинок | items, columns |
| testimonials | Отзывы | items, columns |
| pricing | Тарифы продукта (продающий блок) | product_id |
| social | Иконки соцсетей | items |
| logos | Лента логотипов | items, logoHeight, grayscale |
| spacer | Пустой отступ | height |
| form | Форма заявки | title, fields[], auth_mode, product/tariff/pipeline binding |
| accordion | Аккордеон | items, allowMultiple |
| tabs | Вкладки | tabs[] |
| callout | Цветная выноска | type, content |
| quote | Цитата | text, author |
| audio | Аудио-плеер | url, title |
| embed | Встраивание iframe | url, height |
| **site_questionnaire** | Анкета на базе движка обучения | lessonId, title, subtitle |

## 6. Якоря и действия кнопок (Phase 2 / PATCH A-C)

| Действие кнопки | Цель | Что делает |
|---|---|---|
| Ссылка (URL) | https://… | Открывает URL |
| Прокрутить к якорю | anchorId блока | Плавный scroll до блока |
| Показать блок | blockId | Делает блок видимым |
| Переключить видимость | blockId | Toggle hidden/visible |
| Открыть форму | blockId формы | Открывает форму как popup/scroll |

Цели хранятся как **stable IDs** (anchorId или blockId), не названия.

## 7. Формы и embed (Phase 2 / PATCH D)

| Сценарий | Где находится | Куда сохраняются данные | Где смотреть |
|---|---|---|---|
| Форма на странице сайта | Блок «Форма» | `site_form_submissions` (через edge `site-form-submit`) | `/admin/forms` (вкладка «Анкеты и заявки»), карточка контакта |
| Embed inline | Кнопка «Получить embed-код» → вкладка Inline | то же | то же + `metadata.embed_origin` |
| Embed popup | то же → вкладка Popup | то же | то же + `metadata.embed_mode = popup` |

Edge: `site-form-submit` (canonical, единственный путь).
Embed runtime: `public/embed/form.js`, маршрут iframe `/embed/form/:pageId/:blockId`.

## 8. Анкеты / опросы (Phase 2 / PATCH E)

| Аспект | Деталь |
|---|---|
| Движок | Тот же `lesson_blocks` + `user_lesson_progress` (reuse, не новый engine) |
| Хранилище уроков-анкет | Служебный `training_modules` со slug `__site_questionnaires__` |
| Создание | «+ Создать новую» в редакторе блока — открывает canonical lesson editor в новой вкладке |
| Редактирование вопросов | `/admin/training-lessons/:moduleId/edit/:lessonId` (canonical editor) |
| Политика повторного прохождения | **Overwrite** — обновляет существующий ответ (UNIQUE по user/lesson/block) |
| Где смотреть результаты | `/admin/forms` (источник «Анкета сайта»), карточка контакта (вкладка «Анкеты и обучение»), detail viewer = существующий `StudentProgressModal` |

## 9. Pricing / привязка продукта

| Функция | Поведение |
|---|---|
| Привязка `site_pages.product_id` | 1:1 связь страница↔продукт |
| Pricing-блок в product-driven режиме | Берёт тарифы из привязанного продукта |
| Manual режим | Тарифы задаются вручную |
| CTA → checkout | Канонический `/checkout` через резолвер тарифа |

## 10. Куда попадают данные (общая карта)

| Источник | Таблица | UI: список | UI: detail viewer | Карточка контакта |
|---|---|---|---|---|
| Обычная форма сайта | `site_form_submissions` | `/admin/forms` (источник «Форма сайта») | модалка submission | вкладка «Анкеты и заявки» |
| Embed-форма | то же + `metadata.embed_*` | то же | то же | то же |
| Анкета сайта | `user_lesson_progress` (модуль `__site_questionnaires__`) | `/admin/forms` (источник «Анкета сайта») | `StudentProgressModal` | вкладка «Анкеты и обучение» |
| Прогресс обучения | `user_lesson_progress` (обычные модули) | `/admin/forms` (источник «Обучение») | `StudentProgressModal` | вкладка «Анкеты и обучение» |
| Заявка с созданием сделки | + `crm_deals` | + `/admin/crm/deals` | карточка сделки | вкладка «Сделки» |
