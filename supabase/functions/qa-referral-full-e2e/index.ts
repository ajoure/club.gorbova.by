// TEMPORARY admin-only referral E2E harness. DELETE after E2E completes.
// Actions: provision, scenario, verify, cleanup (all require admin JWT).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CLUB_PRODUCT_ID = '11c9f1b8-0355-4753-bd74-40b42aa53616'; // Gorbova Club

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function assertAdmin(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) throw new Error('unauthorized');
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims, error } = await userClient.auth.getClaims(auth.replace('Bearer ', ''));
  if (error || !claims?.claims?.sub) throw new Error('unauthorized');
  const uid = claims.claims.sub as string;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isAdmin } = await admin.rpc('referral_is_admin', { p_user_id: uid });
  if (!isAdmin) throw new Error('forbidden: not admin');
  return { admin, callerUid: uid };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' });

  try {
    const { admin, callerUid } = await assertAdmin(req);
    const body = await req.json();
    const action = body.action as string;
    const runId = body.run_id as string; // required (uuid string)
    if (!runId) return json(400, { error: 'run_id required' });

    if (action === 'provision') {
      return await provision(admin, runId, callerUid);
    } else if (action === 'scenarios') {
      return await scenarios(admin, runId, body);
    } else if (action === 'finite_installment') {
      return await finiteInstallment(admin, runId, body);
    } else if (action === 'verify') {
      return await verify(admin, runId, body);
    } else if (action === 'cleanup') {
      return await cleanup(admin, runId, body);
    }

    return json(400, { error: 'unknown action' });
  } catch (e) {
    return json(400, { error: String((e as Error)?.message ?? e) });
  }
});

async function provision(admin: any, runId: string, callerUid: string) {
  const stamp = Date.now();
  const referrerEmail = `qa.ref.referrer.${stamp}.${runId.slice(0, 8)}@example.test`;
  const inviteeEmail = `qa.ref.invitee.${stamp}.${runId.slice(0, 8)}@example.test`;
  const password = crypto.randomUUID() + '_QA!';

  const mkUser = async (email: string) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { qa_e2e_run_id: runId, qa_role: email.includes('referrer') ? 'referrer' : 'invitee' },
    });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    return data.user!;
  };

  const referrer = await mkUser(referrerEmail);
  const invitee = await mkUser(inviteeEmail);

  // Profiles are auto-created by handle_new_user trigger; fetch by user_id.
  const fetchProfile = async (uid: string, email: string) => {
    for (let i = 0; i < 10; i++) {
      const { data } = await admin.from('profiles').select('id').eq('user_id', uid).maybeSingle();
      if (data?.id) {
        await admin.from('profiles').update({ email, meta: { qa_e2e_run_id: runId } }).eq('id', data.id);
        return data.id as string;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`profile not created for ${email}`);
  };
  const refProfileId = await fetchProfile(referrer.id, referrerEmail);
  const invProfileId = await fetchProfile(invitee.id, inviteeEmail);

  // Partner auto-created by referral_profile_create_partner trigger; fetch it.
  const getPartner = async (profileId: string) => {
    for (let i = 0; i < 10; i++) {
      const { data } = await admin.from('referral_partners').select('id').eq('profile_id', profileId).maybeSingle();
      if (data?.id) return data.id as string;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`partner not auto-created for profile ${profileId}`);
  };
  const partnerId = await getPartner(refProfileId);
  // Ensure metadata tag for cleanup discovery
  await admin.from('referral_partners').update({ metadata: { qa_e2e_run_id: runId } }).eq('id', partnerId);

  // Create relationship (referrer's partner → invitee profile)
  const { data: rel, error: rErr } = await admin
    .from('referral_relationships')
    .insert({
      partner_id: partnerId,
      referred_profile_id: invProfileId,
      source: 'registration',
      status: 'active',
      metadata: { qa_e2e_run_id: runId },
    })
    .select('id')
    .single();
  if (rErr) throw new Error(`relationship: ${rErr.message}`);

  // Verify registration link auto-created for the partner
  const { data: links } = await admin
    .from('referral_program_links')
    .select('id, link_code, target_path, status')
    .eq('partner_id', partnerId);

  return json(200, {
    ok: true,
    run_id: runId,
    referrer: { user_id: referrer.id, profile_id: refProfileId, email: referrerEmail, partner_id: partnerId, links },
    invitee: { user_id: invitee.id, profile_id: invProfileId, email: inviteeEmail },
    relationship_id: rel.id,
  });
}

