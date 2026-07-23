/**
 * Server-side source of truth for a public site form.
 *
 * A browser may submit values, but it must not choose which CRM pipeline,
 * product, or authorization flow the form controls. Those settings are
 * persisted in the published site's block configuration.
 */
export interface ServerFormSettings {
  authMode: boolean;
  productId?: string;
  tariffId?: string;
  dealCreationEnabled: boolean;
  pipelineId?: string;
  pipelineStageId?: string;
}

type SiteFormBlock = {
  id?: unknown;
  type?: unknown;
  content?: unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toSettings(content: Record<string, unknown>): ServerFormSettings {
  const productBindingEnabled = content.product_binding_enabled === true;
  const dealCreationEnabled = content.deal_creation_enabled === true;

  return {
    authMode: content.auth_mode === true,
    productId: productBindingEnabled ? asNonEmptyString(content.product_id) : undefined,
    tariffId: productBindingEnabled ? asNonEmptyString(content.tariff_id) : undefined,
    dealCreationEnabled,
    pipelineId: dealCreationEnabled ? asNonEmptyString(content.pipeline_id) : undefined,
    pipelineStageId: dealCreationEnabled ? asNonEmptyString(content.pipeline_stage_id) : undefined,
  };
}

/**
 * Returns null when the request cannot be bound unambiguously to a published
 * form block. The one-form fallback keeps cached versions of the public site
 * working during a frontend rollout; pages with multiple forms must provide a
 * block id so the server never guesses a CRM destination.
 */
export function resolveServerFormSettings(
  blocks: unknown,
  requestedBlockId?: string,
): ServerFormSettings | null {
  if (!Array.isArray(blocks)) return null;

  const formBlocks = blocks.filter((block): block is SiteFormBlock =>
    isRecord(block) && block.type === "form" && isRecord(block.content),
  );

  const requested = asNonEmptyString(requestedBlockId);
  const formBlock = requested
    ? formBlocks.find((block) => block.id === requested)
    : formBlocks.length === 1 ? formBlocks[0] : undefined;

  return formBlock && isRecord(formBlock.content)
    ? toSettings(formBlock.content)
    : null;
}
