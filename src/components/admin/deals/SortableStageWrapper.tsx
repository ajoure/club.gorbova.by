import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

interface Props {
  id: string;
  disabled?: boolean;
  children: (props: {
    setNodeRef: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    dragHandleProps: {
      attributes: Record<string, any>;
      listeners: Record<string, any> | undefined;
    };
    isDragging: boolean;
  }) => ReactNode;
}

export function SortableStageWrapper({ id, disabled, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled,
    data: { type: "stage" },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
    // Ensure full-height stretch within flex row
    display: "flex",
    alignSelf: "stretch",
  };

  return (
    <>
      {children({
        setNodeRef,
        style,
        dragHandleProps: { attributes, listeners },
        isDragging,
      })}
    </>
  );
}
