/**
 * Shared helper for generating Telegram club invite links.
 * 
 * Used by: telegram-grant-access, subscription-charge (renewal notification).
 * Single source for club selection, link generation, button formatting.
 */

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface ClubInviteLink {
  clubId: string;
  clubName: string;
  chatLink: string | null;
  channelLink: string | null;
}

export interface InviteLinksResult {
  links: ClubInviteLink[];
  inlineKeyboard: Array<Array<{ text: string; url: string }>>;
}

/**
 * Get invite links for all clubs mapped to a product.
 * Uses existing static invite links from telegram_clubs.
 * For one-time dynamic links, the grant flow handles that separately.
 */
export async function getProductClubInviteLinks(
  supabase: SupabaseClient,
  productId: string,
): Promise<InviteLinksResult> {
  const result: InviteLinksResult = { links: [], inlineKeyboard: [] };

  // Get clubs mapped to this product
  const { data: mappings } = await supabase
    .from('product_club_mappings')
    .select('club_id')
    .eq('product_id', productId)
    .eq('is_active', true);

  if (!mappings || mappings.length === 0) return result;

  const clubIds = mappings.map((m: any) => m.club_id);

  // Get club details
  const { data: clubs } = await supabase
    .from('telegram_clubs')
    .select('id, name, chat_invite_link, channel_invite_link')
    .in('id', clubIds)
    .eq('is_active', true);

  if (!clubs || clubs.length === 0) return result;

  for (const club of clubs) {
    const link: ClubInviteLink = {
      clubId: club.id,
      clubName: club.name || 'Клуб',
      chatLink: club.chat_invite_link || null,
      channelLink: club.channel_invite_link || null,
    };
    result.links.push(link);

    // Build inline keyboard buttons
    const row: Array<{ text: string; url: string }> = [];
    if (link.chatLink) {
      row.push({ text: `💬 ${link.clubName} — Чат`, url: link.chatLink });
    }
    if (link.channelLink) {
      row.push({ text: `📢 ${link.clubName} — Канал`, url: link.channelLink });
    }
    if (row.length > 0) {
      result.inlineKeyboard.push(row);
    }
  }

  return result;
}

/**
 * Build a formatted message block listing club access with dates.
 * Each club gets its own line with name and access date.
 */
export function formatClubAccessBlock(
  links: ClubInviteLink[],
  accessDates: Map<string, { endAt: Date | null; isUnlimited: boolean }>,
): string {
  if (links.length === 0) return '';

  const lines: string[] = [];
  for (const link of links) {
    const dateInfo = accessDates.get(link.clubId);
    let dateStr = '';
    if (dateInfo?.isUnlimited) {
      dateStr = 'бессрочно';
    } else if (dateInfo?.endAt) {
      dateStr = dateInfo.endAt.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
      });
    }
    lines.push(`🏠 *${link.clubName}*${dateStr ? ` — доступ до ${dateStr}` : ''}`);
  }
  return lines.join('\n');
}
