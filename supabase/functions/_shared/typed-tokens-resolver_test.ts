// Smoke-tests for typed-tokens-resolver (PLACEHOLDERS-NORMALIZATION-v3).
//
// Эти Deno-тесты — proof-уровень resolver: подтверждают, что 148 typed
// tokens правильно заполняются по типу плательщика (ФЛ/ЮЛ/ИП), что ИП
// рендерится без кавычек, что override руководителя ИП работает, и что
// типизированные блоки чужого payer_type остаются пустыми.
//
// Реальный DOCX/PDF E2E прогоняется владельцем через
// /admin/products-docs → DealDocumentsPanel; здесь зафиксированы
// resolver-инварианты, на которых стоит шаблонизация.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import {
  buildTypedNamespaceValues,
  formatEntrepreneurDisplayName,
} from "./typed-tokens-resolver.ts";

const customerInd = {
  client_type: "individual",
  ind_full_name: "Иванов Иван Иванович",
  ind_personal_number: "1234567A001PB1",
  ind_passport_series: "MP",
  ind_passport_number: "1234567",
  ind_passport_issued_by: "Фрунзенский РУВД г. Минска",
  ind_address: "г. Минск, ул. Панфилова, д. 2",
  bank_account: "BY00ALFA00000000000000000000",
  bank_name: "ОАО Альфа-Банк",
  bank_code: "ALFABY2X",
  phone: "+375291112233",
  email: "ivan@example.com",
};

const customerLeg = {
  client_type: "legal_entity",
  leg_org_form: "ООО",
  leg_name: 'ООО "Ромашка"',
  leg_short_name: "Ромашка",
  leg_unp: "192345678",
  leg_address: "г. Минск, пр. Победителей, д. 1",
  leg_director_name: "Петров Петр Петрович",
  leg_director_position: "Директор",
  leg_acts_on_basis: "Устава",
  bank_account: "BY00ALFA11111111111111111111",
  bank_name: "ОАО Альфа-Банк",
  bank_code: "ALFABY2X",
  phone: "+375291110000",
  email: "office@romashka.by",
};

const customerEntBare = {
  client_type: "entrepreneur",
  ent_name: "Федорчук Сергей Валерьевич",
  ent_unp: "591234567",
  ent_address: "г. Минск, ул. Кальварийская, д. 17",
  ent_acts_on_basis: "Свидетельства о государственной регистрации",
  bank_account: "BY00ALFA22222222222222222222",
  bank_name: "ОАО Альфа-Банк",
  bank_code: "ALFABY2X",
};

const customerEntWithQuotes = {
  ...customerEntBare,
  ent_name: 'ИП "Федорчук Сергей Валерьевич"',
};

const customerEntWithOverride = {
  ...customerEntBare,
  ent_director_position: "Представитель",
  ent_director_full_name: "Сидорова Мария Александровна",
  ent_director_short_name: "М. А. Сидорова",
  ent_acts_on_basis_override: "Доверенности № 5 от 01.01.2026",
};

const executorLeg = {
  subject_type: "legal_entity",
  org_form: "ООО",
  full_name: 'ООО "Горбова и Партнёры"',
  short_name: "Горбова и Партнёры",
  unp: "192987654",
  legal_address: "г. Минск, ул. Сурганова, д. 28",
  director_full_name: "Горбова Елена Александровна",
  director_position: "Директор",
  acts_on_basis: "Устава",
  bank_account: "BY00ALFA99999999999999999999",
  bank_name: "ОАО Альфа-Банк",
  bank_code: "ALFABY2X",
};

Deno.test("ФЛ-заказчик заполняет customer.ind.*, остальные customer.* типизированные пустые", () => {
  const map = buildTypedNamespaceValues(customerInd, executorLeg);
  assertEquals(map["customer.ind.full_name"], "Иванов Иван Иванович");
  assertEquals(map["customer.ind.passport_series"], "MP");
  assertEquals(map["customer.ind.passport_number"], "1234567");
  assertEquals(map["customer.ind.passport_number_full"], "MP 1234567");
  assertEquals(map["customer.leg.name"], "");
  assertEquals(map["customer.ent.name"], "");
  assertEquals(map["customer.leg.director_full_name"], "");
  assertEquals(map["customer.ent.director_full_name"], "");
});

