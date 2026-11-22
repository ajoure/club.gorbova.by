import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { NamedOption, TelegramFunnelSegment, TelegramFunnelSegmentNode } from './contracts';

const fields = { country: 'Страна', city: 'Город', source: 'Источник', status: 'Статус контакта', marketing_consent: 'Согласие на маркетинг', was_club_member: 'Был участником клуба' } as const;
export const emptySegment = (productId = ''): TelegramFunnelSegment => ({ version: 1, root: { id: crypto.randomUUID(), op: 'and', args: [newCondition('product', productId)] } });
function newCondition(kind: string, product_id = ''): TelegramFunnelSegmentNode {
  const id = crypto.randomUUID();
  if (kind === 'year') return { id, kind, product_id, year: new Date().getFullYear(), negate: false };
  if (kind === 'cohort') return { id, kind, product_id, flow_id: '', negate: false };
  if (kind === 'tag') return { id, kind, tag: '', negate: false };
  if (kind === 'field') return { id, kind, field: 'country', operator: 'eq', value: '' };
  return { id, kind: 'product', relation: 'attended', product_id, negate: false };
}
const selectClass = 'h-10 max-w-full rounded-md border bg-background px-2 text-sm';
export function SegmentBuilder({ value, onChange, products, flows, tags = [] }: { value: TelegramFunnelSegment; onChange: (v: TelegramFunnelSegment) => void; products: NamedOption[]; flows: NamedOption[]; tags?: string[] }) {
  const render = (node: TelegramFunnelSegmentNode, update: (n: TelegramFunnelSegmentNode) => void, depth: number, remove?: () => void): React.ReactNode => {
    if ('op' in node) return <fieldset key={node.id} className="min-w-0 space-y-3 rounded-lg border p-3" aria-label="Группа условий">
      <div className="flex flex-wrap gap-2 items-center"><select aria-label="Связь условий" className={selectClass} value={node.op} onChange={e => update({ ...node, op: e.target.value as 'and' | 'or' })}><option value="and">Все условия (И)</option><option value="or">Любое условие (ИЛИ)</option></select>
        {remove && <Button size="sm" variant="ghost" onClick={remove}>Удалить группу</Button>}</div>
      {node.args.map((child, i) => render(child, next => update({ ...node, args: node.args.map((n, j) => j === i ? next : n) }), depth + 1, node.args.length > 1 ? () => update({ ...node, args: node.args.filter((_, j) => i !== j) }) : undefined))}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={node.args.length >= 30} onClick={() => update({ ...node, args: [...node.args, newCondition('product', products[0]?.id)] })}>Добавить условие</Button>
        {depth < 5 && <Button size="sm" variant="outline" disabled={node.args.length >= 30} onClick={() => update({ ...node, args: [...node.args, emptySegment(products[0]?.id).root] })}>Добавить группу И/ИЛИ</Button>}</div>
    </fieldset>;
    const productOptions = <><option value="">Выберите продукт</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</>;
    return <div key={node.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 p-2">
      <select aria-label="Тип условия" className={selectClass} value={node.kind} onChange={e => update(newCondition(e.target.value, products[0]?.id))}>
        <option value="product">Продукт / доступ</option><option value="year">Год участия</option><option value="cohort">Поток</option><option value="tag">Группа / метка</option><option value="field">Поле контакта</option>
      </select>
      {node.kind !== 'field' && <select aria-label="Наличие условия" className={selectClass} value={String(node.negate)} onChange={e => update({ ...node, negate: e.target.value === 'true' })}><option value="false">Да</option><option value="true">Нет</option></select>}
      {node.kind === 'product' && <select aria-label="Условие по продукту" className={selectClass} value={node.relation} onChange={e => update({ ...node, relation: e.target.value as typeof node.relation })}><option value="attended">Участвовал / учился</option><option value="purchased">Купил</option><option value="active_access">Есть активный доступ</option></select>}
      {'product_id' in node && <select aria-label="Продукт условия" className={selectClass} value={node.product_id} onChange={e => update(node.kind === 'cohort' ? { ...node, product_id: e.target.value, flow_id: '' } : { ...node, product_id: e.target.value })}>{productOptions}</select>}
      {node.kind === 'year' && <Input aria-label="Год участия" type="number" min={2000} max={2200} className="w-28" value={node.year} onChange={e => update({ ...node, year: Number(e.target.value) })}/>}
      {node.kind === 'cohort' && <select aria-label="Поток участия" className={selectClass} value={node.flow_id} onChange={e => update({ ...node, flow_id: e.target.value })}><option value="">Выберите поток</option>{flows.filter(f => f.product_id === node.product_id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
      {node.kind === 'tag' && <><Input aria-label="Группа / метка" list={`funnel-tags-${node.id}`} placeholder="Выберите группу из списка" className="max-w-72" value={node.tag} maxLength={80} onChange={e => update({ ...node, tag: e.target.value })}/><datalist id={`funnel-tags-${node.id}`}>{tags.map(t => <option key={t} value={t}/>)}</datalist></>}
      {node.kind === 'field' && <>
        <select aria-label="Поле контакта" className={selectClass} value={node.field} onChange={e => { const field = e.target.value as typeof node.field; update({ ...node, field, operator: 'eq', value: field === 'marketing_consent' || field === 'was_club_member' ? true : '' }); }}>{Object.entries(fields).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select aria-label="Сравнение поля" className={selectClass} value={node.operator} onChange={e => { const operator = e.target.value as typeof node.operator; update(operator === 'is_set' || operator === 'is_not_set' ? { id: node.id, kind: node.kind, field: node.field, operator } : { ...node, operator, value: node.field === 'marketing_consent' || node.field === 'was_club_member' ? true : '' }); }}><option value="eq">Равно</option><option value="neq">Не равно</option><option value="is_set">Заполнено</option><option value="is_not_set">Не заполнено</option></select>
        {(node.operator === 'eq' || node.operator === 'neq') && (typeof node.value === 'boolean' ? <select aria-label="Значение поля" className={selectClass} value={String(node.value)} onChange={e => update({ ...node, value: e.target.value === 'true' })}><option value="true">Да</option><option value="false">Нет</option></select> : <Input aria-label="Значение поля" className="max-w-64" value={String(node.value ?? '')} onChange={e => update({ ...node, value: e.target.value })}/>)}</>}
      {remove && <Button size="sm" variant="ghost" onClick={remove}>Удалить условие</Button>}
    </div>;
  };
  return <div className="space-y-2"><p className="text-sm text-muted-foreground">Участие учитывает подтверждённую историю, включая импорт. Неизвестный год или поток не подтверждает условие «Нет». «И» — человек подходит под все условия сразу, «ИЛИ» — под любое из них. Чтобы отправить сразу нескольким группам, выберите «Любое условие (ИЛИ)».</p>{render(value.root, root => onChange({ version: 1, root }), 1)}</div>;
}