async function scenarios(admin: any, runId: string, body: any) {
  const inviteeProfileId = body.invitee_profile_id as string;
  if (!inviteeProfileId) return json(400, { error: 'invitee_profile_id required' });

  const now = new Date();
  const scenarios: any[] = [];

  // --- Scenario 1: Gorbova Club — first payment (30% expected) ---
  const clubOrder = await insertOrder(admin, {
    runId,
    profileId: inviteeProfileId,
    productId: CLUB_PRODUCT_ID,
    amount: 100,
    orderTag: 'club_first',
  });
  await insertPayment(admin, { orderId: clubOrder.id, amount: 100, isRecurring: false, runId, tag: 'club_first_initial' });
  await admin.from('orders_v2').update({ status: 'paid', paid_amount: 100 }).eq('id', clubOrder.id);
  const sale1 = await waitSale(admin, clubOrder.id);
  scenarios.push({ scenario: 'club_first_payment', order_id: clubOrder.id, sale: sale1 });

  // --- Scenario 2: Club renewal — recurring payment, should NOT create new attribution ---
  await insertPayment(admin, {
    orderId: clubOrder.id,
    amount: 100,
    isRecurring: true,
    runId,
    tag: 'club_renewal',
  });
  const sale2Count = await countSalesForOrder(admin, clubOrder.id);
  scenarios.push({ scenario: 'club_renewal', order_id: clubOrder.id, sale_count_after: sale2Count });

  // --- Scenario 3: One-time product (10% flat expected). Use a non-Club product. ---
  const oneTimeProductId = (body.one_time_product_id as string | undefined) ?? (await findOneTimeProduct(admin));
  let sale3 = null;
  if (oneTimeProductId) {
    const otOrder = await insertOrder(admin, {
      runId,
      profileId: inviteeProfileId,
      productId: oneTimeProductId,
      amount: 50,
      orderTag: 'one_time',
    });
    await insertPayment(admin, { orderId: otOrder.id, amount: 50, isRecurring: false, runId, tag: 'one_time_initial' });
    await admin.from('orders_v2').update({ status: 'paid', paid_amount: 50 }).eq('id', otOrder.id);
    sale3 = await waitSale(admin, otOrder.id);
    scenarios.push({ scenario: 'one_time_flat', order_id: otOrder.id, product_id: oneTimeProductId, sale: sale3 });
  } else {
    scenarios.push({ scenario: 'one_time_flat', skipped: 'no eligible one-time product with referral enabled' });
  }

  // --- Scenario 4: Idempotency — re-trigger status update on Club order ---
  await admin.from('orders_v2').update({ updated_at: new Date().toISOString(), status: 'paid' }).eq('id', clubOrder.id);
  const idemCount = await countSalesForOrder(admin, clubOrder.id);
  scenarios.push({ scenario: 'idempotency_retrigger', order_id: clubOrder.id, sale_count: idemCount });

  return json(200, { ok: true, run_id: runId, scenarios });
}

