import { firstDocumentErrorCode } from '../../supabase/functions/_shared/document-generation-outcome';
import { readResponseLikeBody } from './normalizeEdgeFunctionError';

const messages: Record<string, string> = {
  unauthorized: 'Не удалось подтвердить доступ к документам. Обратитесь к владельцу доступа.',
  forbidden: 'Недостаточно прав для работы с документами.',
  owner_access_expired: 'Доступ владельца к генерации документов закончился.',
  link_not_found: 'Ссылка на анкету не найдена или отключена.',
  link_disabled: 'Ссылка на анкету отключена.',
  form_not_found: 'Анкета не найдена или отключена.',
  form_disabled: 'Анкета отключена.',
  token_required: 'Откройте анкету по полной ссылке владельца.',
  profile_not_found: 'Профиль для генерации документов не найден.',
  required_field_missing: 'Заполните все обязательные поля анкеты.',
  pf_required_value_missing: 'Для документа не заполнены обязательные сведения. Проверьте анкету пакета.',
  repeat_group_empty: 'Добавьте хотя бы одну строку расходов.',
  future_date: 'Дата не может быть позже сегодняшнего дня.',
  invalid_date: 'Проверьте формат даты в анкете.',
  invalid_number: 'Проверьте числовые значения в анкете.',
  invalid_attachment: 'Проверьте формат и размер приложенного файла.',
  too_many_attachments: 'Можно приложить не более 20 файлов.',
  attachments_disabled: 'Прикрепление файлов к этой анкете отключено.',
  attachment_path_forbidden: 'Не удалось подтвердить прикреплённый файл.',
  package_session_id_required: 'Сначала сохраните анкету пакета.',
  role_assignment_missing: 'В пакете не назначен участник обязательной роли. Обратитесь к владельцу пакета.',
  generation_blocked: 'Формирование заблокировано настройками пакета.',
  blocked: 'Формирование заблокировано настройками пакета.',
  invalid_token_in_package_template: 'В шаблоне документа есть неподдерживаемое поле. Обратитесь к администратору.',
  system_field_resolver_not_implemented: 'Одно из полей шаблона пока не поддерживается. Обратитесь к администратору.',
  active_version_invalid: 'Активная версия шаблона не прошла проверку.',
  template_or_version_missing: 'Не найден шаблон документа или его активная версия.',
  download_failed: 'Не удалось получить шаблон документа.',
  gotenberg_not_configured: 'Сервис формирования PDF не настроен.',
  gotenberg_disabled: 'Формирование PDF отключено.',
  gotenberg_auth_failed: 'Не удалось подключиться к сервису формирования PDF.',
  gotenberg_timeout: 'Превышено время ожидания формирования PDF.',
  gotenberg_unreachable: 'Сервис формирования PDF недоступен.',
  gotenberg_http_error: 'Сервис формирования PDF вернул ошибку.',
  pdf_conversion_failed: 'Не удалось сформировать PDF документа.',
  render_failed: 'Не удалось заполнить шаблон документа.',
  upload_failed: 'Не удалось сохранить файл документа.',
  delivery_format_not_selected: 'Не выбран формат отправки документа. Обратитесь к владельцу ссылки.',
  one_or_more_delivery_channels_failed: 'Документ сформирован, но отправка по одному из каналов не подтверждена.',
  generation_partial: 'Сформирована только часть документов. Проверьте результат у владельца пакета.',
  submission_save_failed: 'Не удалось подтвердить сохранение результата. Уточните статус у владельца ссылки, прежде чем отправлять анкету снова.',
  generation_outcome_unknown: 'Результат формирования пока неизвестен. Уточните статус у владельца доступа, прежде чем запускать его снова.',
  document_request_failed: 'Не удалось получить данные документов. Обновите страницу или обратитесь в поддержку.',
  generation_failed: 'Не удалось сформировать документ. Обратитесь к владельцу доступа или в поддержку.',
  internal_error: 'При обработке документа произошла ошибка. Обратитесь в поддержку.',
};

export function documentErrorMessage(code: string): string {
  return messages[code] ?? messages.generation_failed;
}

export class DocumentFunctionError extends Error {
  constructor(public readonly code: string, public readonly retryUnsafe = false) {
    super(documentErrorMessage(code));
    this.name = 'DocumentFunctionError';
  }
}

export async function documentFunctionError(
  error: unknown,
  body?: unknown,
  operation: 'read' | 'generate' | 'submit' | 'upload' | 'create_link' = 'generate',
): Promise<DocumentFunctionError> {
  if (error instanceof DocumentFunctionError) return error;
  const context = (error as { context?: unknown } | null)?.context;
  const payload = body ?? (context ? await readResponseLikeBody(context) : undefined);
  const code = firstDocumentErrorCode(payload) ?? firstDocumentErrorCode(error)
    ?? (operation === 'generate' || operation === 'submit' ? 'generation_outcome_unknown' : 'document_request_failed');
  const preflight = ['required_field_missing', 'repeat_group_empty', 'future_date',
    'invalid_date', 'invalid_number', 'invalid_attachment', 'too_many_attachments'];
  return new DocumentFunctionError(code, operation === 'submit' && !preflight.includes(code));
}

export function packageDocumentTotal(value: { total_documents?: number; total_items?: number; total?: number; generated?: number; errors?: number; blocked?: number; results?: unknown[] }): number {
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (valid(value.total_documents)) return value.total_documents;
  if (valid(value.total)) return value.total;
  const count = [value.generated, value.errors, value.blocked].reduce<number>((sum, n) => sum + (valid(n) ? n : 0), 0);
  return count || (Array.isArray(value.results) ? value.results.length : 0) || (valid(value.total_items) ? value.total_items : 0);
}
