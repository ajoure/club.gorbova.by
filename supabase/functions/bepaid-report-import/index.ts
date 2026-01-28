import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Belarusian/Russian transliteration map from Latin to Cyrillic
const TRANSLIT_MAP: Record<string, string> = {
  // Double letters first (order matters)
  'SHCH': 'Щ', 'shch': 'щ',
  'YA': 'Я', 'ya': 'я', 'IA': 'Я', 'ia': 'я',
  'YU': 'Ю', 'yu': 'ю', 'IU': 'Ю', 'iu': 'ю',
  'YE': 'Е', 'ye': 'е', 'IE': 'Е', 'ie': 'е',
  'YI': 'Ї', 'yi': 'ї',
  'ZH': 'Ж', 'zh': 'ж',
  'KH': 'Х', 'kh': 'х',
  'TS': 'Ц', 'ts': 'ц',
  'CH': 'Ч', 'ch': 'ч',
  'SH': 'Ш', 'sh': 'ш',
  'YO': 'Ё', 'yo': 'ё',
  // Single letters
  'A': 'А', 'a': 'а',
  'B': 'Б', 'b': 'б',
  'V': 'В', 'v': 'в',
  'W': 'В', 'w': 'в',
  'G': 'Г', 'g': 'г',
  'H': 'Г', 'h': 'г', // In Belarusian H often maps to Г
  'D': 'Д', 'd': 'д',
  'E': 'Е', 'e': 'е',
  'Z': 'З', 'z': 'з',
  'I': 'И', 'i': 'и',
  'Y': 'Й', 'y': 'й',
  'K': 'К', 'k': 'к',
  'L': 'Л', 'l': 'л',
  'M': 'М', 'm': 'м',
  'N': 'Н', 'n': 'н',
  'O': 'О', 'o': 'о',
  'P': 'П', 'p': 'п',
  'R': 'Р', 'r': 'р',
  'S': 'С', 's': 'с',
  'T': 'Т', 't': 'т',
  'U': 'У', 'u': 'у',
  'F': 'Ф', 'f': 'ф',
  'C': 'Ц', 'c': 'ц',
  "'": 'Ь', 
};

