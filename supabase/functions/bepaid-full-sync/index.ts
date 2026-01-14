import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Belarusian/Russian transliteration map from Latin to Cyrillic
const TRANSLIT_MAP: Record<string, string> = {
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
  'A': 'А', 'a': 'а',
  'B': 'Б', 'b': 'б',
  'V': 'В', 'v': 'в',
  'W': 'В', 'w': 'в',
  'G': 'Г', 'g': 'г',
  'H': 'Г', 'h': 'г',
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
  'PIHASHAVA': 'Пигашева', 'IRYNA': 'Ирина', 'ZIALIONENKAYA': 'Зелененькая',
  'TATSIANA': 'Татьяна', 'ZALEUSKAYA': 'Залевская', 'ANHELINA': 'Ангелина',
  'YELIZAVETA': 'Елизавета', 'RUBEL': 'Рубель', 'FEDORCHUK': 'Федорчук',
  'SERGEY': 'Сергей', 'VOLHA': 'Ольга', 'MAROZAVA': 'Морозова',
  'ANDREYEVA': 'Андреева', 'LARYONETS': 'Ларионец', 'KATSIARYNA': 'Екатерина',
  'YEFIMCHIK': 'Ефимчик', 'TATIANA': 'Татьяна', 'BANCHAK': 'Банчак',
  'INNA': 'Инна', 'ASIPIK': 'Асипик', 'NINA': 'Нина', 'SINITSKAYA': 'Синицкая',
  'NATALLIA': 'Наталья', 'BURMISTRONAK': 'Бурмистронок', 'DZIYANA': 'Дзяна',
  'DABRAVOLSKAYA': 'Добровольская', 'KARATSENKA': 'Каратенко', 'VIKTORIA': 'Виктория',
  'SHIRSHOVA': 'Ширшова', 'ELENA': 'Елена', 'SHEKH': 'Шех', 'ROMANOVSKAYA': 'Романовская',
  'OLGA': 'Ольга', 'KARZHENKA': 'Коржик', 'SHAUCHENKA': 'Шовченко', 'ALENA': 'Алена',
  'SAMETS': 'Самец', 'KIRICHKO': 'Киричко', 'NATALIA': 'Наталья', 'NOVIKAVA': 'Новикова',
  'DZERHIALIOVA': 'Дергилева', 'URBAN': 'Урбан', 'VALERYIA': 'Валерия', 'YERASTAVA': 'Ерастова',
  'ANTANINA': 'Антонина', 'DOLMAT': 'Долмат', 'NASIMAVA': 'Насимова', 'DARYA': 'Дарья',
  'KAZACHOK': 'Козачок', 'VARABEI': 'Воробей', 'FIADZKOVA': 'Федькова', 'MARYNA': 'Марина',
  'TSARENIA': 'Царенко', 'MONICH': 'Монич', 'SVIATLANA': 'Светлана', 'DAMANOUSKAYA': 'Домановская',
  'HRUSHEUSKAYA': 'Грушевская', 'NOVIK': 'Новик', 'YULIYA': 'Юлия', 'TRUBNIKAVA': 'Трубникова',
  'MALASHKEVICH': 'Малашкевич', 'KAPTSEVICH': 'Капцевич', 'SVETLANA': 'Светлана', 'LABKO': 'Лабко',
  'KRYVETSKAYA': 'Криветская', 'AKSANA': 'Оксана', 'HRYHORYEVA': 'Григорьева',
  'KASTSIANIEVICH': 'Кастяневич', 'HANCHARONAK': 'Гончаренок', 'YULIA': 'Юлия', 'ZHOLUDZ': 'Жолудь',
  'ZHANNA': 'Жанна', 'VYSOTSKAYA': 'Высоцкая', 'TSIMAFEYENKA': 'Тимофеенко', 'KUZNIATSOVA': 'Кузнецова',
  'VIKTORYIA': 'Виктория', 'PAPLAUSKAYA': 'Поплавская', 'MIKALAI': 'Николай', 'BAHDANAITS': 'Богданец',
  'BAHATKA': 'Богатка', 'BARYSENKA': 'Борисенко', 'KASTRAMA': 'Кострома', 'DZIYANAVA': 'Дзянова',
  'KLIMENKA': 'Клименко', 'VERANIIKA': 'Вероника', 'STSIAZHKO': 'Стежко', 'RUDENKA': 'Руденко',
  'PALINA': 'Полина', 'HUBSKAYA': 'Губская', 'SAKHARAVA': 'Сахарова', 'PALCHYK': 'Пальчик',
  'MARHARYTA': 'Маргарита', 'HUZAVA': 'Гузева', 'MAKIENKO': 'Макиенко', 'HANCHARUK': 'Гончарук',
  'SIARHEI': 'Сергей', 'YERMAKOVA': 'Ермакова', 'KATSAPAU': 'Кацапов', 'DZMITRY': 'Дмитрий',
  'PASHKEVICH': 'Пашкевич', 'SIARHEICHYK': 'Сергейчик', 'MARYIA': 'Мария', 'DRACHOVA': 'Драчева',
  'VATSLAVAVA': 'Вацлавова', 'KRYSTYNA': 'Кристина', 'STRELNIKOVA': 'Стрельникова',
  'PAULIUKEVICH': 'Павлюкевич', 'KACHALAVA': 'Качалова', 'NASTASCHUK': 'Настащук', 'LENA': 'Лена',
  'MIKHNEVICH': 'Михневич', 'AKSIANIUK': 'Аксенюк', 'PIVAVAR': 'Пивовар', 'HANNA': 'Анна',
  'LAPTSIONAK': 'Лапционок', 'KAROL': 'Кароль', 'PADLUZHNY': 'Подлужный', 'IVAN': 'Иван',
  'KUDZKO': 'Кудько', 'VALIANTSINA': 'Валентина', 'STASIUKEVICH': 'Стасюкевич', 'KATSIUK': 'Коцюк',
  'VADIM': 'Вадим', 'KASTSIUKOVICH': 'Костюкович', 'MIKITA': 'Никита', 'APANASENKO': 'Апанасенко',
  'YULIIA': 'Юлия', 'MILYUTCHYK': 'Милютчик', 'VALIANTSYNA': 'Валентина', 'KHLYSTSIKAVA': 'Хлыстикова',
  'ANNA': 'Анна', 'MARIA': 'Мария', 'ANASTASIA': 'Анастасия', 'EKATERINA': 'Екатерина',
  'ALEXANDRA': 'Александра', 'ALEXANDER': 'Александр', 'DMITRY': 'Дмитрий', 'MIKHAIL': 'Михаил',
  'ANDREY': 'Андрей', 'ALEKSEY': 'Алексей', 'VLADIMIR': 'Владимир', 'NIKOLAY': 'Николай',
  'PAVEL': 'Павел', 'KONSTANTIN': 'Константин', 'EVGENY': 'Евгений', 'MAXIM': 'Максим',
};

