/**
 * Parse a public_id string and determine the entity type by prefix.
 * PRD- = product, T- = tariff
 */
export type PublicIdEntity = "product" | "tariff" | "training_module" | "unknown";

export interface ParsedPublicId {
  entity: PublicIdEntity;
  value: string;
}

const PREFIX_MAP: Record<string, PublicIdEntity> = {
  "PRD-": "product",
  "T-": "tariff",
};

export function parsePublicId(input: string): ParsedPublicId {
  const trimmed = input.trim().toUpperCase();
  for (const [prefix, entity] of Object.entries(PREFIX_MAP)) {
    if (trimmed.startsWith(prefix)) {
      return { entity, value: input.trim() };
    }
  }
  return { entity: "unknown", value: input.trim() };
}

export function isProductPublicId(input: string): boolean {
  return parsePublicId(input).entity === "product";
}

export function isTariffPublicId(input: string): boolean {
  return parsePublicId(input).entity === "tariff";
}
