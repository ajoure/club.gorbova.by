interface SpacerSectionProps {
  content: Record<string, unknown>;
}

export function SpacerSection({ content }: SpacerSectionProps) {
  const height = (content.height as number) || 40;
  return <div style={{ height: `${height}px` }} />;
}
