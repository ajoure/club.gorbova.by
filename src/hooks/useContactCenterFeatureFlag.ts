/**
 * Единая лента контакт-центра опубликована для всех сотрудников, которым уже
 * разрешён доступ к /admin/communication.
 *
 * Раньше включение хранилось в localStorage конкретного браузера. Из-за этого
 * один сотрудник видел новую ленту, а другой после входа или перезагрузки —
 * старую. Frontend-флаг больше не является механизмом доступа: авторизация и
 * права по-прежнему проверяются маршрутом, RPC и RLS.
 *
 * Откат выполняется обычным revert этого изолированного rollout-коммита. Это
 * не требует изменения production-данных и не оставляет браузеры сотрудников
 * в разных состояниях.
 */
export type UnifiedInboxFlagSource = "global-rollout";

export interface UnifiedInboxRolloutStatus {
  enabled: true;
  source: UnifiedInboxFlagSource;
  isLoading: false;
}

export function useUnifiedInboxRolloutStatus(): UnifiedInboxRolloutStatus {
  return {
    enabled: true,
    source: "global-rollout",
    isLoading: false,
  };
}

/**
 * Совместимость с существующими подписчиками realtime и страницей
 * контакт-центра. Второй элемент tuple сохранён до отдельного cleanup, но
 * персонально выключить глобально опубликованную ленту больше нельзя.
 */
const keepGlobalRolloutEnabled = () => undefined;

export function useUnifiedInboxFlag(): [true, (next: boolean) => void] {
  return [true, keepGlobalRolloutEnabled];
}
