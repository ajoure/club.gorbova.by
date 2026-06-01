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
            <li>Загрузите Word-файл шаблона на вкладке «Шаблоны документов».</li>
            <li>Разметьте в шаблоне поля для подстановки — например, наименование клиента, сумма заказа, дата документа.</li>
            <li>Откройте «Проверка и исправление полей» — система покажет, какие поля распознаны и какие нужно поправить, прежде чем активировать шаблон.</li>
            <li>В карточке сделки на вкладке «Документы» выберите нужный шаблон и заказ или реквизиты клиента.</li>
            <li>Нажмите «Тест», чтобы увидеть, что будет подставлено в документ.</li>
            <li>Если все обязательные поля заполнены — нажмите «Сформировать» или «Создать PDF».</li>
            <li>Готовый документ появится в истории вместе со снимком данных на момент формирования.</li>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
