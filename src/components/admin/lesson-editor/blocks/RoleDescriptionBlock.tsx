import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { SafeHtml } from "@/components/ui/SafeHtml";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRight, User, Briefcase, Building2 } from "lucide-react";

export interface RoleDescriptionContent {
  executor_html: string;      // Роль A - бухгалтер-исполнитель
  freelancer_html: string;    // Роль Б - бухгалтер-фрилансер
  entrepreneur_html: string;  // Роль В - бухгалтер-предприниматель
  buttonText: string;
}

interface RoleDescriptionBlockProps {
  content: RoleDescriptionContent;
  onChange: (content: RoleDescriptionContent) => void;
  isEditing?: boolean;
  // Player mode props
  userRole?: string;
  onComplete?: () => void;
  isCompleted?: boolean;
}

const DEFAULT_CONTENT: RoleDescriptionContent = {
  executor_html: '<h3>Бухгалтер-исполнитель</h3><p>Вы работаете в найме или выполняете задачи под чётким руководством...</p>',
  freelancer_html: '<h3>Бухгалтер-фрилансер</h3><p>Вы работаете с несколькими клиентами напрямую...</p>',
  entrepreneur_html: '<h3>Бухгалтер-предприниматель</h3><p>Вы строите бизнес на бухгалтерских услугах...</p>',
  buttonText: 'Перейти к видео',
};

const ROLE_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  'А': { icon: User, label: 'Исполнитель', color: 'bg-primary/10 text-primary' },
  'Б': { icon: Briefcase, label: 'Фрилансер', color: 'bg-secondary/10 text-secondary-foreground' },
  'В': { icon: Building2, label: 'Предприниматель', color: 'bg-accent/10 text-accent-foreground' },
  // Alternative mappings
  'executor': { icon: User, label: 'Исполнитель', color: 'bg-primary/10 text-primary' },
  'freelancer': { icon: Briefcase, label: 'Фрилансер', color: 'bg-secondary/10 text-secondary-foreground' },
  'entrepreneur': { icon: Building2, label: 'Предприниматель', color: 'bg-accent/10 text-accent-foreground' },
};

export function RoleDescriptionBlock({ 
  content = DEFAULT_CONTENT, 
  onChange, 
  isEditing = true,
  userRole,
  onComplete,
  isCompleted = false
}: RoleDescriptionBlockProps) {
  const [activeTab, setActiveTab] = useState<string>('executor');

  // Get HTML content based on user role
  const getRoleContent = (): string => {
    if (!userRole) return '';
    
    // Map role category to content field
    if (userRole === 'А' || userRole.toLowerCase().includes('исполнител') || userRole === 'executor') {
      return content.executor_html || '';
    }
    if (userRole === 'Б' || userRole.toLowerCase().includes('фриланс') || userRole === 'freelancer') {
      return content.freelancer_html || '';
    }
    if (userRole === 'В' || userRole.toLowerCase().includes('предприниматель') || userRole === 'entrepreneur') {
      return content.entrepreneur_html || '';
    }
    
    // Default to first non-empty content
    return content.executor_html || content.freelancer_html || content.entrepreneur_html || '';
  };

  const roleConfig = userRole ? ROLE_CONFIG[userRole] || ROLE_CONFIG['А'] : null;

  if (isEditing) {
    return (
      <div className="space-y-4">
        <Label className="text-base font-medium">Описание ролей</Label>
        <p className="text-sm text-muted-foreground">
          Контент отображается в зависимости от результата теста (роль А, Б или В)
        </p>
        
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="executor" className="gap-2">
              <User className="h-4 w-4" />
              Роль А
            </TabsTrigger>
            <TabsTrigger value="freelancer" className="gap-2">
              <Briefcase className="h-4 w-4" />
              Роль Б
            </TabsTrigger>
            <TabsTrigger value="entrepreneur" className="gap-2">
              <Building2 className="h-4 w-4" />
              Роль В
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="executor" className="space-y-2">
            <Label>Бухгалтер-исполнитель (HTML)</Label>
            <RichTextarea
              value={content.executor_html || ''}
              onChange={(html) => onChange({ ...content, executor_html: html })}
              placeholder="Описание роли исполнителя..."
              minHeight="120px"
            />
          </TabsContent>
          
          <TabsContent value="freelancer" className="space-y-2">
            <Label>Бухгалтер-фрилансер (HTML)</Label>
            <RichTextarea
              value={content.freelancer_html || ''}
              onChange={(html) => onChange({ ...content, freelancer_html: html })}
              placeholder="Описание роли фрилансера..."
              minHeight="120px"
            />
          </TabsContent>
          
          <TabsContent value="entrepreneur" className="space-y-2">
            <Label>Бухгалтер-предприниматель (HTML)</Label>
            <RichTextarea
              value={content.entrepreneur_html || ''}
              onChange={(html) => onChange({ ...content, entrepreneur_html: html })}
              placeholder="Описание роли предпринимателя..."
              minHeight="120px"
            />
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <Label>Текст кнопки</Label>
          <RichTextarea
            value={content.buttonText || ''}
            onChange={(html) => onChange({ ...content, buttonText: html })}
            placeholder="Перейти к видео"
            inline
          />
        </div>
      </div>
    );
  }

  // Player mode
  const roleContent = getRoleContent();
  const RoleIcon = roleConfig?.icon || User;

  if (!userRole) {
    return (
      <Card className="py-8 text-center">
        <p className="text-muted-foreground">Сначала пройдите тест для определения роли</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Role badge */}
      <div className="flex items-center gap-2">
        <Badge className={`${roleConfig?.color || ''} gap-1.5 px-3 py-1`}>
          <RoleIcon className="h-4 w-4" />
          {roleConfig?.label || userRole}
        </Badge>
      </div>

      {/* Role description content - Glass Card */}
      <div 
        className="rounded-2xl backdrop-blur-xl border border-border/40 shadow-lg overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--card) / 0.6), hsl(var(--card) / 0.3))",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.08), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
        }}
      >
        <div className="p-6">
          <div 
            className="prose prose-sm max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: roleContent }}
          />
        </div>
      </div>

      {/* Action button with gradient */}
      {!isCompleted ? (
        <Button 
          onClick={onComplete} 
          className="w-full bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25 border-0"
        >
          {content.buttonText || 'Перейти к видео'}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      ) : (
        <div 
          className="flex items-center justify-center gap-2 text-primary py-3 rounded-xl backdrop-blur-sm"
          style={{
            background: "linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.05))"
          }}
        >
          <ArrowRight className="h-5 w-5" />
          <span className="font-medium">Продолжайте к следующему шагу</span>
        </div>
      )}
    </div>
  );
}