// Known name corrections (Latin -> Cyrillic)
const NAME_CORRECTIONS: Record<string, string> = {
  'PIHASHAVA': 'Пигашева',
  'IRYNA': 'Ирина',
  'ZIALIONENKAYA': 'Зелененькая',
  'TATSIANA': 'Татьяна',
  'ZALEUSKAYA': 'Залевская',
  'ANHELINA': 'Ангелина',
  'YELIZAVETA': 'Елизавета',
  'RUBEL': 'Рубель',
  'FEDORCHUK': 'Федорчук',
  'SERGEY': 'Сергей',
  'VOLHA': 'Ольга',
  'MAROZAVA': 'Морозова',
  'ANDREYEVA': 'Андреева',
  'LARYONETS': 'Ларионец',
  'KATSIARYNA': 'Екатерина',
  'YEFIMCHIK': 'Ефимчик',
  'TATIANA': 'Татьяна',
  'BANCHAK': 'Банчак',
  'INNA': 'Инна',
  'ASIPIK': 'Асипик',
  'NINA': 'Нина',
  'SINITSKAYA': 'Синицкая',
  'NATALLIA': 'Наталья',
  'BURMISTRONAK': 'Бурмистронок',
  'DZIYANA': 'Дзяна',
  'DABRAVOLSKAYA': 'Добровольская',
  'KARATSENKA': 'Каратенко',
  'VIKTORIA': 'Виктория',
  'SHIRSHOVA': 'Ширшова',
  'ELENA': 'Елена',
  'SHEKH': 'Шех',
  'ROMANOVSKAYA': 'Романовская',
  'OLGA': 'Ольга',
  'KARZHENKA': 'Коржик',
  'SHAUCHENKA': 'Шовченко',
  'ALENA': 'Алена',
  'SAMETS': 'Самец',
  'KIRICHKO': 'Киричко',
  'NATALIA': 'Наталья',
  'NOVIKAVA': 'Новикова',
  'DZERHIALIOVA': 'Дергилева',
  'URBAN': 'Урбан',
  'VALERYIA': 'Валерия',
  'YERASTAVA': 'Ерастова',
  'ANTANINA': 'Антонина',
  'DOLMAT': 'Долмат',
  'NASIMAVA': 'Насимова',
  'DARYA': 'Дарья',
  'KAZACHOK': 'Козачок',
  'VARABEI': 'Воробей',
  'FIADZKOVA': 'Федькова',
  'MARYNA': 'Марина',
  'TSARENIA': 'Царенко',
  'MONICH': 'Монич',
  'SVIATLANA': 'Светлана',
  'DAMANOUSKAYA': 'Домановская',
  'HRUSHEUSKAYA': 'Грушевская',
  'NOVIK': 'Новик',
  'YULIYA': 'Юлия',
  'TRUBNIKAVA': 'Трубникова',
  'MALASHKEVICH': 'Малашкевич',
  'KAPTSEVICH': 'Капцевич',
  'SVETLANA': 'Светлана',
  'LABKO': 'Лабко',
  'KRYVETSKAYA': 'Криветская',
  'AKSANA': 'Оксана',
  'HRYHORYEVA': 'Григорьева',
  'KASTSIANIEVICH': 'Кастяневич',
  'HANCHARONAK': 'Гончаренок',
  'YULIA': 'Юлия',
  'ZHOLUDZ': 'Жолудь',
  'ZHANNA': 'Жанна',
  'VYSOTSKAYA': 'Высоцкая',
  'TSIMAFEYENKA': 'Тимофеенко',
  'KUZNIATSOVA': 'Кузнецова',
  'VIKTORYIA': 'Виктория',
  'PAPLAUSKAYA': 'Поплавская',
  'MIKALAI': 'Николай',
  'BAHDANAITS': 'Богданец',
  'BAHATKA': 'Богатка',
  'BARYSENKA': 'Борисенко',
  'KASTRAMA': 'Кострома',
  'DZIYANAVA': 'Дзянова',
  'KLIMENKA': 'Клименко',
  'VERANIIKA': 'Вероника',
  'STSIAZHKO': 'Стежко',
  'RUDENKA': 'Руденко',
  'PALINA': 'Полина',
  'HUBSKAYA': 'Губская',
  'SAKHARAVA': 'Сахарова',
  'PALCHYK': 'Пальчик',
  'MARHARYTA': 'Маргарита',
  'HUZAVA': 'Гузева',
  'MAKIENKO': 'Макиенко',
  'HANCHARUK': 'Гончарук',
  'SIARHEI': 'Сергей',
  'YERMAKOVA': 'Ермакова',
  'KATSAPAU': 'Кацапов',
  'DZMITRY': 'Дмитрий',
  'PASHKEVICH': 'Пашкевич',
  'SIARHEICHYK': 'Сергейчик',
  'MARYIA': 'Мария',
  'DRACHOVA': 'Драчева',
  'VATSLAVAVA': 'Вацлавова',
  'KRYSTYNA': 'Кристина',
  'STRELNIKOVA': 'Стрельникова',
  'PAULIUKEVICH': 'Павлюкевич',
  'KACHALAVA': 'Качалова',
  'NASTASCHUK': 'Настащук',
  'LENA': 'Лена',
  'MIKHNEVICH': 'Михневич',
  'AKSIANIUK': 'Аксенюк',
  'PIVAVAR': 'Пивовар',
  'HANNA': 'Анна',
  'LAPTSIONAK': 'Лапционок',
  'KAROL': 'Кароль',
  'PADLUZHNY': 'Подлужный',
  'IVAN': 'Иван',
  'KUDZKO': 'Кудько',
  'VALIANTSINA': 'Валентина',
  'STASIUKEVICH': 'Стасюкевич',
  'KATSIUK': 'Коцюк',
  'VADIM': 'Вадим',
  'KASTSIUKOVICH': 'Костюкович',
  'MIKITA': 'Никита',
  'APANASENKO': 'Апанасенко',
  'YULIIA': 'Юлия',
  'MILYUTCHYK': 'Милютчик',
  'VALIANTSYNA': 'Валентина',
  'KHLYSTSIKAVA': 'Хлыстикова',
};

