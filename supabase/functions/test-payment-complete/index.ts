// Stage 6.B — 2026-07-14
// Функция намеренно отключена: она писала в payments_v2 записи с
// provider='admin_test' и вызывала production-интеграции (GetCourse, Telegram,
// canonical document hook) из административного UI. Оставлена опубликованной
// как tombstone для старых вкладок / закэшированных клиентов до подтверждения
// отсутствия вызовов; после этого будет удалена физически (Stage 6.B2).
//
// UI, вызывавший функцию (AdminOrdersV2 «Оплата получена (тест)» и
// PaymentDialog «Симулировать оплату»), удалён в том же Stage 6.B.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      error: 'gone',
      reason: 'stage6_b_disabled',
      disabled_at: '2026-07-14',
      message:
        'test-payment-complete отключён. Используйте канонические пути оплаты (bePaid Hosted / Stripe Checkout).',
    }),
    {
      status: 410,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  );
});
