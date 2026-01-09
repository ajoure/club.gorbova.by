import { memo } from "react";

interface SelectionBoxProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export const SelectionBox = memo(function SelectionBox({
  startX,
  startY,
  endX,
  endY,
}: SelectionBoxProps) {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const width = Math.abs(endX - startX);
  const height = Math.abs(endY - startY);

  if (width < 5 && height < 5) return null;

  return (
    <div
      className="fixed border-2 border-primary bg-primary/10 pointer-events-none z-50 rounded"
      style={{
        left,
        top,
        width,
        height,
      }}
    />
  );
});