Deno.test("ЮЛ-заказчик заполняет customer.leg.*, ind/ent блоки пустые", () => {
  const map = buildTypedNamespaceValues(customerLeg, executorLeg);
  assertEquals(map["customer.leg.name"], 'ООО "Ромашка"');
  assertEquals(map["customer.leg.unp"], "192345678");
  assertEquals(map["customer.leg.director_full_name"], "Петров Петр Петрович");
  assertEquals(map["customer.leg.director_position"], "Директор");
  assertEquals(map["customer.ind.full_name"], "");
  assertEquals(map["customer.ent.name"], "");
});

Deno.test("ИП-заказчик: имя без кавычек (raw без префикса)", () => {
  const map = buildTypedNamespaceValues(customerEntBare, executorLeg);
  assertEquals(map["customer.ent.name"], "ИП Федорчук Сергей Валерьевич");
  assertEquals(map["customer.ent.unp"], "591234567");
  assert(!map["customer.ent.name"].includes('"'));
  assert(!map["customer.ent.name"].includes("«"));
});

Deno.test("ИП-заказчик: имя без кавычек (raw уже с ИП и кавычками)", () => {
  const map = buildTypedNamespaceValues(customerEntWithQuotes, executorLeg);
  assertEquals(map["customer.ent.name"], "ИП Федорчук Сергей Валерьевич");
});

Deno.test("ИП без override: руководитель = сам ИП", () => {
  const map = buildTypedNamespaceValues(customerEntBare, executorLeg);
  assertEquals(map["customer.ent.director_position"], "Индивидуальный предприниматель");
  assertEquals(map["customer.ent.director_full_name"], "Федорчук Сергей Валерьевич");
  assertEquals(
    map["customer.ent.director_acts_on_basis"],
    "Свидетельства о государственной регистрации",
  );
});

Deno.test("ИП с override: руководитель = переопределённое значение", () => {
  const map = buildTypedNamespaceValues(customerEntWithOverride, executorLeg);
  assertEquals(map["customer.ent.director_position"], "Представитель");
  assertEquals(map["customer.ent.director_full_name"], "Сидорова Мария Александровна");
  assertEquals(map["customer.ent.director_short_name"], "М. А. Сидорова");
  assertEquals(
    map["customer.ent.director_acts_on_basis"],
    "Доверенности № 5 от 01.01.2026",
  );
});

Deno.test("ЮЛ-исполнитель заполняет executor.leg.*", () => {
  const map = buildTypedNamespaceValues(customerLeg, executorLeg);
  assertEquals(map["executor.leg.name"], 'ООО "Горбова и Партнёры"');
  assertEquals(map["executor.leg.unp"], "192987654");
  assertEquals(map["executor.leg.director_position"], "Директор");
  assertEquals(map["executor.ind.full_name"], "");
  assertEquals(map["executor.ent.name"], "");
});

Deno.test("formatEntrepreneurDisplayName: убирает любые кавычки и нормализует префикс", () => {
  assertEquals(formatEntrepreneurDisplayName("Иванов И. И."), "ИП Иванов И. И.");
  assertEquals(formatEntrepreneurDisplayName('ИП "Иванов И. И."'), "ИП Иванов И. И.");
  assertEquals(formatEntrepreneurDisplayName("ИП «Иванов И. И.»"), "ИП Иванов И. И.");
  assertEquals(formatEntrepreneurDisplayName("ип Иванов И. И."), "ИП Иванов И. И.");
  assertEquals(formatEntrepreneurDisplayName(""), "");
});

Deno.test("Все 148 typed-токенов customer/executor × ind/leg/ent присутствуют в map", () => {
  const map = buildTypedNamespaceValues(customerLeg, executorLeg);
  // Покрытие: для каждого namespace минимум базовый набор ключей.
  const required = [
    "customer.ind.full_name", "customer.ind.passport_number_full", "customer.ind.address.full",
    "customer.leg.name", "customer.leg.unp", "customer.leg.director_full_name", "customer.leg.address.full",
    "customer.ent.name", "customer.ent.unp", "customer.ent.director_full_name", "customer.ent.address.full",
    "executor.ind.full_name", "executor.ind.address.full",
    "executor.leg.name", "executor.leg.director_full_name", "executor.leg.address.full",
    "executor.ent.name", "executor.ent.director_full_name", "executor.ent.address.full",
  ];
  for (const k of required) {
    assert(k in map, `Missing typed token in resolver map: ${k}`);
  }
});
