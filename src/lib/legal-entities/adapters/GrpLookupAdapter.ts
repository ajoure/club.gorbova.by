/**
 * GrpLookupAdapter — maps raw MNS GRP API response to domain model.
 *
 * Anti-corruption layer: internal LegalEntityLookupResult does NOT depend
 * on the raw GRP API JSON format. All GRP-specific parsing is here.
 */

import type {
  LegalEntityLookupResult,
  LegalEntityLookupData,
  GrpMetaBranch,
  LegalEntityPreviewData,
} from "../types";

// ─── Edge Function response → LegalEntityLookupResult ───

export class GrpLookupAdapter {
  static mapResponse(
    apiData: { found: boolean; data?: Record<string, unknown>; raw?: unknown; error?: string }
  ): LegalEntityLookupResult {
    if (apiData.error) {
      return {
        found: false,
        status: "unavailable",
        source: "direct",
        message: apiData.error,
      };
    }

    if (!apiData.found || !apiData.data) {
      return {
        found: false,
        status: "not_found",
        source: "direct",
        message: "Плательщик не найден в реестре МНС",
      };
    }

    const d = apiData.data;
    return {
      found: true,
      status: "found",
      source: "direct",
      data: {
        unp: String(d.unp || ""),
        full_name: String(d.full_name || ""),
        short_name: (d.short_name as string) || null,
        legal_address: (d.address as string) || null,
        registration_date: (d.registration_date as string) || null,
        tax_office_code: (d.tax_office_code as string) || null,
        tax_office_name: (d.tax_office_name as string) || null,
        status_code: (d.status_code as string) || null,
        status_name: (d.status_name as string) || null,
        liquidation_date: (d.liquidation_date as string) || null,
        liquidation_reason: (d.liquidation_reason as string) || null,
      },
      raw: apiData.raw || apiData.data,
    };
  }

  // ─── Build meta.grp branch ───

  static buildGrpMeta(result: LegalEntityLookupResult): { grp: GrpMetaBranch } {
    return {
      grp: {
        source: result.source,
        last_lookup_at: new Date().toISOString(),
        unp: result.data?.unp,
        full_name: result.data?.full_name,
        short_name: result.data?.short_name,
        address: result.data?.legal_address,
        registration_date: result.data?.registration_date,
        tax_office_code: result.data?.tax_office_code,
        tax_office_name: result.data?.tax_office_name,
        status_code: result.data?.status_code,
        status_name: result.data?.status_name,
        liquidation_date: result.data?.liquidation_date,
        liquidation_reason: result.data?.liquidation_reason,
        raw: result.raw,
      },
    };
  }

  // ─── Preview adapters ───

  static resultToPreview(result: LegalEntityLookupResult): LegalEntityPreviewData | null {
    if (!result.data) return null;
    return {
      full_name: result.data.full_name,
      short_name: result.data.short_name,
      unp: result.data.unp,
      legal_address: result.data.legal_address,
      registration_date: result.data.registration_date,
      tax_office_code: result.data.tax_office_code,
      tax_office_name: result.data.tax_office_name,
      status_code: result.data.status_code,
      status_name: result.data.status_name,
      liquidation_date: result.data.liquidation_date,
      liquidation_reason: result.data.liquidation_reason,
    };
  }

  static grpMetaToPreview(meta: Record<string, unknown> | null | undefined): LegalEntityPreviewData | null {
    const grp = (meta as Record<string, unknown>)?.grp as Record<string, unknown> | undefined;
    if (!grp) return null;
    return {
      full_name: (grp.full_name as string) || "",
      short_name: (grp.short_name as string) || null,
      unp: (grp.unp as string) || undefined,
      legal_address: (grp.address as string) || null,
      registration_date: (grp.registration_date as string) || null,
      tax_office_code: (grp.tax_office_code as string) || null,
      tax_office_name: (grp.tax_office_name as string) || null,
      status_code: (grp.status_code as string) || null,
      status_name: (grp.status_name as string) || null,
      liquidation_date: (grp.liquidation_date as string) || null,
      liquidation_reason: (grp.liquidation_reason as string) || null,
      last_lookup_at: (grp.last_lookup_at as string) || null,
    };
  }
}
