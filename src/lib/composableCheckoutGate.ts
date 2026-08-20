type AddonCapableOffer = {
  offer_type: string;
  has_available_addons?: boolean;
};

/**
 * Configuration-driven gate for the add-on picker.
 *
 * Bank installments support addon_offer_ids in the canonical backend flow and
 * therefore must use the same picker as card, split-payment, and invoice
 * offers. Lead forms remain excluded because they do not create a composable
 * purchase.
 */
export function hasConfiguredCheckoutAddons(offer: AddonCapableOffer): boolean {
  return offer.has_available_addons === true && offer.offer_type !== "lead";
}
