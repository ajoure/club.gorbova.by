/**
 * DocumentsHowItWorks — короткая инструкция для админа,
 * как работает новый генератор документов. Раскрывающийся блок.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";

export function DocumentsHowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-blue-200 bg-blue-50/40">
      <CardContent className="p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 h-8"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <HelpCircle className="h-4 w-4 text-blue-600" />
          <span className="font-medium text-blue-900">Как работает генерация документов</span>
        </Button>
        {open && (
          <ol className="mt-3 space-y-1.5 text-sm text-blue-900/90 list-decimal list-inside pl-2">
            <li>Загрузите Word-шаблон (DOCX) на вкладке «Шаблоны документов».</li>
            <li>Вставьте в шаблон плейсхолдеры вида <code className="bg-blue-100 px-1 rounded">{`{{customer.name}}`}</code>, <code className="bg-blue-100 px-1 rounded">{`{{deal.amount}}`}</code>, <code className="bg-blue-100 px-1 rounded">{`{{document.date}}`}</code>.</li>
            <li>Проверьте шаблон на вкладке «Связи плейсхолдеров» — система покажет, какие поля найдены и какие нужно сопоставить.</li>
            <li>На вкладке «Акты выполненных работ» выберите шаблон и заказ или реквизиты клиента.</li>
            <li>Нажмите «Предпросмотр данных», чтобы увидеть, что будет подставлено в документ.</li>
            <li>Если все обязательные поля заполнены — нажмите «Сформировать DOCX».</li>
            <li>Готовый документ сохранится в истории вместе со слепком данных на момент генерации.</li>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
