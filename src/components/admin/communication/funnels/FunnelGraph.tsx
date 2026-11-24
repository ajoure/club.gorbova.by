import { blockTitle, type FunnelRecord } from './contracts';

const GRAPH_WIDTH = 340;
const NODE_X = 8;
const NODE_WIDTH = 240;
const NODE_RIGHT = NODE_X + NODE_WIDTH;
const ROW_HEIGHT = 112;

export function FunnelGraph({ funnel, selectedId, onSelect }: { funnel: FunnelRecord; selectedId: string; onSelect: (id: string) => void }) {
  const height = Math.max(140, funnel.blocks.length * ROW_HEIGHT + 12);
  return <div className="min-w-0 max-h-[32rem] overflow-y-auto rounded-lg border bg-muted/10" aria-label="Схема сообщений">
    <svg role="img" aria-label="Сообщения и переходы воронки" viewBox={`0 0 ${GRAPH_WIDTH} ${height}`} width="100%" height={height} preserveAspectRatio="xMidYMin meet" className="mx-auto block h-auto w-full max-w-[420px]">
      <defs><marker id={`arrow-${funnel.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>
      {funnel.blocks.flatMap((b, i) => [...b.buttons.filter(btn => btn.kind === 'next'), ...(b.next_step ? [{ id: `timed-${b.id}`, kind: 'next' as const, target_block_id: b.next_step.target_block_id, text: `${b.next_step.at} Минск` }] : [])].map((btn, j) => {
        if (btn.kind !== 'next') return null;
        const target = funnel.blocks.findIndex(t => t.id === btn.target_block_id); if (target < 0) return null;
        const y = i * ROW_HEIGHT + 54, end = target * ROW_HEIGHT + 54;
        const right = 286 + Math.min(j, 3) * 14;
        return <g key={btn.id} className="text-primary"><path fill="none" stroke="currentColor" strokeWidth="1.5" d={`M${NODE_RIGHT} ${y} C${right} ${y},${right} ${end},${NODE_RIGHT} ${end}`} markerEnd={`url(#arrow-${funnel.id})`}/><title>{btn.text} → {blockTitle(funnel.blocks[target], target)}</title></g>;
      }))}
      {funnel.blocks.map((b, i) => {
        const firstLine = b.text.replace(/[*_`]/g, '').split('\n')[0] || 'Новое сообщение';
        const title = `${b.id === funnel.start_block_id ? '▶ Старт · ' : ''}${i + 1}. ${firstLine}`;
        return <g key={b.id} role="button" tabIndex={0} aria-label={`Выбрать сообщение ${i + 1}`} aria-pressed={selectedId === b.id} onClick={() => onSelect(b.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(b.id); } }}>
          <title>{title}</title>
          <rect x={NODE_X} y={i * ROW_HEIGHT + 14} width={NODE_WIDTH} height="80" rx="10" className={selectedId === b.id ? 'fill-primary/10 stroke-primary' : 'fill-background stroke-border'} strokeWidth="2"/>
          <foreignObject x={NODE_X + 12} y={i * ROW_HEIGHT + 24} width={NODE_WIDTH - 24} height="22">
            <div className="truncate text-sm text-foreground" title={title}>{title}</div>
          </foreignObject>
          <text x={NODE_X + 12} y={i * ROW_HEIGHT + 65} fontSize="13" className="fill-muted-foreground">{b.next_step ? `Следующий шаг: ${b.next_step.at} Минск` : b.buttons.length ? `${b.buttons.filter(x => x.kind === 'next').length} переходов · ${b.buttons.filter(x => x.kind === 'url').length} ссылок${b.buttons.some(x => x.kind === 'finish') ? ' · ⏹ завершение' : ''}` : 'Завершение'}</text>
          <text x={NODE_X + 12} y={i * ROW_HEIGHT + 84} fontSize="13" className="fill-muted-foreground">{b.image_path ? 'Изображение · ' : ''}{b.text.length} символов</text>
        </g>;
      })}
    </svg>
  </div>;
}
