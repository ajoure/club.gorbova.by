export const CB2_PRODUCT_ID = '87a8870f-d426-419a-9f15-faa76c3f2be3';
export interface Cb2AccessWindow {
  has_access: boolean;
  effective_end_at: string | null;
  source_kind: 'purchase' | 'club_bonus' | 'manual' | 'paid_source' | null;
  club_bonus_end_at: string | null;
}
export const cb2AccessSourceLabel = (source: Cb2AccessWindow['source_kind']) => ({
  purchase: 'Покупка курса', club_bonus: 'Бонус клуба', manual: 'Ручной доступ', paid_source: 'Оплаченный доступ',
}[source || 'purchase']);
