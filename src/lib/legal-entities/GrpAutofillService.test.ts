import { describe, expect, it } from "vitest";
import { grpDataToAutofillFields } from "./GrpAutofillService";

describe("grpDataToAutofillFields", () => {
  it("separates the legal form and quotes from a legal-entity name", () => {
    const fields = grpDataToAutofillFields({
      unp: "591020810",
      full_name: 'Производственно-торговое унитарное предприятие "АзотХимФортис"',
      short_name: 'Унитарное предприятие "АзотХимФортис"',
      legal_address: "Беларусь, г. Гродно, ул. Карского, 47/1",
      registration_date: "2015-11-19",
      tax_office_code: "543",
      tax_office_name: "Инспекция МНС",
      status_code: "1",
      status_name: "Действующий",
      liquidation_date: null,
    });

    expect(fields).toMatchObject({
      entity_kind: "legal_entity",
      org_form_full: "Унитарное предприятие",
      clean_name: "АзотХимФортис",
      address: "Беларусь, г. Гродно, ул. Карского, 47/1",
    });
  });

  it("keeps an entrepreneur name without the ИП prefix", () => {
    const fields = grpDataToAutofillFields({
      unp: "123456789",
      full_name: "Индивидуальный предприниматель Иванов Иван Иванович",
      short_name: "Иванов И.И.",
      legal_address: null,
      registration_date: null,
      tax_office_code: null,
      tax_office_name: null,
      status_code: null,
      status_name: null,
      liquidation_date: null,
    });

    expect(fields).toMatchObject({
      entity_kind: "entrepreneur",
      clean_name: "Иванов Иван Иванович",
    });
  });
});
