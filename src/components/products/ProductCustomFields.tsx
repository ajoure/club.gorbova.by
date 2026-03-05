import { EntityCustomFields } from "@/components/shared/EntityCustomFields";

interface Props {
  entityId: string;
  entityType?: string;
}

export function ProductCustomFields({ entityId, entityType = "product" }: Props) {
  return (
    <EntityCustomFields
      entityId={entityId}
      entityType={entityType}
      entityLabel="продукта"
    />
  );
}
