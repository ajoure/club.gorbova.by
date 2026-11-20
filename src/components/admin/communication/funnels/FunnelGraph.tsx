import { blockTitle, type FunnelRecord } from './contracts';
export function FunnelGraph({ funnel, selectedId, onSelect }: { funnel: FunnelRecord; selectedId: string; onSelect: (id: string) => void }) {
  return <div className="max-h-[32rem] overflow-auto rounded-lg border bg-muted/10" aria-label="Схема сообщений">
    <svg role="img" aria-label="Сообщения и переходы воронки" width="100%" style={{ minWidth: 520 }} height={Math.max(140, funnel.blocks.length * 115 + 20)}>
      <defs><marker id={`arrow-${funnel.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>
      {funnel.blocks.flatMap((b, i) => b.buttons.filter(btn => btn.kind === 'next').map((btn, j) => {
        if (btn.kind !== 'next') return null;
        const target = funnel.blocks.findIndex(t => t.id === btn.target_block_id); if (target < 0) return null;
        const y = i * 115 + 50, end = target * 115 + 50, right = 355 + j * 22;
        return <g key={btn.id} className="text-primary"><path fill="none" stroke="currentColor" strokeWidth="1.5" d={`M320 ${y} C${right} ${y},${right} ${end},320 ${end}`} markerEnd={`url(#arrow-${funnel.id})`}/><title>{btn.text} → {blockTitle(funnel.blocks[target], target)}</title></g>;
      }))}
      {funnel.blocks.map((b, i) => <g key={b.id} role="button" tabIndex={0} aria-label={`Выбрать сообщение ${i + 1}`} onClick={() => onSelect(b.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(b.id); } }}>
        <rect x="12" y={i * 115 + 14} width="308" height="78" rx="10" className={selectedId === b.id ? 'fill-primary/10 stroke-primary' : 'fill-background stroke-border'} strokeWidth="2"/>
        <text x="24" y={i * 115 + 38} className="fill-foreground text-xs">{b.id === funnel.start_block_id ? '▶ Старт · ' : ''}{blockTitle(b, i).slice(0, 38)}</text>
        <text x="24" y={i * 115 + 61} className="fill-muted-foreground text-xs">{b.buttons.length ? `${b.buttons.filter(x => x.kind === 'next').length} переходов · ${b.buttons.filter(x => x.kind === 'url').length} ссылок` : 'Завершение'}</text>
        <text x="24" y={i * 115 + 80} className="fill-muted-foreground text-xs">{b.image_path ? 'Изображение · ' : ''}{b.text.length} символов</text>
      </g>)}
    </svg>
  </div>;
}
