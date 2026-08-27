export type ComposableAddonRef = {
  addon_offer_id: string;
  addon_product_id: string;
  addon_product_name?: string | null;
};

/**
 * Maps a selection made against a pay_now addon matrix to the offer ids of a
 * sibling checkout method (invoice or bank_installment). Product id is the
 * stable business identity; offer id is specific to the parent offer matrix.
 */
export function mapSiblingAddonOfferIds(
  sourceAddons: ComposableAddonRef[],
  siblingAddons: ComposableAddonRef[],
  selectedSourceOfferIds: string[],
) {
  const sourceByOfferId = new Map(
    sourceAddons.map((addon) => [addon.addon_offer_id, addon]),
  );
  const siblingByProductId = new Map(
    siblingAddons.map((addon) => [addon.addon_product_id, addon]),
  );
  const addonOfferIds: string[] = [];
  const missingAddonNames: string[] = [];

  for (const sourceOfferId of selectedSourceOfferIds) {
    const sourceAddon = sourceByOfferId.get(sourceOfferId);
    const siblingAddon = sourceAddon
      ? siblingByProductId.get(sourceAddon.addon_product_id)
      : null;
    if (siblingAddon) {
      addonOfferIds.push(siblingAddon.addon_offer_id);
    } else {
      missingAddonNames.push(
        sourceAddon?.addon_product_name?.trim() || "дополнительный продукт",
      );
    }
  }

  return {
    addonOfferIds: [...new Set(addonOfferIds)],
    missingAddonNames: [...new Set(missingAddonNames)],
  };
}
