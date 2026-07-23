export const SAVED_CARDS_DISABLED = true;

export function savedCardsDisabledResponse(
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify({
    success: false,
    error: 'saved_cards_disabled',
    message: 'Оплата сохранённой картой отключена. Используйте защищённую страницу оплаты.',
  }), {
    status: 410,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