function transliterateToСyrillic(latinName: string): string {
  // First check for known names
  const words = latinName.split(' ');
  const translitWords: string[] = [];
  
  for (const word of words) {
    const upperWord = word.toUpperCase();
    if (NAME_CORRECTIONS[upperWord]) {
      translitWords.push(NAME_CORRECTIONS[upperWord]);
    } else {
      // Fallback to character-by-character transliteration
      let result = word;
      // Sort keys by length descending to match longer patterns first
      const sortedKeys = Object.keys(TRANSLIT_MAP).sort((a, b) => b.length - a.length);
      for (const key of sortedKeys) {
        const regex = new RegExp(key, 'g');
        result = result.replace(regex, TRANSLIT_MAP[key]);
      }
      translitWords.push(result);
    }
  }
  
  return translitWords.join(' ');
}

interface PaymentRecord {
  uid: string;
  orderId: string;
  status: string;
  description: string;
  amount: number;
  currency: string;
  trackingId: string;
  paymentDate: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  cardMask: string | null;
  cardHolder: string | null;
  transactionType: string;
  isRecurring: boolean;
}

interface ImportResult {
  total: number;
  matched: number;
  created: number;
  skipped: number;
  errors: string[];
  details: Array<{
    cardHolder: string;
    cardHolderCyrillic: string;
    email: string | null;
    amount: number;
    matchedProfileId: string | null;
    matchedProfileName: string | null;
    matchType: string;
    orderId: string | null;
    action: string;
  }>;
}

function parsePaymentLine(line: string): PaymentRecord | null {
  const parts = line.split('|').map(p => p.trim());
  if (parts.length < 35) return null;
  
  const uid = parts[1];
  const orderId = parts[2];
  const status = parts[3];
  const description = parts[4];
  const amount = parseFloat(parts[5]) || 0;
  const currency = parts[6];
  const trackingId = (parts[12] || '').replace(/\\_/g, '_');
  const paymentDate = parts[14];
  const firstName = parts[21] || null;
  const lastName = parts[22] || null;
  const email = (parts[31] || '').replace(/\\/g, '') || null;
  const cardMask = parts[34] || null;
  const cardHolder = parts[35] || null;
  const transactionType = parts[11];
  const recurringType = parts.length > 54 ? parts[54] : '';
  
  if (!uid || uid === '-' || !status) return null;
  
  return {
    uid,
    orderId,
    status,
    description,
    amount,
    currency,
    trackingId,
    paymentDate,
    email: email && email !== '-' ? email : null,
    firstName: firstName && firstName !== '-' ? firstName : null,
    lastName: lastName && lastName !== '-' ? lastName : null,
    cardMask: cardMask && cardMask !== '-' ? cardMask.replace(/ /g, '') : null,
    cardHolder: cardHolder && cardHolder !== '-' ? cardHolder : null,
    transactionType,
    isRecurring: recurringType === 'recurring'
  };
}

