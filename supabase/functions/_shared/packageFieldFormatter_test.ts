// Sprint 3J — package ↔ billing parity tests.
// Доказательство: те же helpers, что в typed-tokens-resolver.ts.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  formatPackageUlField,
  formatPackageIpField,
  formatPackageFlField,
} from './packageFieldFormatter.ts';
import {
  canonicalizeLegalEntity,
  formatEntrepreneurDisplayName,
  fullNameToInitials,
} from './typed-tokens-resolver.ts';

// ── UL: краткое название (главный кейс пользователя) ────────────────────────
Deno.test('UL short_name: «ЗАО» + «АЖУР инкам» → «ЗАО «АЖУР инкам»» (паритет с billing)', () => {
  const row = { leg_org_form: 'ЗАО', leg_name: 'АЖУР инкам' };
  const pkg = formatPackageUlField('package.ul.short_name', row);
  const billing = canonicalizeLegalEntity(row.leg_org_form, row.leg_name, null).short_name;
  assertEquals(pkg, 'ЗАО «АЖУР инкам»');
  assertEquals(pkg, billing);
});

Deno.test('UL short_name: идемпотентность — повторный raw «ЗАО «Foo»» не задваивается', () => {
  const row = { leg_org_form: null, leg_name: 'ЗАО «Foo»', leg_full_name: null };
  const v = formatPackageUlField('package.ul.short_name', row);
  assertEquals(v, 'ЗАО «Foo»');
  // не «ЗАО ЗАО ...», не «"ЗАО ..."»
  assertEquals(v.startsWith('ЗАО ЗАО'), false);
  assertEquals(v.startsWith('«ЗАО'), false);
});

Deno.test('UL full_name: расшифровывает форму до длинной', () => {
  const row = { leg_org_form: 'ЗАО', leg_name: 'АЖУР инкам' };
  const v = formatPackageUlField('package.ul.full_name', row);
  // ZAO → "Закрытое акционерное общество «АЖУР инкам»" (per ru-inflection ORG_FORM_SHORT_TO_FULL)
  assertEquals(v.endsWith('«АЖУР инкам»'), true);
  assertEquals(v.includes('ЗАО'), false);
});

Deno.test('UL director_short_name: ФИО → инициалы как fullNameToInitials', () => {
  const row = { leg_director_name: 'Иванов Иван Иванович' };
  const v = formatPackageUlField('package.ul.director_short_name', row);
  assertEquals(v, fullNameToInitials(row.leg_director_name));
  assertEquals(v, 'Иванов И. И.');
});

Deno.test('UL director_position: нормализация в мужской род', () => {
  const row = { leg_director_position: 'Управляющая' };
  const v = formatPackageUlField('package.ul.director_position', row);
  assertEquals(v, 'Управляющий');
});

Deno.test('UL bank/phone/unp: pass-through', () => {
  const row = { bank_name: 'Беларусбанк', phone: '+375 29 ...', leg_unp: '123456789' };
  assertEquals(formatPackageUlField('package.ul.bank_name', row), 'Беларусбанк');
  assertEquals(formatPackageUlField('package.ul.phone', row), '+375 29 ...');
  assertEquals(formatPackageUlField('package.ul.unp', row), '123456789');
});

// ── IP ─────────────────────────────────────────────────────────────────────
Deno.test('IP name: оборачивается в «ИП …» без кавычек (паритет с customer.ent.name)', () => {
  const row = { ent_name: 'Федорчук Сергей Валерьевич' };
  const v = formatPackageIpField('package.ip.name', row);
  assertEquals(v, formatEntrepreneurDisplayName(row.ent_name));
  assertEquals(v, 'ИП Федорчук Сергей Валерьевич');
});

Deno.test('IP name: повторный «ИП ...» не дублируется', () => {
  const row = { ent_name: 'ИП Федорчук Сергей Валерьевич' };
  assertEquals(formatPackageIpField('package.ip.name', row), 'ИП Федорчук Сергей Валерьевич');
});

Deno.test('IP short_name: «ИП Фамилия И. О.»', () => {
  const row = { ent_name: 'Федорчук Сергей Валерьевич' };
  assertEquals(formatPackageIpField('package.ip.short_name', row), 'ИП Федорчук С. В.');
});

// ── FL ─────────────────────────────────────────────────────────────────────
Deno.test('FL full_name_short: fullNameToInitials', () => {
  const person = { full_name: 'Петров Пётр Петрович' };
  assertEquals(formatPackageFlField('package.fl.full_name_short', person), 'Петров П. П.');
});

Deno.test('FL passport_number_full: серия+номер', () => {
  const person = { passport_series: 'MP', passport_number: '1234567' };
  assertEquals(formatPackageFlField('package.fl.passport_number_full', person), 'MP1234567');
});

Deno.test('FL address parts читаются из address_structured jsonb', () => {
  const person = { address_structured: { city: 'Минск', street: 'Ленина' } };
  assertEquals(formatPackageFlField('package.fl.address_city', person), 'Минск');
  assertEquals(formatPackageFlField('package.fl.address_street', person), 'Ленина');
});

// ── Адрес FULL (UL) — formatStructuredAddress паритет ───────────────────────
Deno.test('UL address_full: пустой struct → пустая строка', () => {
  assertEquals(formatPackageUlField('package.ul.address_full', { leg_address_structured: null }), '');
});

// ── unknown tech_key — safe '' ─────────────────────────────────────────────
Deno.test('Unknown tech_key → "" (никогда не падает)', () => {
  assertEquals(formatPackageUlField('package.ul.unknown_xxx', { leg_name: 'x' }), '');
  assertEquals(formatPackageIpField('package.ip.unknown_xxx', { ent_name: 'x' }), '');
  assertEquals(formatPackageFlField('package.fl.unknown_xxx', { full_name: 'x' }), '');
});
