import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";

interface DocumentData {
  documentNumber: string;
  documentDate: string;
  executor: { full_name: string; short_name?: string; unp: string; legal_address: string; bank_name: string; bank_code: string; bank_account: string; director_position?: string; director_full_name?: string; director_short_name?: string; acts_on_basis?: string; phone?: string; email?: string; };
  client: { client_type?: string; ind_full_name?: string; ent_name?: string; leg_name?: string; leg_director_name?: string; name?: string; phone?: string; email?: string; };
  order: { product_name: string; tariff_name?: string; final_price: number; currency: string; customer_email?: string; customer_phone?: string; };
}

interface InvoiceActPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DocumentData | null;
  isLoading?: boolean;
}

function numberToWordsRu(num: number): string {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  if (num === 0) return 'ноль';
  let result = '', n = num;
  if (n >= 1000) { const t = Math.floor(n / 1000); result += (t === 1 ? 'одна тысяча ' : t === 2 ? 'две тысячи ' : t <= 4 ? ones[t] + ' тысячи ' : ones[t] + ' тысяч '); n %= 1000; }
  if (n >= 100) { result += hundreds[Math.floor(n / 100)] + ' '; n %= 100; }
  if (n >= 10 && n < 20) result += teens[n - 10] + ' ';
  else { if (n >= 20) { result += tens[Math.floor(n / 10)] + ' '; n %= 10; } if (n > 0) result += ones[n] + ' '; }
  return result.trim();
}

function fullNameToInitials(name: string): string {
  if (!name) return '';
  const p = name.trim().split(/\s+/);
  return p.length === 1 ? p[0] : p.length === 2 ? `${p[0]} ${p[1][0]}.` : `${p[0]} ${p[1][0]}.${p[2][0]}.`;
}

function dateToRussianFormat(d: string): string {
  const m = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const dt = new Date(d);
  return `${dt.getDate()} ${m[dt.getMonth()]} ${dt.getFullYear()}`;
}

function getClientInfo(data: DocumentData) {
  const ct = data.client.client_type || 'individual';
  const has = ct === 'individual' ? !!data.client.ind_full_name : ct === 'entrepreneur' ? !!data.client.ent_name : !!data.client.leg_name;
  if (has) {
    const nm = ct === 'individual' ? data.client.ind_full_name : ct === 'entrepreneur' ? data.client.ent_name : data.client.leg_name;
    return { name: nm || '', phone: data.client.phone || data.order.customer_phone || '', email: data.client.email || data.order.customer_email || '' };
  }
  return { name: data.client.name || '', phone: data.order.customer_phone || data.client.phone || '', email: data.order.customer_email || data.client.email || '' };
}

export function InvoiceActPreviewDialog({ open, onOpenChange, data, isLoading }: InvoiceActPreviewDialogProps) {
  const [generating, setGenerating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!ref.current) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Счёт-акт ${data?.documentNumber}</title><link href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap" rel="stylesheet"><style>body{font-family:'PT Sans',sans-serif;padding:20px;}</style></head><body>${ref.current.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.print(); }, 500);
  };

  if (!data && !isLoading) return null;
  const info = data ? getClientInfo(data) : { name: '', phone: '', email: '' };
  const ct = data?.client.client_type || 'individual';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>{isLoading ? 'Формирование...' : `Счёт-акт № ${data?.documentNumber}`}</DialogTitle>
            {!isLoading && data && <Button onClick={handlePrint} className="mr-8"><Download className="h-4 w-4 mr-2" />Скачать PDF</Button>}
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-muted/30 rounded-lg p-4">
          {isLoading ? <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div> : data ? (
            <div ref={ref} className="bg-white p-8 rounded shadow-sm max-w-[210mm] mx-auto text-black" style={{ fontFamily: "'PT Sans', sans-serif", fontSize: '11px' }}>
              <div style={{ textAlign: 'right', marginBottom: 16, fontSize: 10, color: '#666' }}>оказанных услуг</div>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <h1 style={{ fontSize: 16, fontWeight: 'bold', margin: 0 }}>СЧЁТ-АКТ</h1>
                <p style={{ fontSize: 14, margin: '4px 0' }}>№ {data.documentNumber}</p>
                <p style={{ fontSize: 11, margin: 0 }}>г. Минск {dateToRussianFormat(data.documentDate)} года</p>
              </div>
              <p style={{ textAlign: 'justify', marginBottom: 16, fontSize: 10 }}>{data.executor.full_name}, именуемый в дальнейшем «Исполнитель», действующий на основании {data.executor.acts_on_basis || 'Устава'}, с одной стороны и {ct === 'individual' ? `физическое лицо ${info.name}` : info.name}, именуемое в дальнейшем «Заказчик», составили настоящий счёт-акт:</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, marginBottom: 16 }}>
                <thead><tr style={{ background: '#f5f5f5' }}><th style={{ border: '1px solid #333', padding: 6 }}>Наименование</th><th style={{ border: '1px solid #333', padding: 6 }}>Ед.</th><th style={{ border: '1px solid #333', padding: 6 }}>Кол.</th><th style={{ border: '1px solid #333', padding: 6 }}>Цена, {data.order.currency}</th><th style={{ border: '1px solid #333', padding: 6 }}>Итого, {data.order.currency}</th></tr></thead>
                <tbody><tr><td style={{ border: '1px solid #333', padding: 6 }}>{data.order.tariff_name ? `${data.order.product_name} — ${data.order.tariff_name}` : data.order.product_name}</td><td style={{ border: '1px solid #333', padding: 6, textAlign: 'center' }}>услуга</td><td style={{ border: '1px solid #333', padding: 6, textAlign: 'center' }}>1</td><td style={{ border: '1px solid #333', padding: 6, textAlign: 'center' }}>{data.order.final_price.toFixed(2)}</td><td style={{ border: '1px solid #333', padding: 6, textAlign: 'center' }}>{data.order.final_price.toFixed(2)}</td></tr></tbody>
              </table>
              <p style={{ fontSize: 10, marginBottom: 16 }}>Всего: {numberToWordsRu(Math.floor(data.order.final_price))} {data.order.currency === 'BYN' ? 'рублей' : data.order.currency}.</p>
              <div style={{ fontSize: 10, marginBottom: 16 }}><p style={{ fontWeight: 'bold' }}>Заказчик:</p><p>{ct === 'individual' ? 'Физ. лицо: ' : ''}{info.name}. {info.phone && `Тел: ${info.phone}. `}{info.email && `Email: ${info.email}`}</p></div>
              <div style={{ fontSize: 10 }}><p style={{ fontWeight: 'bold' }}>Исполнитель:</p><p>{data.executor.short_name || data.executor.full_name}, УНП {data.executor.unp}, {data.executor.legal_address}</p></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32, fontSize: 10 }}>
                <div style={{ width: '45%' }}><p>Заказчик:</p><div style={{ borderBottom: '1px solid #333', margin: '24px 0 4px' }} /><p style={{ fontSize: 8 }}>/{fullNameToInitials(info.name)}/</p></div>
                <div style={{ width: '45%' }}><p>Исполнитель:</p><div style={{ borderBottom: '1px solid #333', margin: '24px 0 4px' }} /><p style={{ fontSize: 8 }}>/{data.executor.director_short_name || fullNameToInitials(data.executor.director_full_name || '')}/</p></div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
