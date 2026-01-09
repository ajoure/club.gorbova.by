import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2, X } from "lucide-react";
import { jsPDF } from "jspdf";

interface DocumentData {
  documentNumber: string;
  documentDate: string;
  executor: {
    full_name: string;
    short_name?: string;
    unp: string;
    legal_address: string;
    bank_name: string;
    bank_code: string;
    bank_account: string;
    director_position?: string;
    director_full_name?: string;
    director_short_name?: string;
    acts_on_basis?: string;
    phone?: string;
    email?: string;
  };
  client: {
    client_type?: string;
    ind_full_name?: string;
    ent_name?: string;
    leg_name?: string;
    leg_director_name?: string;
    name?: string;
    phone?: string;
    email?: string;
  };
  order: {
    product_name: string;
    tariff_name?: string;
    final_price: number;
    currency: string;
  };
}

interface InvoiceActPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: DocumentData | null;
  isLoading?: boolean;
}

// Number to Russian words
function numberToWordsRu(num: number): string {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  
  if (num === 0) return 'ноль';
  if (num < 0) return 'минус ' + numberToWordsRu(-num);
  
  let result = '';
  
  if (num >= 1000) {
    const thousands = Math.floor(num / 1000);
    if (thousands === 1) result += 'одна тысяча ';
    else if (thousands === 2) result += 'две тысячи ';
    else if (thousands >= 3 && thousands <= 4) result += ones[thousands] + ' тысячи ';
    else result += ones[thousands] + ' тысяч ';
    num %= 1000;
  }
  
  if (num >= 100) {
    result += hundreds[Math.floor(num / 100)] + ' ';
    num %= 100;
  }
  
  if (num >= 10 && num < 20) {
    result += teens[num - 10] + ' ';
  } else {
    if (num >= 20) {
      result += tens[Math.floor(num / 10)] + ' ';
      num %= 10;
    }
    if (num > 0) {
      result += ones[num] + ' ';
    }
  }
  
  return result.trim();
}

