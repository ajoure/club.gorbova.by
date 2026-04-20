# Финальный regression checklist — Sprint 1 + 2 + 3

## Lifecycle
1. [ ] `closed → opened → live → completed` через 3 кнопки в админке
2. [ ] Кнопка «Завершить вебинар» в комнате (только staff, только state=live)
3. [ ] `opened → live` без сброса scroll/chat/questions/session
4. [ ] Save формы не меняет lifecycle-state
5. [ ] Lifecycle-action не перетирает theme/CTA/settings

## Waiting-state
6. [ ] Пользователь заходит в `opened`, видит чат/вопросы/CTA/тему, плеера нет
7. [ ] Heartbeat/session tracking работают в waiting-state
8. [ ] Participant count считается в waiting-state

## Chat / Questions / Replies
9. [ ] Отправка сообщений и вопросов
10. [ ] Realtime обновления (новые сообщения появляются без перезагрузки)
11. [ ] Threaded reply (ответ на конкретное сообщение/вопрос)
12. [ ] Длинный текст: переносы, читабельность, скролл

## Moderation (2 окна)
13. [ ] Mute/unmute пользователя — проверить в 2 вкладках
14. [ ] Remove/restore пользователя — проверить в 2 вкладках
15. [ ] Баннер модерации отображается у заглушенного/удалённого пользователя

## CTA
16. [ ] CTA visibility: always / after_minutes / manual / at_datetime
17. [ ] CTA на mobile не перекрывает sticky input
18. [ ] Empty-state без CTA — нет пустых контейнеров

## Theme
19. [ ] 8 CSS-переменных применяются: header, чат, вопросы, textarea, табы, CTA, waiting, replay
20. [ ] Тема не протекает за пределы `.live-room-themed`
21. [ ] Без установленной темы — дефолтные цвета из shadcn

## Participant count v1
22. [ ] Badge с числом участников в header комнаты
23. [ ] Tooltip: «Активные участники за последние 2 минуты»

## Role colors / hierarchy
24. [ ] 5 типов сообщений: user / own / admin / employee / presenter
25. [ ] Reply-quote визуально отличим
26. [ ] Приоритет: presenter > admin > employee > own > user

## Mobile regression
27. [ ] Sticky input не перекрывается клавиатурой
28. [ ] Длинные сообщения и вопросы — переносы, скролл
29. [ ] Sidebar скролл не конфликтует с основным скроллом
30. [ ] Safe-area (нижние отступы) — Comments и Questions

## Button sync / save
31. [ ] Button sync во время live-save (Sprint 2 deferred)
32. [ ] Save формы через админку — lifecycle не сбрасывается

## Navigation
33. [ ] Back/forward navigation room ↔ list ↔ edit
34. [ ] Background return / reload — нет ре-маунта плеера и чата

## Replay
35. [ ] Replay-state: тема применена, плеер работает
36. [ ] Completed без replay: «Эфир завершён» (без плеера)
37. [ ] Completed с replay: «Запись доступна»

## Provider degraded-mode
38. [ ] Kinescope упал → lifecycle перешёл → audit с `degraded:true`
39. [ ] UI-результат degraded-mode: комната переключилась, уведомление показано

---

**Статус:** Готов к ручной проверке после Sprint 3.
