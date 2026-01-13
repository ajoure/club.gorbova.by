import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ImageIcon, Plus, Trash2, Check, X, RotateCcw, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HotspotArea {
  id: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  radius: number; // percentage of image width
  label?: string;
}

export interface QuizHotspotContent {
  question: string;
  imageUrl: string;
  correctAreas: HotspotArea[];
  allowMultiple?: boolean;
  tolerance?: number; // percentage tolerance for click
  explanation?: string;
  points?: number;
}

// Sprint A+B: Unified answer interface (meta stored in DB columns, not in response)
interface HotspotAnswer {
  clicks: Array<{ x: number; y: number }>;
  is_submitted?: boolean;
  submitted_at?: string;
}

interface QuizHotspotBlockProps {
  content: QuizHotspotContent;
  onChange: (content: QuizHotspotContent) => void;
  isEditing?: boolean;
  blockId?: string;
  savedAnswer?: HotspotAnswer;
  isSubmitted?: boolean;
  attempts?: number;
  onSubmit?: (answer: HotspotAnswer, isCorrect: boolean, score: number, maxScore: number) => void;
  onReset?: () => void;
}

export function QuizHotspotBlock({
  content,
  onChange,
  isEditing = true,
  blockId,
  savedAnswer,
  isSubmitted,
  attempts,
  onSubmit,
  onReset,
}: QuizHotspotBlockProps) {
  const areas = content.correctAreas || [];
  const tolerance = content.tolerance || 5;
  const allowMultiple = content.allowMultiple ?? false;
  
  const [clicks, setClicks] = useState<Array<{ x: number; y: number }>>([]);
  const [localUrl, setLocalUrl] = useState(content.imageUrl || "");
  const imageRef = useRef<HTMLDivElement>(null);

  // Restore saved answer
  useEffect(() => {
    if (savedAnswer?.clicks) {
      setClicks(savedAnswer.clicks);
    }
  }, [savedAnswer]);

  const getClickPosition = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    return { x, y };
  };

  const isClickInArea = (click: { x: number; y: number }, area: HotspotArea): boolean => {
    const dx = click.x - area.x;
    const dy = click.y - area.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance <= area.radius + tolerance;
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSubmitted) return;
    
    const pos = getClickPosition(e);
    
    if (isEditing) {
      // In editor mode, add a new area
      const newArea: HotspotArea = {
        id: crypto.randomUUID(),
        x: pos.x,
        y: pos.y,
        radius: 5,
        label: "",
      };
      onChange({ ...content, correctAreas: [...areas, newArea] });
    } else {
      // In student mode, record click
      if (allowMultiple) {
        setClicks([...clicks, pos]);
      } else {
        setClicks([pos]);
      }
    }
  };

  // Sprint A+B: Fixed correctness check with proper allowMultiple semantics
  const checkCorrectness = (): { isCorrect: boolean; correctCount: number; matchedAreas: Set<string> } => {
    const matchedAreas = new Set<string>();
    
    clicks.forEach(click => {
      areas.forEach(area => {
        if (isClickInArea(click, area)) {
          matchedAreas.add(area.id);
        }
      });
    });

    const correctCount = matchedAreas.size;
    
    let isCorrect: boolean;
    if (allowMultiple) {
      // allowMultiple=true: all areas must be found (extra clicks don't break correctness)
      isCorrect = matchedAreas.size === areas.length;
    } else {
      // allowMultiple=false: exactly one click, must hit at least one area
      isCorrect = clicks.length === 1 && matchedAreas.size >= 1;
    }
    
    return { isCorrect, correctCount, matchedAreas };
  };

  // Sprint A+B: Updated submit with unified response format
  const handleSubmit = () => {
    if (!onSubmit || clicks.length === 0) return;
    
    const { isCorrect, correctCount } = checkCorrectness();
    const maxScore = content.points || areas.length;
    const score = (maxScore === areas.length)
      ? correctCount
      : Math.floor((correctCount / areas.length) * maxScore);
    
    const answer: HotspotAnswer = {
      clicks,
      is_submitted: true,
      submitted_at: new Date().toISOString(),
    };
    
    onSubmit(answer, isCorrect, score, maxScore);
  };

  const handleReset = () => {
    setClicks([]);
    onReset?.();
  };

  const updateArea = (id: string, field: keyof HotspotArea, value: string | number) => {
    onChange({
      ...content,
      correctAreas: areas.map((area) => 
        area.id === id ? { ...area, [field]: value } : area
      ),
    });
  };

  const removeArea = (id: string) => {
    onChange({ ...content, correctAreas: areas.filter((area) => area.id !== id) });
  };

  const handleUrlBlur = () => {
    onChange({ ...content, imageUrl: localUrl });
  };

  // Student view
  if (!isEditing) {
    const { correctCount, matchedAreas, isCorrect: allCorrect } = isSubmitted 
      ? checkCorrectness() 
      : { correctCount: 0, matchedAreas: new Set<string>(), isCorrect: false };

    return (
      <div className="space-y-4 p-4 rounded-xl bg-card/30 backdrop-blur-sm border">
        <div className="font-medium text-lg">{content.question || "Нажмите на правильную область"}</div>

        {content.imageUrl ? (
          <div 
            ref={imageRef}
            className={cn(
              "relative cursor-crosshair rounded-lg overflow-hidden",
              isSubmitted && "cursor-default"
            )}
            onClick={handleImageClick}
          >
            <img 
              src={content.imageUrl} 
              alt="Hotspot quiz" 
              className="w-full"
              draggable={false}
            />
            
            {/* Show user clicks */}
            {clicks.map((click, index) => {
              const isInCorrectArea = areas.some(area => isClickInArea(click, area));
              return (
                <div
                  key={index}
                  className={cn(
                    "absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-2 flex items-center justify-center transition-colors",
                    isSubmitted && isInCorrectArea && "bg-green-500/50 border-green-500",
                    isSubmitted && !isInCorrectArea && "bg-red-500/50 border-red-500",
                    !isSubmitted && "bg-primary/50 border-primary"
                  )}
                  style={{ left: `${click.x}%`, top: `${click.y}%` }}
                >
                  {isSubmitted && (
                    isInCorrectArea ? (
                      <Check className="h-4 w-4 text-white" />
                    ) : (
                      <X className="h-4 w-4 text-white" />
                    )
                  )}
                </div>
              );
            })}

            {/* Show correct areas after submission */}
            {isSubmitted && areas.map((area) => {
              const isMatched = matchedAreas.has(area.id);
              return (
                <div
                  key={area.id}
                  className={cn(
                    "absolute rounded-full border-2 border-dashed",
                    isMatched ? "border-green-500" : "border-amber-500"
                  )}
                  style={{
                    left: `${area.x}%`,
                    top: `${area.y}%`,
                    width: `${area.radius * 2}%`,
                    height: `${area.radius * 2}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {area.label && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs bg-background px-2 py-0.5 rounded border">
                      {area.label}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 bg-muted rounded-lg">
            <ImageIcon className="h-12 w-12 text-muted-foreground" />
          </div>
        )}

        <div className="text-sm text-muted-foreground text-center">
          {allowMultiple 
            ? `Выбрано точек: ${clicks.length}` 
            : clicks.length > 0 
              ? "Нажмите в другое место, чтобы изменить выбор" 
              : "Нажмите на изображение"
          }
        </div>

        {!isSubmitted ? (
          <Button onClick={handleSubmit} disabled={clicks.length === 0} className="w-full">
            Проверить ответ
          </Button>
        ) : (
          <div className="space-y-3">
            <div className={cn(
              "flex items-center gap-2 p-3 rounded-lg",
              allCorrect ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"
            )}>
              {allCorrect ? (
                <>
                  <Check className="h-5 w-5" />
                  <span className="font-medium">Правильно!</span>
                </>
              ) : (
                <>
                  <X className="h-5 w-5" />
                  <span className="font-medium">
                    Найдено {correctCount} из {areas.length} областей
                  </span>
                </>
              )}
            </div>

            {content.explanation && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <span className="font-medium">Пояснение: </span>
                {content.explanation}
              </div>
            )}

            {onReset && (
              <Button variant="outline" onClick={handleReset} className="w-full">
                <RotateCcw className="h-4 w-4 mr-2" />
                Попробовать снова
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Editor view
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Вопрос / Инструкция</Label>
        <Textarea
          value={content.question || ""}
          onChange={(e) => onChange({ ...content, question: e.target.value })}
          placeholder="Нажмите на область, которая..."
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label>URL изображения</Label>
        <Input
          value={localUrl}
          onChange={(e) => setLocalUrl(e.target.value)}
          onBlur={handleUrlBlur}
          placeholder="https://..."
        />
      </div>

      {content.imageUrl && (
        <div className="space-y-2">
          <Label>
            Правильные области 
            <span className="text-xs text-muted-foreground ml-2">
              (кликните на изображение, чтобы добавить)
            </span>
          </Label>
          
          <div 
            className="relative cursor-crosshair rounded-lg overflow-hidden border"
            onClick={handleImageClick}
          >
            <img 
              src={content.imageUrl} 
              alt="Editor preview" 
              className="w-full"
              draggable={false}
            />
            
            {areas.map((area, index) => (
              <div
                key={area.id}
                className="absolute rounded-full border-2 border-primary bg-primary/20"
                style={{
                  left: `${area.x}%`,
                  top: `${area.y}%`,
                  width: `${area.radius * 2}%`,
                  height: `${area.radius * 2}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
                  {index + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {areas.length > 0 && (
        <div className="space-y-2">
          <Label>Настройки областей</Label>
          <div className="space-y-2">
            {areas.map((area, index) => (
              <div key={area.id} className="flex items-center gap-2 p-2 rounded border bg-muted/30">
                <Target className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-sm font-medium w-6">#{index + 1}</span>
                <Input
                  value={area.label || ''}
                  onChange={(e) => updateArea(area.id, 'label', e.target.value)}
                  placeholder="Подпись..."
                  className="flex-1 h-8 text-sm"
                />
                <div className="flex items-center gap-1">
                  <Label className="text-xs">Радиус:</Label>
                  <Input
                    type="number"
                    value={area.radius}
                    onChange={(e) => updateArea(area.id, 'radius', parseFloat(e.target.value) || 5)}
                    className="w-16 h-8 text-sm"
                    min={2}
                    max={20}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeArea(area.id)}
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <Switch
            checked={allowMultiple}
            onCheckedChange={(checked) => onChange({ ...content, allowMultiple: checked })}
          />
          <Label className="text-sm">Несколько кликов</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Допуск:</Label>
          <Input
            type="number"
            value={content.tolerance || 5}
            onChange={(e) => onChange({ ...content, tolerance: parseFloat(e.target.value) || 5 })}
            className="w-16 h-8 text-sm"
            min={1}
            max={15}
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Пояснение (показывается после ответа)</Label>
        <Textarea
          value={content.explanation || ""}
          onChange={(e) => onChange({ ...content, explanation: e.target.value })}
          placeholder="Объяснение правильного ответа..."
          rows={2}
        />
      </div>

      <div className="flex items-center gap-2">
        <Label>Баллы:</Label>
        <Input
          type="number"
          value={content.points || areas.length || 1}
          onChange={(e) => onChange({ ...content, points: parseInt(e.target.value) || 1 })}
          className="w-20"
          min={1}
        />
      </div>
    </div>
  );
}