async function insertOrder(admin: any, opts: any) {
  const { data, error } = await admin
    .from('orders_v2')
    .insert({
      order_number: `QA-${opts.runId.slice(0, 8)}-${opts.orderTag}-${Date.now()}`,
      profile_id: opts.profileId,
      product_id: opts.productId,
      base_price: opts.amount,
      final_price: opts.amount,
      currency: 'BYN',
      status: 'draft',
      is_trial: false,
      meta: { qa_e2e_run_id: opts.runId, qa_tag: opts.orderTag },
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert order ${opts.orderTag}: ${error.message}`);
  return data;
}

async function insertPayment(admin: any, opts: any) {
  const { data, error } = await admin
    .from('payments_v2')
    .insert({
      order_id: opts.orderId,
      amount: opts.amount,
      currency: 'BYN',
      status: 'succeeded',
      paid_at: new Date().toISOString(),
      is_recurring: opts.isRecurring,
      meta: { qa_e2e_run_id: opts.runId, qa_tag: opts.tag },
    })
    .select('id')
    .single();
  if (error) throw new Error(`insert payment ${opts.tag}: ${error.message}`);
  return data;
}

async function waitSale(admin: any, orderId: string) {
  for (let i = 0; i < 5; i++) {
    const { data } = await admin
      .from('referral_sale_attributions')
      .select('id, partner_id, commission_percent_bps, commission_minor, commission_basis_minor, status, rule_snapshot')
      .eq('order_id', orderId)
      .maybeSingle();
    if (data) return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

async function countSalesForOrder(admin: any, orderId: string) {
  const { count } = await admin
    .from('referral_sale_attributions')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId);
  return count ?? 0;
}

async function findOneTimeProduct(admin: any) {
  const { data } = await admin
    .from('products_v2')
    .select('id, name, referral_settings_mode, referral_commission_scheme')
    .eq('is_active', true)
    .neq('id', CLUB_PRODUCT_ID)
    .in('referral_settings_mode', ['default', 'custom'])
    .limit(50);
  if (!data) return null;
  const eligible = data.find((p: any) => (p.referral_commission_scheme ?? 'flat') === 'flat');
  return eligible?.id ?? null;
}

async function verify(admin: any, runId: string, body: any) {
  const partnerId = body.partner_id as string;
  const { data: sales } = await admin
    .from('referral_sale_attributions')
    .select('id, order_id, commission_percent_bps, commission_minor, commission_basis_minor, status, rule_snapshot')
    .eq('partner_id', partnerId);
  const { data: txs } = await admin
    .from('referral_balance_transactions')
    .select('id, transaction_type, description, source_id, source_type')
    .eq('partner_id', partnerId);
  const { data: entries } = await admin
    .from('referral_balance_entries')
    .select('id, bucket, amount_minor, transaction_id')
    .eq('partner_id', partnerId);
  const { data: outbox } = await admin
    .from('notification_outbox')
    .select('id, channel, kind, payload, created_at')
    .contains('payload', { qa_e2e_run_id: runId })
    .limit(20);
  const { data: events } = await admin
    .from('domain_events')
    .select('id, type, payload, created_at')
    .like('type', 'referral.commission.%')
    .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  return json(200, { ok: true, run_id: runId, sales, transactions: txs, entries, outbox_matches: outbox?.length ?? 0, recent_referral_events: events });
}

async function cleanup(admin: any, runId: string, body: any) {
  const wipeAll = body.wipe_all === true;
  const deleted: Record<string, number> = {};

  // Discover QA profiles either by run_id or by prefix
  const q = admin.from('profiles').select('id, user_id, email');
  const { data: qaProfiles } = wipeAll
    ? await q.like('email', 'qa.ref.%')
    : await q.contains('meta', { qa_e2e_run_id: runId });
  const profileIds = (qaProfiles ?? []).map((p: any) => p.id);
  const userIds = (qaProfiles ?? []).map((p: any) => p.user_id).filter(Boolean);

  if (profileIds.length) {
    const { data: parts } = await admin
      .from('referral_partners')
      .select('id')
      .in('profile_id', profileIds);
    const partnerIds = (parts ?? []).map((x: any) => x.id);

    if (partnerIds.length) {
      const { data: txIds } = await admin
        .from('referral_balance_transactions')
        .select('id')
        .in('partner_id', partnerIds);
      deleted['_tx_found'] = (txIds?.length ?? 0) as any;
      if (txIds?.length) {
        const { count: ec, error: eeErr } = await admin
          .from('referral_balance_entries')
          .delete({ count: 'exact' })
          .in('transaction_id', txIds.map((x: any) => x.id));
        deleted['referral_balance_entries'] = ec ?? 0;
        if (eeErr) deleted['referral_balance_entries_err'] = eeErr.message as any;
      }
      const { count: sc, error: seErr } = await admin.from('referral_sale_attributions').delete({ count: 'exact' }).in('partner_id', partnerIds);
      deleted['referral_sale_attributions'] = sc ?? 0;
      if (seErr) deleted['referral_sale_attributions_err'] = seErr.message as any;
      const { count: tc, error: teErr } = await admin.from('referral_balance_transactions').delete({ count: 'exact' }).in('partner_id', partnerIds);
      deleted['referral_balance_transactions'] = tc ?? 0;
      if (teErr) deleted['referral_balance_transactions_err'] = teErr.message as any;
      const { count: rc } = await admin.from('referral_relationships').delete({ count: 'exact' }).in('partner_id', partnerIds);
      deleted['referral_relationships(partner)'] = rc ?? 0;
      const { count: rc2 } = await admin.from('referral_relationships').delete({ count: 'exact' }).in('referred_profile_id', profileIds);
      deleted['referral_relationships(referred)'] = rc2 ?? 0;
      const { count: lc } = await admin.from('referral_program_links').delete({ count: 'exact' }).in('partner_id', partnerIds);
      deleted['referral_program_links'] = lc ?? 0;
    }

    // Delete orders BEFORE partners/profiles to release FKs
    const { data: qaOrders } = await admin.from('orders_v2').select('id').in('profile_id', profileIds);
    const orderIds = (qaOrders ?? []).map((o: any) => o.id);
    if (orderIds.length) {
      const { count: pc, error: peErr } = await admin.from('payments_v2').delete({ count: 'exact' }).in('order_id', orderIds);
      deleted['payments_v2'] = pc ?? 0;
      if (peErr) deleted['payments_v2_err'] = peErr.message as any;
      const { count: oc, error: oeErr } = await admin.from('orders_v2').delete({ count: 'exact' }).in('id', orderIds);
      deleted['orders_v2'] = oc ?? 0;
      if (oeErr) deleted['orders_v2_err'] = oeErr.message as any;
    }

    if (partnerIds.length) {
      const { count: pc0, error: peErr } = await admin.from('referral_partners').delete({ count: 'exact' }).in('id', partnerIds);
      deleted['referral_partners'] = pc0 ?? 0;
      if (peErr) deleted['referral_partners_err'] = peErr.message as any;
    }

    const { count: prc, error: prErr } = await admin.from('profiles').delete({ count: 'exact' }).in('id', profileIds);
    deleted['profiles'] = prc ?? 0;
    if (prErr) deleted['profiles_err'] = prErr.message as any;
  }



  const { count: nc } = await admin.from('notification_outbox').delete({ count: 'exact' }).contains('payload', { qa_e2e_run_id: runId });
  deleted['notification_outbox'] = nc ?? 0;

  let authDeleted = 0;
  for (const uid of userIds) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (!error) authDeleted++;
  }
  // Also delete any qa auth users still around by email
  if (wipeAll) {
    const { data: userList } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of userList?.users ?? []) {
      if (u.email?.startsWith('qa.ref.')) {
        const { error } = await admin.auth.admin.deleteUser(u.id);
        if (!error) authDeleted++;
      }
    }
  }
  deleted['auth_users'] = authDeleted;

  return json(200, { ok: true, run_id: runId, wipe_all: wipeAll, deleted });
}
