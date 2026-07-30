import { describe, expect, it } from "vitest";
import {
  isMissingCompanyRequisitesRelation,
  mergeLinkedCompanyIds,
} from "./linkedCompanyIds";

describe("mergeLinkedCompanyIds", () => {
  it("keeps direct CRM links and adds requisites-only companies", () => {
    expect(mergeLinkedCompanyIds(["crm-company"], ["requisites-company"])).toEqual([
      "crm-company",
      "requisites-company",
    ]);
  });

  it("deduplicates a company present in both canonical relations", () => {
    expect(
      mergeLinkedCompanyIds(["company-a", null], ["company-a", "company-b", undefined]),
    ).toEqual(["company-a", "company-b"]);
  });
});

describe("isMissingCompanyRequisitesRelation", () => {
  it("recognizes only the not-yet-migrated optional map relation", () => {
    expect(isMissingCompanyRequisitesRelation({ code: "PGRST205" })).toBe(true);
    expect(
      isMissingCompanyRequisitesRelation({
        message: 'relation "client_legal_details_company_map" does not exist',
      }),
    ).toBe(true);
  });

  it("does not hide permission or network errors", () => {
    expect(isMissingCompanyRequisitesRelation({ code: "42501" })).toBe(false);
    expect(isMissingCompanyRequisitesRelation(new Error("network error"))).toBe(false);
  });
});
