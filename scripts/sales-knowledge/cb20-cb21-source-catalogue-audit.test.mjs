import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

const auditSql = await readFile(new URL('./cb20-cb21-source-catalogue-audit.sql', import.meta.url), 'utf8');
const cb20 = '3e43fb28-8322-41bc-bfee-714731bdc630';
const cb21 = '2b7bf6d4-ad8d-46ad-9399-7f96c307c596';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE products_v2(id uuid PRIMARY KEY, name text NOT NULL, is_active boolean NOT NULL);
    CREATE TABLE tariffs(id uuid PRIMARY KEY, product_id uuid NOT NULL, is_active boolean NOT NULL, is_public boolean NOT NULL);
    CREATE TABLE tariff_offers(id uuid PRIMARY KEY, tariff_id uuid NOT NULL, is_active boolean NOT NULL);
    CREATE TABLE offer_addons(id uuid PRIMARY KEY, parent_offer_id uuid NOT NULL, addon_product_id uuid NOT NULL, addon_tariff_id uuid NOT NULL, addon_offer_id uuid NOT NULL, is_active boolean NOT NULL);
    CREATE TABLE training_modules(id uuid PRIMARY KEY, product_id uuid NOT NULL, parent_module_id uuid, is_active boolean NOT NULL);
    CREATE TABLE access_rules(id uuid PRIMARY KEY, product_id uuid NOT NULL, tariff_id uuid, grant_target_type text NOT NULL, target_ref text NOT NULL, conditions jsonb NOT NULL, is_active boolean NOT NULL);
  `);
  const insert = async (table, row) => db.query(
    `INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map((_, index) => `$${index + 1}`).join(',')})`,
    Object.values(row),
  );
  for (const [id, name] of [[cb20, 'ЦБ20'], [cb21, 'ЦБ21']]) {
    await insert('products_v2', {id, name, is_active: true});
  }
  const parents = {};
  for (const [scope, product] of [['cb20', cb20], ['cb21', cb21]]) {
    const tariff = randomUUID();
    const offer = randomUUID();
    parents[scope] = offer;
    await insert('tariffs', {id: tariff, product_id: product, is_active: true, is_public: true});
    await insert('tariff_offers', {id: offer, tariff_id: tariff, is_active: true});
  }
  const addProduct = async ({name, scopes, delivery, offerActive = true}) => {
    const product = randomUUID();
    const tariff = randomUUID();
    const offer = randomUUID();
    await insert('products_v2', {id: product, name, is_active: true});
    await insert('tariffs', {id: tariff, product_id: product, is_active: true, is_public: false});
    await insert('tariff_offers', {id: offer, tariff_id: tariff, is_active: offerActive});
    for (const scope of scopes) {
      await insert('offer_addons', {id: randomUUID(), parent_offer_id: parents[scope], addon_product_id: product, addon_tariff_id: tariff, addon_offer_id: offer, is_active: true});
    }
    if (delivery === 'content') {
      const root = randomUUID();
      await insert('training_modules', {id: root, product_id: product, parent_module_id: null, is_active: true});
      await insert('access_rules', {
        id: randomUUID(), product_id: product, tariff_id: null, grant_target_type: 'training_content',
        target_ref: root, conditions: {access_mode: 'full'}, is_active: true,
      });
    }
    if (delivery === 'product') {
      await insert('access_rules', {
        id: randomUUID(), product_id: product, tariff_id: null, grant_target_type: 'product_access',
        target_ref: product, conditions: {access_mode: 'full'}, is_active: true,
      });
    }
    return product;
  };
  const sharedContent = await addProduct({name: 'Общий контент', scopes: ['cb20', 'cb21'], delivery: 'content'});
  const sharedProduct = await addProduct({name: 'Общий доступ', scopes: ['cb20', 'cb21'], delivery: 'product'});
  const sourceOnly = await addProduct({name: 'Только ЦБ20', scopes: ['cb20'], delivery: 'content'});
  const incomplete = await addProduct({name: 'Черновик без выдачи', scopes: ['cb20', 'cb21'], delivery: null});
  const inactiveOffer = await addProduct({name: 'Не продаётся', scopes: ['cb20', 'cb21'], delivery: 'content', offerActive: false});
  return {db, sharedContent, sharedProduct, sourceOnly, incomplete, inactiveOffer};
}

async function runAudit(db) {
  return (await db.query(auditSql)).rows[0].cb20_cb21_source_catalogue_audit;
}

test('read-only catalogue audit derives CB21 sales modules from deliverable CB20 configuration', async () => {
  const {db, sharedContent, sharedProduct, sourceOnly, incomplete, inactiveOffer} = await fixture();
  try {
    const before = await Promise.all([
      db.query('SELECT count(*)::int AS count FROM offer_addons'),
      db.query('SELECT count(*)::int AS count FROM access_rules'),
    ]);
    const audit = await runAudit(db);
    assert.equal(audit.cb20_deliverable_product_count, 3);
    assert.equal(audit.cb21_deliverable_product_count, 2);
    assert.equal(audit.cb20_incomplete_product_count, 1);
    assert.equal(audit.cb21_incomplete_product_count, 1);
    assert.deepEqual(audit.source_only_deliverable_products, [sourceOnly]);
    assert.deepEqual(audit.target_only_deliverable_products, []);
    const cb20Products = new Map(audit.cb20.map(product => [product.product_id, product]));
    assert.equal(cb20Products.get(sharedContent).deliverable, true);
    assert.equal(cb20Products.get(sharedProduct).deliverable, true);
    assert.equal(cb20Products.get(incomplete).deliverable, false);
    assert.equal(cb20Products.has(inactiveOffer), false);
    const after = await Promise.all([
      db.query('SELECT count(*)::int AS count FROM offer_addons'),
      db.query('SELECT count(*)::int AS count FROM access_rules'),
    ]);
    assert.deepEqual(after.map(result => result.rows[0].count), before.map(result => result.rows[0].count));
  } finally {
    await db.close();
  }
});
