/**
 * Provider anti-corruption layer for Companies imports.
 *
 * Adapters only normalize external payloads. They never write to `companies`
 * or `company_external_ids`; persistence belongs to the guarded service/RPC
 * boundary so preview, retry and reconciliation can share the same contract.
 */

export type CompanyExternalProvider = "amocrm" | "getcourse" | "manychat" | "csv";

export interface CompanyExternalRecord {
  provider: CompanyExternalProvider;
  externalId: string;
  externalUrl?: string | null;
  externalParentId?: string | null;
  externalEntityType: "company" | "organization" | "business";
  fullName?: string | null;
  shortName?: string | null;
  unp?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceRow: number;
  metadata: Record<string, unknown>;
}

export interface CompanyExternalAdapter<T = Record<string, unknown>> {
  readonly provider: CompanyExternalProvider;
  normalize(payload: T, sourceRow?: number): CompanyExternalRecord | null;
}

const firstText = (payload: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = payload[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text && text !== "-") return text;
  }
  return null;
};

const normalizeEmail = (value: string | null): string | null => {
  if (!value) return null;
  const email = value.toLowerCase().trim();
  return email.includes("@") ? email : null;
};

const normalizePhone = (value: string | null): string | null => {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? digits : null;
};

const normalizeUnp = (value: string | null): string | null => {
  if (!value) return null;
  const unp = value.replace(/\s+/g, "").trim();
  return /^\d{9}$/.test(unp) ? unp : null;
};

const buildRecord = (
  provider: CompanyExternalProvider,
  payload: Record<string, unknown>,
  keys: { id: string[]; name: string[]; shortName: string[]; unp: string[]; email: string[]; phone: string[]; url: string[]; parent: string[] },
  entityType: CompanyExternalRecord["externalEntityType"],
  sourceRow: number,
): CompanyExternalRecord | null => {
  const externalId = firstText(payload, keys.id);
  if (!externalId) return null;

  return {
    provider,
    externalId,
    externalUrl: firstText(payload, keys.url),
    externalParentId: firstText(payload, keys.parent),
    externalEntityType: entityType,
    fullName: firstText(payload, keys.name),
    shortName: firstText(payload, keys.shortName),
    unp: normalizeUnp(firstText(payload, keys.unp)),
    country: firstText(payload, ["country", "Country", "Страна"]),
    email: normalizeEmail(firstText(payload, keys.email)),
    phone: normalizePhone(firstText(payload, keys.phone)),
    sourceRow,
    metadata: { source: provider, source_row: sourceRow },
  };
};

const amocrmKeys = {
  id: ["id", "ID", "amo_id", "ID компании"],
  name: ["name", "Name", "Наименование", "Название"],
  shortName: ["short_name", "Краткое наименование"],
  unp: ["unp", "UNP", "УНП"],
  email: ["email", "Email", "Рабочий email"],
  phone: ["phone", "Phone", "Телефон", "Рабочий телефон"],
  url: ["url", "URL", "Ссылка"],
  parent: ["parent_id", "parentId"],
};

const getCourseKeys = {
  id: ["organization_id", "organizationId", "id", "ID организации"],
  name: ["organization_name", "organizationName", "name", "Название организации"],
  shortName: ["short_name", "Краткое название"],
  unp: ["unp", "УНП"],
  email: ["email", "E-mail"],
  phone: ["phone", "Телефон"],
  url: ["url", "Ссылка"],
  parent: ["parent_id", "parentId"],
};

const manyChatKeys = {
  id: ["business_id", "businessId", "id", "ID бизнеса"],
  name: ["business_name", "businessName", "name", "Название бизнеса"],
  shortName: ["short_name", "Краткое название"],
  unp: ["unp", "UNP", "УНП"],
  email: ["email", "Email"],
  phone: ["phone", "Phone", "Телефон"],
  url: ["url", "URL", "Ссылка"],
  parent: ["parent_id", "parentId"],
};

const csvKeys = {
  id: ["external_id", "externalId", "id", "ID", "Внешний ID"],
  name: ["full_name", "name", "Название", "Наименование"],
  shortName: ["short_name", "Краткое наименование"],
  unp: ["unp", "UNP", "УНП"],
  email: ["email", "Email", "E-mail"],
  phone: ["phone", "Phone", "Телефон"],
  url: ["external_url", "url", "URL", "Ссылка"],
  parent: ["external_parent_id", "parent_id", "parentId"],
};

export class AmoCRMCompanyAdapter implements CompanyExternalAdapter {
  readonly provider = "amocrm" as const;
  normalize(payload: Record<string, unknown>, sourceRow = 0) {
    return buildRecord(this.provider, payload, amocrmKeys, "company", sourceRow);
  }
}

export class GetCourseOrganizationAdapter implements CompanyExternalAdapter {
  readonly provider = "getcourse" as const;
  normalize(payload: Record<string, unknown>, sourceRow = 0) {
    return buildRecord(this.provider, payload, getCourseKeys, "organization", sourceRow);
  }
}

export class ManyChatBusinessAdapter implements CompanyExternalAdapter {
  readonly provider = "manychat" as const;
  normalize(payload: Record<string, unknown>, sourceRow = 0) {
    return buildRecord(this.provider, payload, manyChatKeys, "business", sourceRow);
  }
}

export class CSVCompanyImportAdapter implements CompanyExternalAdapter {
  readonly provider = "csv" as const;
  normalize(payload: Record<string, unknown>, sourceRow = 0) {
    return buildRecord(this.provider, payload, csvKeys, "company", sourceRow);
  }
}

export const companyExternalAdapters = {
  amocrm: new AmoCRMCompanyAdapter(),
  getcourse: new GetCourseOrganizationAdapter(),
  manychat: new ManyChatBusinessAdapter(),
  csv: new CSVCompanyImportAdapter(),
} satisfies Record<CompanyExternalProvider, CompanyExternalAdapter>;

export function normalizeCompanyExternalRows(
  provider: CompanyExternalProvider,
  rows: Array<Record<string, unknown>>,
): CompanyExternalRecord[] {
  const adapter = companyExternalAdapters[provider];
  return rows.flatMap((row, index) => {
    const normalized = adapter.normalize(row, index + 1);
    return normalized ? [normalized] : [];
  });
}
