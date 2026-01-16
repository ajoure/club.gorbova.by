import { useState, useMemo } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Input } from "@/components/ui/input";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { TrendingUp, TrendingDown, Wallet } from "lucide-react";

interface CashFlowItem {
  id: string;
  category: string;
  plan: number;
  fact: number;
}

interface CashFlowSection {
  type: 'income' | 'expense';
  title: string;
  items: CashFlowItem[];
}

const initialData: CashFlowSection[] = [
  {
    type: 'income',
    title: 'Доходы',
    items: [
      { id: 'income-1', category: 'Основной бизнес', plan: 0, fact: 0 },
      { id: 'income-2', category: 'Инвестиции', plan: 0, fact: 0 },
      { id: 'income-3', category: 'Прочее', plan: 0, fact: 0 },
    ]
  },
  {
    type: 'expense',
    title: 'Расходы',
    items: [
      { id: 'expense-1', category: 'Жилье', plan: 0, fact: 0 },
      { id: 'expense-2', category: 'Еда', plan: 0, fact: 0 },
      { id: 'expense-3', category: 'Транспорт', plan: 0, fact: 0 },
      { id: 'expense-4', category: 'Обучение', plan: 0, fact: 0 },
      { id: 'expense-5', category: 'Семья', plan: 0, fact: 0 },
    ]
  }
];

export function CashFlowTable() {
  const [sections, setSections] = useState<CashFlowSection[]>(initialData);

  const updateValue = (
    sectionType: 'income' | 'expense',
    itemId: string,
    field: 'plan' | 'fact',
    value: number
  ) => {
    setSections(prev => prev.map(section => {
      if (section.type !== sectionType) return section;
      return {
        ...section,
        items: section.items.map(item => {
          if (item.id !== itemId) return item;
          return { ...item, [field]: value };
        })
      };
    }));
  };

  const totals = useMemo(() => {
    const income = sections.find(s => s.type === 'income');
    const expense = sections.find(s => s.type === 'expense');
    
    const incomePlanTotal = income?.items.reduce((sum, item) => sum + item.plan, 0) || 0;
    const incomeFactTotal = income?.items.reduce((sum, item) => sum + item.fact, 0) || 0;
    
    const expensePlanTotal = expense?.items.reduce((sum, item) => sum + item.plan, 0) || 0;
    const expenseFactTotal = expense?.items.reduce((sum, item) => sum + item.fact, 0) || 0;
    
    return {
      income: { plan: incomePlanTotal, fact: incomeFactTotal, deviation: incomeFactTotal - incomePlanTotal },
      expense: { plan: expensePlanTotal, fact: expenseFactTotal, deviation: expenseFactTotal - expensePlanTotal },
      balance: {
        plan: incomePlanTotal - expensePlanTotal,
        fact: incomeFactTotal - expenseFactTotal,
        deviation: (incomeFactTotal - expenseFactTotal) - (incomePlanTotal - expensePlanTotal),
      }
    };
  }, [sections]);

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const getDeviationColor = (deviation: number, type: 'income' | 'expense') => {
    if (deviation === 0) return 'text-muted-foreground';
    
    if (type === 'income') {
      // For income: positive deviation (fact > plan) is good (green)
      return deviation > 0 ? 'text-emerald-500' : 'text-rose-500';
    } else {
      // For expense: positive deviation (fact > plan) is bad (red = overspend)
      return deviation > 0 ? 'text-rose-500' : 'text-emerald-500';
    }
  };

  const renderSection = (section: CashFlowSection) => {
    const sectionTotals = totals[section.type];
    const isIncome = section.type === 'income';
    
    return (
      <div key={section.type} className="space-y-2">
        {/* Section Header */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
          isIncome 
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
            : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
        }`}>
          {isIncome 
            ? <TrendingUp className="h-4 w-4" />
            : <TrendingDown className="h-4 w-4" />
          }
          <span className="font-semibold">{section.title}</span>
        </div>
        
        {/* Section Items */}
        <div className="overflow-hidden rounded-lg border border-border/50">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-[200px]">Категория</TableHead>
                <TableHead className="w-[140px] text-right">План</TableHead>
                <TableHead className="w-[140px] text-right">Факт</TableHead>
                <TableHead className="w-[140px] text-right">Отклонение</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.items.map((item) => {
                const deviation = item.fact - item.plan;
                return (
                  <TableRow key={item.id} className="hover:bg-muted/20">
                    <TableCell className="font-medium">{item.category}</TableCell>
                    <TableCell className="text-right p-1">
                      <Input
                        type="number"
                        value={item.plan || ''}
                        onChange={(e) => updateValue(section.type, item.id, 'plan', parseFloat(e.target.value) || 0)}
                        className="h-8 text-right bg-background/50 border-border/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell className="text-right p-1">
                      <Input
                        type="number"
                        value={item.fact || ''}
                        onChange={(e) => updateValue(section.type, item.id, 'fact', parseFloat(e.target.value) || 0)}
                        className="h-8 text-right bg-background/50 border-border/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell className={`text-right font-medium ${getDeviationColor(deviation, section.type)}`}>
                      {deviation !== 0 && (deviation > 0 ? '+' : '')}{formatNumber(deviation)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Section Total Row */}
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell>Итого {section.title.toLowerCase()}</TableCell>
                <TableCell className="text-right">{formatNumber(sectionTotals.plan)}</TableCell>
                <TableCell className="text-right">{formatNumber(sectionTotals.fact)}</TableCell>
                <TableCell className={`text-right ${getDeviationColor(sectionTotals.deviation, section.type)}`}>
                  {sectionTotals.deviation !== 0 && (sectionTotals.deviation > 0 ? '+' : '')}
                  {formatNumber(sectionTotals.deviation)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Intro */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Wallet className="h-4 w-4" />
        <span>Учет личных доходов и расходов. Введите плановые и фактические значения.</span>
      </div>
      
      {/* Tables */}
      <div className="space-y-6">
        {sections.map(renderSection)}
      </div>
      
      {/* Overall Balance */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              totals.balance.fact >= 0 
                ? 'bg-emerald-500/10 text-emerald-500' 
                : 'bg-rose-500/10 text-rose-500'
            }`}>
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">Сальдо (Баланс)</div>
              <div className="text-xs text-muted-foreground">
                Доходы − Расходы
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-8 text-right">
            <div>
              <div className="text-xs text-muted-foreground mb-1">План</div>
              <div className={`font-bold text-lg ${totals.balance.plan >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {formatNumber(totals.balance.plan)} BYN
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Факт</div>
              <div className={`font-bold text-lg ${totals.balance.fact >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {formatNumber(totals.balance.fact)} BYN
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Отклонение</div>
              <div className={`font-bold text-lg ${
                totals.balance.deviation >= 0 ? 'text-emerald-500' : 'text-rose-500'
              }`}>
                {totals.balance.deviation !== 0 && (totals.balance.deviation > 0 ? '+' : '')}
                {formatNumber(totals.balance.deviation)} BYN
              </div>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}