// Full name to initials
function fullNameToInitials(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

// Date to Russian format
function dateToRussianFormat(dateStr: string): string {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const date = new Date(dateStr);
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function InvoiceActPreviewDialog({ open, onOpenChange, data, isLoading }: InvoiceActPreviewDialogProps) {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleDownloadPdf = async () => {
    if (!data) return;
    
    setIsGeneratingPdf(true);
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      // Helper for text
      const addText = (text: string, x: number, yPos: number, options?: { fontSize?: number; fontStyle?: string; maxWidth?: number; align?: 'left' | 'center' | 'right' }) => {
        const fontSize = options?.fontSize || 10;
        const fontStyle = options?.fontStyle || 'normal';
        pdf.setFontSize(fontSize);
        pdf.setFont('helvetica', fontStyle);
        
        if (options?.maxWidth) {
          const lines = pdf.splitTextToSize(text, options.maxWidth);
          const lineHeight = fontSize * 0.4;
          lines.forEach((line: string, i: number) => {
            let xPos = x;
            if (options?.align === 'center') {
              xPos = pageWidth / 2;
            } else if (options?.align === 'right') {
              xPos = pageWidth - margin;
            }
            pdf.text(line, xPos, yPos + i * lineHeight, { align: options?.align || 'left' });
          });
          return lines.length * lineHeight;
        }
        
        let xPos = x;
        if (options?.align === 'center') {
          xPos = pageWidth / 2;
        } else if (options?.align === 'right') {
          xPos = pageWidth - margin;
        }
        pdf.text(text, xPos, yPos, { align: options?.align || 'left' });
        return fontSize * 0.4;
      };

      // Header
      addText('оказанных услуг', 0, y, { fontSize: 10, align: 'right' });
      y += 15;

      // Title
      addText('СЧЁТ-АКТ', 0, y, { fontSize: 14, fontStyle: 'bold', align: 'center' });
      y += 6;
      addText(`№ ${data.documentNumber}`, 0, y, { fontSize: 12, align: 'center' });
      y += 6;
      addText(`г. Минск ${dateToRussianFormat(data.documentDate)} года`, 0, y, { fontSize: 10, align: 'center' });
      y += 12;

      // Client info
      const clientType = data.client.client_type || 'individual';
      let clientName = '';
      if (clientType === 'individual') {
        clientName = data.client.ind_full_name || data.client.name || 'Физическое лицо';
      } else if (clientType === 'entrepreneur') {
        clientName = data.client.ent_name || 'ИП';
      } else {
        clientName = data.client.leg_name || 'Юридическое лицо';
      }

      // Parties text
      const partiesText = `${data.executor.full_name}, именуемый в дальнейшем «Исполнитель», действующий на основании ${data.executor.acts_on_basis || 'Устава'}, с одной стороны и ${clientType === 'individual' ? `физическое лицо ${clientName}` : clientName}, именуемое в дальнейшем «Заказчик» с другой стороны, вместе именуемые «Стороны», составили настоящий счёт-акт (далее Счёт) о том, что:`;
      
      y += addText(partiesText, margin, y, { fontSize: 9, maxWidth: contentWidth });
      y += 8;

      // Terms
      const terms = [
        '1. Заказчик подтверждает, что ознакомлен с условиями публичного Договора, размещенного в сети интернет по адресу: http://gorbova.by/dokuments.',
        '2. Счёт является основанием для оплаты услуг Исполнителя и его оплата является акцептом публичного Договора, указанного в п. 1 настоящего счёт-акта.',
        '3. Стороны пришли к соглашению, что подписание Сторонами Счёта подтверждает оказание услуг Исполнителем в полном объёме. После подписания Заказчик и Исполнитель друг к другу претензий не имеют.',
        '4. Если Счёт составлен в валюте, то оплата его производится в белорусских рублях по курсу Национального Банка Республики Беларусь на дату проведения банком платежа.',
      ];

      terms.forEach(term => {
        y += addText(term, margin, y, { fontSize: 8, maxWidth: contentWidth });
        y += 3;
      });
      y += 5;

      // Table
      const serviceName = data.order.tariff_name 
        ? `${data.order.product_name} — ${data.order.tariff_name}`
        : data.order.product_name;
      const price = data.order.final_price;
      const currency = data.order.currency || 'BYN';

      // Table header
      const colWidths = [60, 20, 15, 25, 25, 15, 25];
      const tableHeaders = ['Наименование услуг', 'Ед.', 'Кол.', `Цена, ${currency}`, `Сумма, ${currency}`, 'НДС', `Итого, ${currency}`];
      
      let xPos = margin;
      pdf.setFontSize(7);
      pdf.setFont('helvetica', 'bold');
      
      tableHeaders.forEach((header, i) => {
        pdf.rect(xPos, y, colWidths[i], 8);
        pdf.text(header, xPos + 1, y + 5);
        xPos += colWidths[i];
      });
      y += 8;

      // Table row
      xPos = margin;
      pdf.setFont('helvetica', 'normal');
      const rowData = [serviceName.substring(0, 35), 'услуга', '1', price.toFixed(2), price.toFixed(2), '—', price.toFixed(2)];
      
      rowData.forEach((cell, i) => {
        pdf.rect(xPos, y, colWidths[i], 8);
        pdf.text(cell, xPos + 1, y + 5);
        xPos += colWidths[i];
      });
      y += 8;

      // Total row
      xPos = margin;
      pdf.setFont('helvetica', 'bold');
      const totalData = ['Итого:', '', '1', '', price.toFixed(2), '—', price.toFixed(2)];
      
      totalData.forEach((cell, i) => {
        pdf.rect(xPos, y, colWidths[i], 8);
        pdf.text(cell, xPos + 1, y + 5);
        xPos += colWidths[i];
      });
      y += 15;

      // Sum in words
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      const priceInWords = numberToWordsRu(Math.floor(price));
      addText('Сумма НДС: без НДС (согласно ст. 326 Налогового Кодекса Республики Беларусь).', margin, y);
      y += 6;
      addText(`Всего: ${priceInWords} ${currency === 'BYN' ? 'рублей' : currency}, 00 копеек.`, margin, y);
      y += 10;

      // Payment terms
      addText('Срок оплаты: 3 (три) рабочих дня.', margin, y, { fontSize: 9 });
      y += 5;
      addText('Срок оказания услуг: 5 (пять) рабочих дней с даты перечисления предоплаты Заказчиком.', margin, y, { fontSize: 9 });
      y += 12;

      // Client details
      pdf.setFont('helvetica', 'bold');
      addText('Заказчик:', margin, y, { fontSize: 9 });
      y += 5;
      pdf.setFont('helvetica', 'normal');
      addText(`${clientType === 'individual' ? 'Физическое лицо: ' : ''}${clientName}.`, margin, y, { fontSize: 9 });
      y += 4;
      const contactInfo = [data.client.phone ? `Телефон: ${data.client.phone}. ` : '', data.client.email ? `Электронная почта: ${data.client.email}.` : ''].filter(Boolean).join('');
      if (contactInfo) {
        addText(contactInfo, margin, y, { fontSize: 9 });
        y += 8;
      } else {
        y += 4;
      }

      // Executor details
      pdf.setFont('helvetica', 'bold');
      addText('ИСПОЛНИТЕЛЬ:', margin, y, { fontSize: 9 });
      y += 5;
      pdf.setFont('helvetica', 'normal');
      const executorName = data.executor.short_name || data.executor.full_name;
      addText(`${executorName}, УНП ${data.executor.unp}.`, margin, y, { fontSize: 9 });
      y += 4;
      addText(`Адрес: ${data.executor.legal_address}.`, margin, y, { fontSize: 9 });
      y += 4;
      addText(`Банковские реквизиты: расчетный счет ${data.executor.bank_account} в ${data.executor.bank_name}, код ${data.executor.bank_code}.`, margin, y, { fontSize: 9, maxWidth: contentWidth });
      y += 8;

      // Signatures
      if (y > pageHeight - 50) {
        pdf.addPage();
        y = margin;
      }
      
      pdf.setFont('helvetica', 'bold');
      addText('ПОДПИСИ СТОРОН:', margin, y, { fontSize: 9 });
      y += 10;

      // Client signature
      pdf.setFont('helvetica', 'normal');
      addText('Заказчик:', margin, y, { fontSize: 9 });
      addText('Исполнитель:', margin + contentWidth / 2, y, { fontSize: 9 });
      y += 5;
      
      addText(clientType === 'individual' ? 'физическое лицо' : clientName, margin, y, { fontSize: 8 });
      addText(data.executor.director_position || 'Директор', margin + contentWidth / 2, y, { fontSize: 8 });
      y += 15;
      
      pdf.line(margin, y, margin + 60, y);
      pdf.line(margin + contentWidth / 2, y, margin + contentWidth / 2 + 60, y);
      y += 4;
      
      const clientSignature = fullNameToInitials(clientName);
      const executorSignature = data.executor.director_short_name || fullNameToInitials(data.executor.director_full_name || '');
      addText(`/${clientSignature}/`, margin, y, { fontSize: 7 });
      addText(`/${executorSignature}/`, margin + contentWidth / 2, y, { fontSize: 7 });

      // Save PDF
      pdf.save(`Счёт-акт_${data.documentNumber}.pdf`);
    } catch (error) {
      console.error('PDF generation error:', error);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  if (!data && !isLoading) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle>
              {isLoading ? 'Формирование документа...' : `Счёт-акт № ${data?.documentNumber}`}
            </DialogTitle>
            {!isLoading && data && (
              <Button 
                onClick={handleDownloadPdf} 
                disabled={isGeneratingPdf}
                className="mr-8"
              >
                {isGeneratingPdf ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Скачать PDF
              </Button>
            )}
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto bg-muted/30 rounded-lg p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : data ? (
            <div 
              ref={contentRef}
              className="bg-white dark:bg-card p-8 rounded shadow-sm max-w-[210mm] mx-auto font-serif text-sm"
              style={{ minHeight: '297mm' }}
            >
              {/* Document Preview */}
              <div className="text-right mb-4 text-xs text-muted-foreground">
                оказанных услуг
              </div>
              
              <div className="text-center mb-6">
                <h1 className="text-lg font-bold">СЧЁТ-АКТ</h1>
                <p className="font-medium">№ {data.documentNumber}</p>
                <p className="text-sm">г. Минск {dateToRussianFormat(data.documentDate)} года</p>
              </div>

              <p className="text-justify mb-4 text-xs leading-relaxed">
                {data.executor.full_name}, именуемый в дальнейшем «Исполнитель», действующий на основании {data.executor.acts_on_basis || 'Устава'}, с одной стороны и {
                  (data.client.client_type || 'individual') === 'individual' 
                    ? `физическое лицо ${data.client.ind_full_name || data.client.name || 'Физическое лицо'}`
                    : data.client.ent_name || data.client.leg_name || 'Заказчик'
                }, именуемое в дальнейшем «Заказчик» с другой стороны, вместе именуемые «Стороны», составили настоящий счёт-акт (далее Счёт) о том, что:
              </p>

              <ol className="list-decimal pl-5 mb-6 text-xs space-y-1">
                <li>Заказчик подтверждает, что ознакомлен с условиями публичного Договора, размещенного в сети интернет по адресу: http://gorbova.by/dokuments.</li>
                <li>Счёт является основанием для оплаты услуг Исполнителя и его оплата является акцептом публичного Договора, указанного в п. 1 настоящего счёт-акта.</li>
                <li>Стороны пришли к соглашению, что подписание Сторонами Счёта подтверждает оказание услуг Исполнителем в полном объёме. После подписания Заказчик и Исполнитель друг к другу претензий не имеют.</li>
                <li>Если Счёт составлен в валюте, то оплата его производится в белорусских рублях по курсу Национального Банка Республики Беларусь на дату проведения банком платежа.</li>
              </ol>

              {/* Table */}
              <table className="w-full border-collapse text-[10px] mb-4">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="border border-border p-2 text-left">Наименование оказываемых услуг</th>
                    <th className="border border-border p-2">Ед.</th>
                    <th className="border border-border p-2">Кол.</th>
                    <th className="border border-border p-2">Цена без НДС, {data.order.currency}</th>
                    <th className="border border-border p-2">Сумма без НДС, {data.order.currency}</th>
                    <th className="border border-border p-2">НДС</th>
                    <th className="border border-border p-2">Сумма с НДС, {data.order.currency}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-border p-2">
                      {data.order.tariff_name 
                        ? `${data.order.product_name} — ${data.order.tariff_name}`
                        : data.order.product_name}
                    </td>
                    <td className="border border-border p-2 text-center">услуга</td>
                    <td className="border border-border p-2 text-center">1</td>
                    <td className="border border-border p-2 text-center">{data.order.final_price.toFixed(2)}</td>
                    <td className="border border-border p-2 text-center">{data.order.final_price.toFixed(2)}</td>
                    <td className="border border-border p-2 text-center">—</td>
                    <td className="border border-border p-2 text-center">{data.order.final_price.toFixed(2)}</td>
                  </tr>
                  <tr className="font-bold">
                    <td className="border border-border p-2">Итого:</td>
                    <td className="border border-border p-2"></td>
                    <td className="border border-border p-2 text-center">1</td>
                    <td className="border border-border p-2"></td>
                    <td className="border border-border p-2 text-center">{data.order.final_price.toFixed(2)}</td>
                    <td className="border border-border p-2 text-center">—</td>
                    <td className="border border-border p-2 text-center">{data.order.final_price.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              <p className="text-xs mb-2">
                Сумма НДС: без НДС (согласно ст. 326 Налогового Кодекса Республики Беларусь).
              </p>
              <p className="text-xs mb-4">
                Всего: {numberToWordsRu(Math.floor(data.order.final_price))} {data.order.currency === 'BYN' ? 'рублей' : data.order.currency}, 00 копеек.
              </p>

              <p className="text-xs mb-1">Срок оплаты: 3 (три) рабочих дня.</p>
              <p className="text-xs mb-6">Срок оказания услуг: 5 (пять) рабочих дней с даты перечисления предоплаты Заказчиком.</p>

              {/* Details */}
              <div className="text-xs mb-4">
                <p className="font-bold">Заказчик:</p>
                <p>
                  {(data.client.client_type || 'individual') === 'individual' ? 'Физическое лицо: ' : ''}
                  {data.client.ind_full_name || data.client.ent_name || data.client.leg_name || data.client.name || 'Заказчик'}.
                </p>
                {(data.client.phone || data.client.email) && (
                  <p>
                    {data.client.phone && `Телефон: ${data.client.phone}. `}
                    {data.client.email && `Электронная почта: ${data.client.email}.`}
                  </p>
                )}
              </div>

              <div className="text-xs mb-6">
                <p className="font-bold">ИСПОЛНИТЕЛЬ:</p>
                <p>{data.executor.short_name || data.executor.full_name}, УНП {data.executor.unp}.</p>
                <p>Адрес: {data.executor.legal_address}.</p>
                <p>Банковские реквизиты: расчетный счет {data.executor.bank_account} в {data.executor.bank_name}, код {data.executor.bank_code}.</p>
                {(data.executor.phone || data.executor.email) && (
                  <p>
                    Контактные данные: 
                    {data.executor.phone && ` телефон ${data.executor.phone}`}
                    {data.executor.email && `, электронная почта ${data.executor.email}`}.
                  </p>
                )}
              </div>

              {/* Signatures */}
              <div className="flex justify-between mt-8 text-xs">
                <div className="w-[45%]">
                  <p className="font-bold mb-2">ПОДПИСИ СТОРОН:</p>
                  <p>Заказчик:</p>
                  <p className="text-[10px]">
                    {(data.client.client_type || 'individual') === 'individual' ? 'физическое лицо' : (data.client.ent_name || data.client.leg_name || '')}
                  </p>
                  <div className="border-b border-foreground mt-8 mb-1"></div>
                  <p className="text-[9px]">
                    /{fullNameToInitials(data.client.ind_full_name || data.client.ent_name || data.client.leg_director_name || data.client.name || '')}/
                  </p>
                </div>
                <div className="w-[45%]">
                  <p className="invisible mb-2">.</p>
                  <p>Исполнитель:</p>
                  <p className="text-[10px]">{data.executor.director_position || 'Директор'}</p>
                  <div className="border-b border-foreground mt-8 mb-1"></div>
                  <p className="text-[9px]">
                    /{data.executor.director_short_name || fullNameToInitials(data.executor.director_full_name || '')}/
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