function detectTariffFromDescription(description: string): { tariffCode: string | null; tariffId: string | null } {
  const desc = description.toLowerCase();
  
  if (desc.includes('business')) {
    return { tariffCode: 'business', tariffId: '7c748940-dcad-4c7c-a92e-76a2344622d3' };
  }
  if (desc.includes('full')) {
    return { tariffCode: 'full', tariffId: 'b276d8a5-8e5f-4876-9f99-36f818722d6c' };
  }
  if (desc.includes('chat')) {
    return { tariffCode: 'chat', tariffId: '31f75673-a7ae-420a-b5ab-5906e34cbf84' };
  }
  
  return { tariffCode: null, tariffId: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { reportData, dryRun = true } = await req.json();
    
    if (!reportData) {
      throw new Error("reportData is required");
    }

    // Parse the report data (expecting markdown table format)
    const lines = reportData.split('\n').filter((line: string) => line.startsWith('|') && !line.includes('---'));
    
    const payments: PaymentRecord[] = [];
    for (const line of lines) {
      const payment = parsePaymentLine(line);
      if (payment && payment.status === 'Успешный' && payment.transactionType === 'Платеж' && payment.amount > 0) {
        payments.push(payment);
      }
    }

    console.log(`Parsed ${payments.length} valid payment records`);

    // Fetch existing profiles for matching
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, first_name, last_name, phone, was_club_member, status, card_masks, card_holder_names');
    
    if (profilesError) throw profilesError;

    const result: ImportResult = {
      total: payments.length,
      matched: 0,
      created: 0,
      skipped: 0,
      errors: [],
      details: []
    };

    const productId = '11c9f1b8-0355-4753-bd74-40b42aa53616'; // Club product

    for (const payment of payments) {
      try {
        const cardHolderCyrillic = payment.cardHolder ? transliterateToСyrillic(payment.cardHolder) : '';
        const { tariffCode, tariffId } = detectTariffFromDescription(payment.description);
        
        let matchedProfile: any = null;
        let matchType = 'none';

        // Try to match by email first
        if (payment.email) {
          matchedProfile = profiles?.find(p => p.email?.toLowerCase() === payment.email?.toLowerCase());
          if (matchedProfile) matchType = 'email';
        }

        // Try to match by card holder name (transliterated)
        if (!matchedProfile && cardHolderCyrillic) {
          const nameParts = cardHolderCyrillic.split(' ').filter(p => p.length > 2);
          if (nameParts.length >= 2) {
            matchedProfile = profiles?.find(p => {
              if (!p.full_name) return false;
              const profileName = p.full_name.toLowerCase();
              // Check if all name parts are in the profile name
              return nameParts.every(part => profileName.includes(part.toLowerCase()));
            });
            if (matchedProfile) matchType = 'name_translit';
          }
        }

        // Try to match by card mask
        if (!matchedProfile && payment.cardMask) {
          const cardMaskToMatch = payment.cardMask;
          matchedProfile = profiles?.find(p => {
            const cardMasks = p.card_masks as string[] || [];
            return cardMasks.includes(cardMaskToMatch);
          });
          if (matchedProfile) matchType = 'card_mask';
        }

        const detail: any = {
          cardHolder: payment.cardHolder || '',
          cardHolderCyrillic,
          email: payment.email,
          amount: payment.amount,
          tariff: tariffCode,
          matchedProfileId: matchedProfile?.id || null,
          matchedProfileName: matchedProfile?.full_name || null,
          matchType,
          orderId: null,
          action: ''
        };

        if (!dryRun) {
          if (matchedProfile) {
            // Get user_id - create auth user if needed for archived profile
            let userId = matchedProfile.user_id;
            
            if (!userId && matchedProfile.email) {
              // Create auth user for archived profile
              const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
                email: matchedProfile.email,
                email_confirm: true,
                user_metadata: { full_name: matchedProfile.full_name },
              });

              if (authError) {
                // Try to find existing user
                const { data: existingUsers } = await supabase.auth.admin.listUsers();
                const found = existingUsers?.users?.find((u: { email?: string }) => u.email === matchedProfile.email);
                if (found) {
                  userId = found.id;
                }
              } else {
                userId = authUser.user.id;
              }

              // Update profile with user_id
              if (userId) {
                await supabase
                  .from('profiles')
                  .update({ user_id: userId, status: 'active' })
                  .eq('id', matchedProfile.id);
              }
            }

            if (!userId) {
              // Skip if we can't get a user_id
              detail.action = 'skipped_no_user_id';
              result.skipped++;
              result.details.push(detail);
              continue;
            }

            // Create order for matched profile
            const orderNumber = `IMP-${payment.orderId}`;
            
            // Check if order already exists
            const { data: existingOrder } = await supabase
              .from('orders_v2')
              .select('id')
              .eq('order_number', orderNumber)
              .single();

            if (!existingOrder) {
              // Parse payment date for order and subscription
              const paymentDateMatch = payment.paymentDate?.match(/(\d{4}-\d{2}-\d{2})/);
              const paymentDate = paymentDateMatch ? new Date(paymentDateMatch[1]) : new Date();
              
              // Calculate subscription end date - calendar month for club at 21:00 UTC (end of day Minsk)
              const CLUB_PRODUCT_ID = "11c9f1b8-0355-4753-bd74-40b42aa53616";
              let subscriptionEnd: Date;
              if (productId === CLUB_PRODUCT_ID) {
                subscriptionEnd = new Date(Date.UTC(
                  paymentDate.getUTCFullYear(),
                  paymentDate.getUTCMonth() + 1,
                  paymentDate.getUTCDate(),
                  21, 0, 0
                ));
                // Edge case: 31 Jan → 28/29 Feb
                if (subscriptionEnd.getUTCDate() !== paymentDate.getUTCDate()) {
                  subscriptionEnd = new Date(Date.UTC(
                    paymentDate.getUTCFullYear(),
                    paymentDate.getUTCMonth() + 2,
                    0, 21, 0, 0
                  ));
                }
              } else {
                subscriptionEnd = new Date(paymentDate);
                subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
              }

              const { data: newOrder, error: orderError } = await supabase
                .from('orders_v2')
                .insert({
                  user_id: userId,
                  product_id: productId,
                  tariff_id: tariffId,
                  order_number: orderNumber,
                  status: 'paid',
                  final_price: payment.amount,
                  paid_amount: payment.amount,
                  currency: payment.currency,
                  customer_email: payment.email || matchedProfile.email,
                  created_at: paymentDate.toISOString(),
                  meta: {
                    source: 'bepaid_import',
                    bepaid_uid: payment.uid,
                    bepaid_order_id: payment.orderId,
                    tracking_id: payment.trackingId,
                    card_holder: payment.cardHolder,
                    card_mask: payment.cardMask,
                    original_description: payment.description
                  }
                })
                .select()
                .single();

              if (orderError) throw orderError;
              detail.orderId = newOrder.id;
              detail.action = 'order_created';

              // Create payment record
              await supabase
                .from('payments_v2')
                .insert({
                  order_id: newOrder.id,
                  user_id: userId,
                  provider: 'bepaid',
                  provider_payment_id: payment.uid,
                  amount: payment.amount,
                  currency: payment.currency,
                  status: 'succeeded',
                  paid_at: paymentDate.toISOString(),
                  created_at: paymentDate.toISOString(),
                  meta: {
                    bepaid_order_id: payment.orderId,
                    card_holder: payment.cardHolder,
                    card_mask: payment.cardMask,
                    imported_at: new Date().toISOString()
                  }
                });

              // Create subscription with proper dates
              await supabase
                .from('subscriptions_v2')
                .insert({
                  user_id: userId,
                  order_id: newOrder.id,
                  product_id: productId,
                  tariff_id: tariffId,
                  status: subscriptionEnd < new Date() ? 'expired' : 'active',
                  access_start_at: paymentDate.toISOString(),
                  access_end_at: subscriptionEnd.toISOString(),
                  created_at: paymentDate.toISOString(),
                  meta: {
                    import_source: 'bepaid_report',
                    bepaid_uid: payment.uid,
                  }
                });

              // Update profile with card data and was_club_member flag
              const existingCardMasks = (matchedProfile.card_masks as string[]) || [];
              const existingCardHolders = (matchedProfile.card_holder_names as string[]) || [];
              
              const updatedCardMasks = payment.cardMask && !existingCardMasks.includes(payment.cardMask) 
                ? [...existingCardMasks, payment.cardMask] 
                : existingCardMasks;
              
              const updatedCardHolders = payment.cardHolder && !existingCardHolders.includes(payment.cardHolder)
                ? [...existingCardHolders, payment.cardHolder]
                : existingCardHolders;

              await supabase
                .from('profiles')
                .update({
                  was_club_member: true,
                  card_masks: updatedCardMasks,
                  card_holder_names: updatedCardHolders
                })
                .eq('id', matchedProfile.id);

              result.matched++;
            } else {
              detail.action = 'order_exists';
              result.skipped++;
            }
          } else {
            // Create new archived profile
            const nameParts = cardHolderCyrillic.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            
            // Parse payment date
            const paymentDateMatch = payment.paymentDate?.match(/(\d{4}-\d{2}-\d{2})/);
            const paymentDate = paymentDateMatch ? new Date(paymentDateMatch[1]) : new Date();
            
            // Calculate subscription end date - calendar month for club at 21:00 UTC (end of day Minsk)
            const CLUB_PRODUCT_ID = "11c9f1b8-0355-4753-bd74-40b42aa53616";
            let subscriptionEnd: Date;
            if (productId === CLUB_PRODUCT_ID) {
              subscriptionEnd = new Date(Date.UTC(
                paymentDate.getUTCFullYear(),
                paymentDate.getUTCMonth() + 1,
                paymentDate.getUTCDate(),
                21, 0, 0
              ));
              if (subscriptionEnd.getUTCDate() !== paymentDate.getUTCDate()) {
                subscriptionEnd = new Date(Date.UTC(
                  paymentDate.getUTCFullYear(),
                  paymentDate.getUTCMonth() + 2,
                  0, 21, 0, 0
                ));
              }
            } else {
              subscriptionEnd = new Date(paymentDate);
              subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
            }

            const { data: newProfile, error: profileError } = await supabase
              .from('profiles')
              .insert({
                email: payment.email,
                full_name: `${lastName} ${firstName}`.trim() || cardHolderCyrillic,
                first_name: firstName,
                last_name: lastName,
                status: 'archived',
                was_club_member: true,
                card_masks: payment.cardMask ? [payment.cardMask] : [],
                card_holder_names: payment.cardHolder ? [payment.cardHolder] : []
              })
              .select()
              .single();

            if (profileError) throw profileError;
            
            // Create auth user for this profile
            let userId: string | null = null;
            const email = payment.email || `card_${payment.cardMask?.slice(-4) || 'unknown'}@imported.local`;
            
            const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
              email: email,
              email_confirm: true,
              user_metadata: { full_name: newProfile.full_name },
            });

            if (authError) {
              // Try to find existing user
              const { data: existingUsers } = await supabase.auth.admin.listUsers();
              const found = existingUsers?.users?.find((u: { email?: string }) => u.email === email);
              if (found) {
                userId = found.id;
              }
            } else {
              userId = authUser.user.id;
            }

            // Update profile with user_id
            if (userId) {
              await supabase
                .from('profiles')
                .update({ user_id: userId })
                .eq('id', newProfile.id);
            } else {
              detail.action = 'skipped_no_user_id';
              result.skipped++;
              result.details.push(detail);
              continue;
            }

            // Create order for new profile
            const orderNumber = `IMP-${payment.orderId}`;
            const { data: newOrder, error: orderError } = await supabase
              .from('orders_v2')
              .insert({
                user_id: userId,
                product_id: productId,
                tariff_id: tariffId,
                order_number: orderNumber,
                status: 'paid',
                final_price: payment.amount,
                paid_amount: payment.amount,
                currency: payment.currency,
                customer_email: payment.email,
                created_at: paymentDate.toISOString(),
                meta: {
                  source: 'bepaid_import',
                  bepaid_uid: payment.uid,
                  bepaid_order_id: payment.orderId,
                  tracking_id: payment.trackingId,
                  card_holder: payment.cardHolder,
                  card_mask: payment.cardMask,
                  original_description: payment.description
                }
              })
              .select()
              .single();

            if (orderError) throw orderError;

            // Create payment record
            await supabase
              .from('payments_v2')
              .insert({
                order_id: newOrder.id,
                user_id: userId,
                provider: 'bepaid',
                provider_payment_id: payment.uid,
                amount: payment.amount,
                currency: payment.currency,
                status: 'succeeded',
                paid_at: paymentDate.toISOString(),
                created_at: paymentDate.toISOString(),
                meta: {
                  bepaid_order_id: payment.orderId,
                  card_holder: payment.cardHolder,
                  card_mask: payment.cardMask,
                  imported_at: new Date().toISOString()
                }
              });

            // Create subscription with proper dates
            await supabase
              .from('subscriptions_v2')
              .insert({
                user_id: userId,
                order_id: newOrder.id,
                product_id: productId,
                tariff_id: tariffId,
                status: subscriptionEnd < new Date() ? 'expired' : 'active',
                access_start_at: paymentDate.toISOString(),
                access_end_at: subscriptionEnd.toISOString(),
                created_at: paymentDate.toISOString(),
                meta: {
                  import_source: 'bepaid_report',
                  bepaid_uid: payment.uid,
                }
              });

            detail.matchedProfileId = newProfile.id;
            detail.matchedProfileName = newProfile.full_name;
            detail.orderId = newOrder.id;
            detail.action = 'profile_and_order_created';
            
            result.created++;
          }
        } else {
          // Dry run mode
          detail.action = matchedProfile ? 'would_match' : 'would_create';
          if (matchedProfile) {
            result.matched++;
          } else {
            result.created++;
          }
        }

        result.details.push(detail);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        result.errors.push(`Error processing payment ${payment.uid}: ${errorMessage}`);
        result.skipped++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        result
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
