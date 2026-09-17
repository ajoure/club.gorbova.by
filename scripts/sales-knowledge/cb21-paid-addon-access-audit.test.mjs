import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const auditSql = await readFile(new URL('./cb21-paid-addon-access-audit.sql', import.meta.url), 'utf8');
const businessParents = [
  '5f79fccc-015f-5846-b423-aea2a2ba1ed1',
  '1ec06293-920c-550d-bd14-4e8cbcdb5754',
  '8028fdcf-fdf0-50fb-ad78-27dc3ca35e1a',
  '91b14409-0e35-5034-aac7-ad820dbe871d',
];
const alumniSources = [
  '379f9ce6-5bbe-4d62-8881-b1f889547970',
  '010982b2-c153-40c2-9b43-65d13894c508',
  '7a3eb87b-79a8-4de7-b264-8b2c42b267d3',
  '1134dda8-0089-4b4c-bbbc-2ef253a6aa26',
];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE tariff_offers(id uuid PRIMARY KEY, is_active boolean NOT NULL, amount numeric NOT NULL);
    CREATE TABLE products_v2(id uuid PRIMARY KEY, is_active boolean NOT NULL);
    CREATE TABLE tariffs(id uuid PRIMARY KEY, is_active boolean NOT NULL);
    CREATE TABLE offer_addons(
      id uuid PRIMARY KEY, parent_offer_id uuid NOT NULL, addon_product_id uuid NOT NULL,
      addon_tariff_id uuid NOT NULL, addon_offer_id uuid NOT NULL, pricing_mode text NOT NULL,
      discount_percent numeric, is_required boolean NOT NULL, is_default_selected boolean NOT NULL,
      access_delivery_mode text NOT NULL, access_opens_at timestamptz, is_active boolean NOT NULL
    );
    CREATE TABLE orders_v2(user_id uuid, product_id uuid, status text, is_deleted boolean);
    CREATE TABLE entitlements(user_id uuid, product_id uuid, status text, expires_at timestamptz);
    CREATE TABLE scheduled_product_access(product_id uuid, status text, opens_at timestamptz);
  `);
  const alumniParents = (await Promise.all(alumniSources.map(async source => (
    await db.query("SELECT md5('cb21-full-sync-v2:' || $1)::uuid AS id", [source])
  )))).map(result => result.rows[0].id);
  const parents = [...businessParents, ...alumniParents];
  for (const parent of parents) {
    await db.query('INSERT INTO tariff_offers VALUES($1,true,1)', [parent]);
  }
  const paidUser = randomUUID();
  const products = [];
  for (let index = 0; index < 9; index += 1) {
    const product = randomUUID();
    const tariff = randomUUID();
    const offer = randomUUID();
    products.push(product);
    await db.query('INSERT INTO products_v2 VALUES($1,true)', [product]);
    await db.query('INSERT INTO tariffs VALUES($1,true)', [tariff]);
    await db.query('INSERT INTO tariff_offers VALUES($1,true,400)', [offer]);
    for (const parent of parents) {
      await db.query(
        `INSERT INTO offer_addons VALUES($1,$2,$3,$4,$5,'percent_discount',50,false,false,'fixed_date','2026-12-09T21:00:00Z',true)`,
        [randomUUID(), parent, product, tariff, offer],
      );
    }
  }
  await db.query("INSERT INTO orders_v2 VALUES($1,$2,'paid',false)", [paidUser, products[0]]);
  await db.query("INSERT INTO entitlements VALUES($1,$2,'active',NULL)", [paidUser, products[0]]);
  await db.query("INSERT INTO scheduled_product_access VALUES($1,'scheduled','2026-12-09T21:00:00Z')", [products[1]]);
  return {db, parents, products};
}

async function runAudit(db) {
  return (await db.query(auditSql)).rows[0].cb21_paid_addon_audit;
}

test('read-only paid add-on audit accepts only the configured paid catalogue', async () => {
  const {db, parents, products} = await fixture();
  try {
    const before = await Promise.all([
      db.query('SELECT count(*)::int AS count FROM offer_addons'),
      db.query('SELECT count(*)::int AS count FROM entitlements'),
      db.query('SELECT count(*)::int AS count FROM scheduled_product_access'),
    ]);
    const audit = await runAudit(db);
    assert.equal(audit.catalogue.expected_active_addon_rows, 72);
    assert.equal(audit.catalogue.active_addon_rows, 72);
    assert.equal(audit.catalogue.parent_offers_with_exactly_nine_addons, 8);
    assert.equal(audit.catalogue.cardinality_mismatches, 0);
    assert.equal(audit.catalogue.invalid_active_addon_rules, 0);
    assert.equal(audit.fulfilment.active_without_matching_paid_order_review, 0);
    assert.equal(audit.fulfilment.scheduled_with_wrong_opening, 0);
    const after = await Promise.all([
      db.query('SELECT count(*)::int AS count FROM offer_addons'),
      db.query('SELECT count(*)::int AS count FROM entitlements'),
      db.query('SELECT count(*)::int AS count FROM scheduled_product_access'),
    ]);
    assert.deepEqual(after.map(result => result.rows[0].count), before.map(result => result.rows[0].count));

    await db.query('UPDATE offer_addons SET is_default_selected=true WHERE parent_offer_id=$1 AND addon_product_id=$2', [parents[0], products[0]]);
    await db.query('DELETE FROM offer_addons WHERE parent_offer_id=$1 AND addon_product_id=$2', [parents[1], products[1]]);
    const mismatched = await runAudit(db);
    assert.equal(mismatched.catalogue.active_addon_rows, 71);
    assert.equal(mismatched.catalogue.cardinality_mismatches, 1);
    assert.equal(mismatched.catalogue.invalid_active_addon_rules, 1);
  } finally {
    await db.close();
  }
});