function transliterateToСyrillic(latinName: string): string {
  const words = latinName.split(' ');
  const translitWords: string[] = [];
  
  for (const word of words) {
    const upperWord = word.toUpperCase();
    if (NAME_CORRECTIONS[upperWord]) {
      translitWords.push(NAME_CORRECTIONS[upperWord]);
    } else {
      let result = word;
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

interface BepaidSubscription {
  id: string;
  state: string;
  tracking_id?: string;
  created_at: string;
  plan?: { amount: number; currency: string; title?: string; };
  customer?: { email?: string; first_name?: string; last_name?: string; phone?: string; };
  credit_card?: { last_4: string; brand: string; token?: string; holder?: string; };
  transactions?: Array<{ uid: string; status: string; amount: number; paid_at?: string; }>;
}

interface BepaidTransaction {
  uid: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  tracking_id?: string;
  created_at: string;
  paid_at?: string;
  credit_card?: { last_4: string; brand: string; holder?: string; token?: string; };
  customer?: { email?: string; first_name?: string; last_name?: string; phone?: string; };
}

interface SyncResult {
  bepaid_uid: string;
  email: string | null;
  phone: string | null;
  card_holder: string | null;
  card_holder_cyrillic: string | null;
  card_mask: string | null;
  amount: number;
  currency: string;
  paid_at: string | null;
  description: string | null;
  product_name: string | null;
  matched_profile_id: string | null;
  matched_profile_name: string | null;
  matched_profile_phone: string | null;
  match_type: 'email' | 'card_mask' | 'name_translit' | 'none';
  action: 'created' | 'skipped_duplicate' | 'skipped_no_match' | 'error' | 'pending';
  order_id: string | null;
  error?: string;
}

// A1: Enhanced sync report interface
interface SyncReport {
  found: number;
  added: number;
  skipped: number;
  errors: number;
  skip_reasons: Record<string, number>;
  samples: {
    added: Array<{ uid: string; amount: number; email?: string }>;
    skipped: Array<{ uid: string; reason: string; amount?: number }>;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { dryRun = true, fromDate, toDate } = await req.json().catch(() => ({}));
    
    console.log(`Starting bePaid full sync. dryRun=${dryRun}, fromDate=${fromDate}, toDate=${toDate}`);

    // Get bePaid credentials
    const { data: bepaidInstance } = await supabase
      .from("integration_instances")
      .select("config")
      .eq("provider", "bepaid")
      .in("status", ["active", "connected"])
      .single();

    if (!bepaidInstance?.config) {
      return new Response(JSON.stringify({ error: "No bePaid integration found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopId = bepaidInstance.config.shop_id;
    const secretKey = bepaidInstance.config.secret_key || Deno.env.get("BEPAID_SECRET_KEY");
    const auth = btoa(`${shopId}:${secretKey}`);

    // Fetch all profiles for matching
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, user_id, email, full_name, first_name, last_name, phone, was_club_member, status, card_masks, card_holder_names');
    
    if (profilesError) throw profilesError;
    console.log(`Loaded ${profiles?.length || 0} profiles for matching`);

    // Get existing payments to avoid duplicates - from both sources
    const [existingPayments, existingQueue] = await Promise.all([
      supabase.from('payments_v2').select('provider_payment_id').eq('provider', 'bepaid'),
      supabase.from('payment_reconcile_queue').select('bepaid_uid'),
    ]);
    
    const existingUids = new Set([
      ...(existingPayments.data || []).map(p => p.provider_payment_id),
      ...(existingQueue.data || []).map(q => q.bepaid_uid),
    ]);
    console.log(`Found ${existingUids.size} existing bePaid payments/queue items`);

    const results: SyncResult[] = [];
    const stats = {
      total_fetched: 0,
      matched_by_email: 0,
      matched_by_card: 0,
      matched_by_name: 0,
      not_matched: 0,
      skipped_duplicate: 0,
      created: 0,
      errors: 0,
    };

    // A1: Enhanced sync report
    const syncReport: SyncReport = {
      found: 0,
      added: 0,
      skipped: 0,
      errors: 0,
      skip_reasons: {},
      samples: { added: [], skipped: [] },
    };

    const addSkipReason = (reason: string, uid: string, amount?: number) => {
      syncReport.skip_reasons[reason] = (syncReport.skip_reasons[reason] || 0) + 1;
      syncReport.skipped++;
      if (syncReport.samples.skipped.length < 5) {
        syncReport.samples.skipped.push({ uid, reason, amount });
      }
    };

    // =================================================================
    // PART 1: Fetch ALL Subscriptions (with pagination)
    // =================================================================
    let page = 1;
    let hasMoreSubs = true;
    const allSubscriptions: BepaidSubscription[] = [];

    while (hasMoreSubs) {
      const subsResponse = await fetch(
        `https://api.bepaid.by/subscriptions?shop_id=${shopId}&per_page=100&page=${page}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        }
      );

      if (!subsResponse.ok) {
        console.error(`Failed to fetch subscriptions page ${page}:`, await subsResponse.text());
        break;
      }

      const subsData = await subsResponse.json();
      const subs: BepaidSubscription[] = subsData.subscriptions || [];
      
      if (subs.length === 0) {
        hasMoreSubs = false;
      } else {
        allSubscriptions.push(...subs);
        page++;
        if (subs.length < 100) hasMoreSubs = false;
      }
    }

    console.log(`Fetched ${allSubscriptions.length} total subscriptions from bePaid`);

    // =================================================================
    // PART 2: Fetch ALL Transactions (with pagination)
    // =================================================================
    page = 1;
    let hasMoreTx = true;
    const allTransactions: BepaidTransaction[] = [];

    const params: Record<string, string> = {
      status: "successful",
      per_page: "100",
    };
    if (fromDate) params.created_at_from = fromDate;
    if (toDate) params.created_at_to = toDate;

    while (hasMoreTx) {
      const txParams = new URLSearchParams({ ...params, page: String(page) });
      const txResponse = await fetch(
        `https://gateway.bepaid.by/transactions?${txParams.toString()}`,
        {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        }
      );

      if (!txResponse.ok) {
        console.error(`Failed to fetch transactions page ${page}:`, await txResponse.text());
        break;
      }

      const txData = await txResponse.json();
      const txs: BepaidTransaction[] = txData.transactions || [];

      if (txs.length === 0) {
        hasMoreTx = false;
      } else {
        allTransactions.push(...txs);
        page++;
        if (txs.length < 100) hasMoreTx = false;
      }
    }

    console.log(`Fetched ${allTransactions.length} total transactions from bePaid`);
    stats.total_fetched = allSubscriptions.length + allTransactions.length;
    syncReport.found = stats.total_fetched;

    // =================================================================
    // PART 3: Process Subscriptions
    // =================================================================
    for (const sub of allSubscriptions) {
      // Get first successful transaction
      const successfulTx = sub.transactions?.find(t => t.status === 'successful');
      if (!successfulTx) {
        addSkipReason('no_successful_transaction', sub.id);
        continue;
      }

      const bepaidUid = successfulTx.uid;
      
      // A1: Enhanced duplicate check with reason tracking
      if (existingUids.has(bepaidUid)) {
        stats.skipped_duplicate++;
        addSkipReason('already_exists', bepaidUid, (sub.plan?.amount || 0) / 100);
        results.push({
          bepaid_uid: bepaidUid,
          email: sub.customer?.email || null,
          phone: sub.customer?.phone || null,
          card_holder: sub.credit_card?.holder || null,
          card_holder_cyrillic: null,
          card_mask: sub.credit_card?.last_4 || null,
          amount: (sub.plan?.amount || 0) / 100,
          currency: sub.plan?.currency || 'BYN',
          paid_at: successfulTx.paid_at || null,
          description: sub.tracking_id || null,
          product_name: sub.plan?.title || 'Подписка bePaid',
          matched_profile_id: null,
          matched_profile_name: null,
          matched_profile_phone: null,
          match_type: 'none',
          action: 'skipped_duplicate',
          order_id: null,
        });
        continue;
      }

      await processPayment(
        supabase, profiles, 
        sub.customer?.email, sub.customer?.phone,
        sub.credit_card?.holder, sub.credit_card?.last_4, 
        (sub.plan?.amount || 0) / 100, sub.plan?.currency || 'BYN', 
        bepaidUid, successfulTx.paid_at,
        sub.tracking_id, sub.plan?.title || 'Подписка bePaid',
        sub, dryRun, existingUids, results, stats, syncReport
      );
    }

    // =================================================================
    // PART 4: Process Transactions
    // =================================================================
    for (const tx of allTransactions) {
      // A1: Enhanced duplicate check
      if (existingUids.has(tx.uid)) {
        stats.skipped_duplicate++;
        addSkipReason('already_exists', tx.uid, tx.amount / 100);
        results.push({
          bepaid_uid: tx.uid,
          email: tx.customer?.email || null,
          phone: tx.customer?.phone || null,
          card_holder: tx.credit_card?.holder || null,
          card_holder_cyrillic: null,
          card_mask: tx.credit_card?.last_4 || null,
          amount: tx.amount / 100,
          currency: tx.currency,
          paid_at: tx.paid_at || tx.created_at,
          description: tx.description || tx.tracking_id || null,
          product_name: tx.description || 'Платёж bePaid',
          matched_profile_id: null,
          matched_profile_name: null,
          matched_profile_phone: null,
          match_type: 'none',
          action: 'skipped_duplicate',
          order_id: null,
        });
        continue;
      }

      await processPayment(
        supabase, profiles, 
        tx.customer?.email, tx.customer?.phone,
        tx.credit_card?.holder, tx.credit_card?.last_4, 
        tx.amount / 100, tx.currency,
        tx.uid, tx.paid_at || tx.created_at,
        tx.description || tx.tracking_id, tx.description || 'Платёж bePaid',
        tx, dryRun, existingUids, results, stats, syncReport
      );
    }

    console.log('Sync completed:', stats);
    console.log('Sync report:', syncReport);

    // G2: Guard/STOP - warn if found > 0 but added = 0 and not all skipped as duplicates
    const potentialMissing = syncReport.found - syncReport.skipped - syncReport.added;
    if (syncReport.found > 0 && syncReport.added === 0 && potentialMissing > 0) {
      console.warn(`[GUARD] Found ${syncReport.found} transactions but added 0. Potential missing: ${potentialMissing}`);
    }

    // Log the sync run
    if (!dryRun) {
      await supabase.from("audit_logs").insert({
        action: "bepaid_full_sync",
        actor_user_id: "00000000-0000-0000-0000-000000000000",
        meta: { stats, syncReport, dryRun },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      stats,
      // A1: Include detailed sync report
      syncReport,
      results: results.slice(0, 500), // Limit response size
      total_results: results.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("bePaid full sync error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processPayment(
  supabase: any,
  profiles: any[],
  email: string | undefined,
  phone: string | undefined,
  cardHolder: string | undefined,
  cardMask: string | undefined,
  amount: number,
  currency: string,
  bepaidUid: string,
  paidAt: string | undefined,
  description: string | undefined,
  productName: string | undefined,
  rawPayload: any,
  dryRun: boolean,
  existingUids: Set<string>,
  results: SyncResult[],
  stats: any,
  syncReport: SyncReport
) {
  const cardHolderCyrillic = cardHolder ? transliterateToСyrillic(cardHolder) : null;
  
  let matchedProfile: any = null;
  let matchType: 'email' | 'card_mask' | 'name_translit' | 'none' = 'none';

  // 1. Try to match by email
  if (email) {
    matchedProfile = profiles.find(p => p.email?.toLowerCase() === email.toLowerCase());
    if (matchedProfile) {
      matchType = 'email';
      stats.matched_by_email++;
    }
  }

  // 2. Try to match by card mask
  if (!matchedProfile && cardMask) {
    matchedProfile = profiles.find(p => {
      const masks = p.card_masks as string[] || [];
      return masks.some((m: string) => m.includes(cardMask) || cardMask.includes(m));
    });
    if (matchedProfile) {
      matchType = 'card_mask';
      stats.matched_by_card++;
    }
  }

  // 3. Try to match by transliterated name
  if (!matchedProfile && cardHolderCyrillic) {
    const nameParts = cardHolderCyrillic.split(' ').filter(p => p.length > 2);
    if (nameParts.length >= 2) {
      matchedProfile = profiles.find(p => {
        if (!p.full_name) return false;
        const profileName = p.full_name.toLowerCase();
        return nameParts.every(part => profileName.includes(part.toLowerCase()));
      });
      if (matchedProfile) {
        matchType = 'name_translit';
        stats.matched_by_name++;
      }
    }
  }

  const result: SyncResult = {
    bepaid_uid: bepaidUid,
    email: email || null,
    phone: phone || null,
    card_holder: cardHolder || null,
    card_holder_cyrillic: cardHolderCyrillic,
    card_mask: cardMask || null,
    amount,
    currency,
    paid_at: paidAt || null,
    description: description || null,
    product_name: productName || null,
    matched_profile_id: matchedProfile?.id || null,
    matched_profile_name: matchedProfile?.full_name || null,
    matched_profile_phone: matchedProfile?.phone || null,
    match_type: matchType,
    action: matchedProfile ? 'pending' : 'skipped_no_match',
    order_id: null,
  };

  if (!matchedProfile) {
    stats.not_matched++;
    syncReport.skip_reasons['no_profile_match'] = (syncReport.skip_reasons['no_profile_match'] || 0) + 1;
    syncReport.skipped++;
    if (syncReport.samples.skipped.length < 5) {
      syncReport.samples.skipped.push({ uid: bepaidUid, reason: 'no_profile_match', amount });
    }
    results.push(result);
    return;
  }

  if (dryRun) {
    result.action = 'created';
    stats.created++;
    syncReport.added++;
    if (syncReport.samples.added.length < 5) {
      syncReport.samples.added.push({ uid: bepaidUid, amount, email });
    }
    results.push(result);
    return;
  }

  // Actually create records
  try {
    const userId = matchedProfile.user_id || matchedProfile.id;
    const productId = '11c9f1b8-0355-4753-bd74-40b42aa53616'; // Club product
    
    // Generate order number
    const now = new Date();
    const yearPart = now.getFullYear().toString().slice(-2);
    const { count } = await supabase
      .from("orders_v2")
      .select("id", { count: "exact", head: true })
      .like("order_number", `ORD-${yearPart}-%`);
    
    const seqPart = ((count || 0) + 1).toString().padStart(5, "0");
    const orderNumber = `ORD-${yearPart}-${seqPart}`;

    // Parse payment date
    const paymentDate = paidAt ? new Date(paidAt) : new Date();
    const subscriptionEnd = new Date(paymentDate);
    subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);

    // Create order
    const { data: newOrder, error: orderError } = await supabase
      .from('orders_v2')
      .insert({
        user_id: userId,
        product_id: productId,
        order_number: orderNumber,
        status: 'paid',
        final_price: amount,
        paid_amount: amount,
        currency: currency,
        customer_email: email || matchedProfile.email,
        created_at: paymentDate.toISOString(),
        meta: {
          source: 'bepaid_full_sync',
          bepaid_uid: bepaidUid,
          card_holder: cardHolder,
          card_mask: cardMask,
          match_type: matchType,
        }
      })
      .select()
      .single();

    if (orderError) throw orderError;
    result.order_id = newOrder.id;

    // Create payment
    await supabase.from('payments_v2').insert({
      order_id: newOrder.id,
      user_id: userId,
      provider: 'bepaid',
      provider_payment_id: bepaidUid,
      amount: amount,
      currency: currency,
      status: 'succeeded',
      paid_at: paymentDate.toISOString(),
      meta: { raw_payload: rawPayload }
    });

    // Create subscription
    await supabase.from('subscriptions_v2').insert({
      user_id: userId,
      order_id: newOrder.id,
      product_id: productId,
      status: 'active',
      current_period_start: paymentDate.toISOString(),
      current_period_end: subscriptionEnd.toISOString(),
    });

    // Create entitlement (dual-write: user_id + profile_id + order_id)
    await supabase.from('entitlements').upsert({
      user_id: userId,
      profile_id: matchedProfile.id,
      order_id: newOrder.id,
      product_code: 'club',
      status: 'active',
      expires_at: subscriptionEnd.toISOString(),
      meta: { source: 'bepaid_full_sync', order_id: newOrder.id }
    }, { onConflict: 'user_id,product_code' });

    // Update profile with card info
    const currentMasks = matchedProfile.card_masks as string[] || [];
    const currentHolders = matchedProfile.card_holder_names as string[] || [];
    
    const updatedMasks = cardMask && !currentMasks.includes(cardMask) 
      ? [...currentMasks, cardMask] : currentMasks;
    const updatedHolders = cardHolder && !currentHolders.includes(cardHolder)
      ? [...currentHolders, cardHolder] : currentHolders;

    if (updatedMasks.length > currentMasks.length || updatedHolders.length > currentHolders.length) {
      await supabase.from('profiles').update({
        card_masks: updatedMasks,
        card_holder_names: updatedHolders,
        was_club_member: true,
      }).eq('id', matchedProfile.id);
    }

    existingUids.add(bepaidUid);
    result.action = 'created';
    stats.created++;

  } catch (error) {
    console.error(`Error processing payment ${bepaidUid}:`, error);
    result.action = 'error';
    result.error = String(error);
    stats.errors++;
  }

  results.push(result);
}
