import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { GlassCard } from "@/components/ui/GlassCard";
import { Plus, Trash2, RotateCcw, ClipboardList, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface SurveyOption {
  id: string;
  text: string;
  category: string;
}

interface SurveyQuestion {
  id: string;
  question: string;
  options: SurveyOption[];
}

interface SurveyResult {
  category: string;
  title: string;
  description: string;
  color?: string;
}

interface SurveyMixedResult {
  categories: string[];
  title: string;
  description: string;
  color?: string;
}

export interface QuizSurveyContentData {
  title?: string;
  instruction?: string;
  questions: SurveyQuestion[];
  results: SurveyResult[];
  mixedResults?: SurveyMixedResult[];
  buttonText?: string;
}

interface QuizSurveyBlockProps {
  content: QuizSurveyContentData;
  onChange: (content: QuizSurveyContentData) => void;
  isEditing?: boolean;
  // Student view props
  blockId?: string;
  savedAnswer?: { answers?: Record<string, string>; isCompleted?: boolean };
  isSubmitted?: boolean;
  onSubmit?: (answer: Record<string, unknown>, isCorrect: boolean, score: number, maxScore: number) => void;
  onReset?: () => void;
}

const defaultContent: QuizSurveyContentData = {
  title: "",
  instruction: "",
  questions: [],
  results: [],
  mixedResults: [],
  buttonText: "Узнать результат",
};

const colorMap: Record<string, { bg: string; border: string; text: string }> = {
  blue: { bg: "bg-blue-500/10", border: "border-blue-500/30", text: "text-blue-600" },
  amber: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-600" },
  green: { bg: "bg-green-500/10", border: "border-green-500/30", text: "text-green-600" },
  red: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-600" },
  purple: { bg: "bg-purple-500/10", border: "border-purple-500/30", text: "text-purple-600" },
};

export function QuizSurveyBlock({
  content: rawContent,
  onChange,
  isEditing = true,
  blockId,
  savedAnswer,
  isSubmitted: externalIsSubmitted,
  onSubmit,
  onReset,
}: QuizSurveyBlockProps) {
  const content = { ...defaultContent, ...rawContent };
  
  // Student view state - restore from savedAnswer on mount
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // Restore answers from saved data
    return savedAnswer?.answers || {};
  });
  const [showResults, setShowResults] = useState(() => {
    // Restore completed state
    return externalIsSubmitted || savedAnswer?.isCompleted || false;
  });
  
  // Sync with savedAnswer when it changes (e.g., after page reload with data from DB)
  useEffect(() => {
    if (savedAnswer?.answers && Object.keys(savedAnswer.answers).length > 0) {
      setAnswers(savedAnswer.answers);
    }
    if (savedAnswer?.isCompleted || externalIsSubmitted) {
      setShowResults(true);
    }
  }, [savedAnswer, externalIsSubmitted]);

  const allQuestionsAnswered = useMemo(() => {
    return content.questions.every((q) => answers[q.id]);
  }, [content.questions, answers]);

  const categoryScores = useMemo(() => {
    const scores: Record<string, number> = {};
    content.questions.forEach((q) => {
      const answerId = answers[q.id];
      if (answerId) {
        const option = q.options.find((o) => o.id === answerId);
        if (option) {
          scores[option.category] = (scores[option.category] || 0) + 1;
        }
      }
    });
    return scores;
  }, [answers, content.questions]);

  const dominantCategories = useMemo(() => {
    const entries = Object.entries(categoryScores);
    if (entries.length === 0) return [];
    const maxScore = Math.max(...entries.map(([, v]) => v));
    return entries.filter(([, v]) => v === maxScore).map(([k]) => k);
  }, [categoryScores]);

  const resultToShow = useMemo(() => {
    if (dominantCategories.length === 0) return null;
    
    // Check for mixed result first
    if (dominantCategories.length > 1 && content.mixedResults) {
      const mixed = content.mixedResults.find((m) =>
        m.categories.every((c) => dominantCategories.includes(c)) &&
        dominantCategories.every((c) => m.categories.includes(c))
      );
      if (mixed) return { ...mixed, isMixed: true };
    }
    
    // Single dominant category
    const result = content.results.find((r) => r.category === dominantCategories[0]);
    return result ? { ...result, isMixed: false } : null;
  }, [dominantCategories, content.results, content.mixedResults]);

  // Editor handlers
  const updateContent = (updates: Partial<QuizSurveyContentData>) => {
    onChange({ ...content, ...updates });
  };

  const addQuestion = () => {
    const newQ: SurveyQuestion = {
      id: `q${Date.now()}`,
      question: "",
      options: [
        { id: `o${Date.now()}a`, text: "", category: "A" },
        { id: `o${Date.now()}b`, text: "", category: "B" },
        { id: `o${Date.now()}c`, text: "", category: "C" },
      ],
    };
    updateContent({ questions: [...content.questions, newQ] });
  };

  const updateQuestion = (qIndex: number, updates: Partial<SurveyQuestion>) => {
    const updated = [...content.questions];
    updated[qIndex] = { ...updated[qIndex], ...updates };
    updateContent({ questions: updated });
  };

  const deleteQuestion = (qIndex: number) => {
    updateContent({ questions: content.questions.filter((_, i) => i !== qIndex) });
  };

  const addOption = (qIndex: number) => {
    const updated = [...content.questions];
    updated[qIndex].options.push({
      id: `o${Date.now()}`,
      text: "",
      category: "",
    });
    updateContent({ questions: updated });
  };

  const updateOption = (qIndex: number, oIndex: number, updates: Partial<SurveyOption>) => {
    const updated = [...content.questions];
    updated[qIndex].options[oIndex] = { ...updated[qIndex].options[oIndex], ...updates };
    updateContent({ questions: updated });
  };

  const deleteOption = (qIndex: number, oIndex: number) => {
    const updated = [...content.questions];
    updated[qIndex].options = updated[qIndex].options.filter((_, i) => i !== oIndex);
    updateContent({ questions: updated });
  };

  const addResult = () => {
    const newR: SurveyResult = {
      category: "",
      title: "",
      description: "",
      color: "blue",
    };
    updateContent({ results: [...content.results, newR] });
  };

  const updateResult = (rIndex: number, updates: Partial<SurveyResult>) => {
    const updated = [...content.results];
    updated[rIndex] = { ...updated[rIndex], ...updates };
    updateContent({ results: updated });
  };

  const deleteResult = (rIndex: number) => {
    updateContent({ results: content.results.filter((_, i) => i !== rIndex) });
  };

  const addMixedResult = () => {
    const newM: SurveyMixedResult = {
      categories: [],
      title: "",
      description: "",
    };
    updateContent({ mixedResults: [...(content.mixedResults || []), newM] });
  };

  const updateMixedResult = (mIndex: number, updates: Partial<SurveyMixedResult>) => {
    const updated = [...(content.mixedResults || [])];
    updated[mIndex] = { ...updated[mIndex], ...updates };
    updateContent({ mixedResults: updated });
  };

  const deleteMixedResult = (mIndex: number) => {
    updateContent({
      mixedResults: (content.mixedResults || []).filter((_, i) => i !== mIndex),
    });
  };

  // Student handlers
  const handleSelectOption = (questionId: string, optionId: string) => {
    if (showResults) return;
    setAnswers((prev) => ({ ...prev, [questionId]: optionId }));
  };

  const handleSubmitResults = () => {
    setShowResults(true);
    if (onSubmit) {
      // For survey, all answers are "correct" — no scoring
      onSubmit(
        { answers, isCompleted: true, dominantCategories },
        true,
        content.questions.length,
        content.questions.length
      );
    }
  };

  const handleReset = () => {
    setAnswers({});
    setShowResults(false);
    if (onReset) onReset();
  };

  // ============ EDITOR MODE ============
  if (isEditing) {
    return (
      <div className="space-y-6">
        {/* Title & Instruction */}
        <div className="space-y-3">
          <div>
            <Label>Заголовок теста</Label>
            <Input
              value={content.title || ""}
              onChange={(e) => updateContent({ title: e.target.value })}
              placeholder="Название опросника"
            />
          </div>
          <div>
            <Label>Инструкция (HTML)</Label>
            <Textarea
              value={content.instruction || ""}
              onChange={(e) => updateContent({ instruction: e.target.value })}
              placeholder="<strong>Выберите один ответ</strong> в каждом вопросе..."
              rows={2}
            />
          </div>
        </div>

        {/* Questions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Вопросы</Label>
            <Button variant="outline" size="sm" onClick={addQuestion}>
              <Plus className="h-4 w-4 mr-1" />
              Добавить вопрос
            </Button>
          </div>

          {content.questions.map((q, qIndex) => (
            <GlassCard key={q.id} className="p-4 space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <Textarea
                    value={q.question}
                    onChange={(e) => updateQuestion(qIndex, { question: e.target.value })}
                    placeholder={`Вопрос ${qIndex + 1}`}
                    rows={2}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteQuestion(qIndex)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2 ml-4">
                {q.options.map((opt, oIndex) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <Input
                      value={opt.category}
                      onChange={(e) =>
                        updateOption(qIndex, oIndex, { category: e.target.value.toUpperCase() })
                      }
                      placeholder="A"
                      className="w-12 text-center font-medium"
                    />
                    <Input
                      value={opt.text}
                      onChange={(e) => updateOption(qIndex, oIndex, { text: e.target.value })}
                      placeholder="Текст варианта ответа"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteOption(qIndex, oIndex)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addOption(qIndex)}
                  className="text-muted-foreground"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Добавить вариант
                </Button>
              </div>
            </GlassCard>
          ))}
        </div>

        {/* Results */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Результаты по категориям</Label>
            <Button variant="outline" size="sm" onClick={addResult}>
              <Plus className="h-4 w-4 mr-1" />
              Добавить результат
            </Button>
          </div>

          {content.results.map((r, rIndex) => (
            <GlassCard key={rIndex} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={r.category}
                  onChange={(e) => updateResult(rIndex, { category: e.target.value.toUpperCase() })}
                  placeholder="A"
                  className="w-16 text-center font-medium"
                />
                <Input
                  value={r.title}
                  onChange={(e) => updateResult(rIndex, { title: e.target.value })}
                  placeholder="Название результата"
                  className="flex-1"
                />
                <select
                  value={r.color || "blue"}
                  onChange={(e) => updateResult(rIndex, { color: e.target.value })}
                  className="h-9 px-2 rounded-md border bg-background text-sm"
                >
                  <option value="blue">Синий</option>
                  <option value="amber">Жёлтый</option>
                  <option value="green">Зелёный</option>
                  <option value="red">Красный</option>
                  <option value="purple">Фиолетовый</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteResult(rIndex)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={r.description}
                onChange={(e) => updateResult(rIndex, { description: e.target.value })}
                placeholder="Описание результата..."
                rows={2}
              />
            </GlassCard>
          ))}
        </div>

        {/* Mixed Results */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">Смешанные результаты (опционально)</Label>
            <Button variant="outline" size="sm" onClick={addMixedResult}>
              <Plus className="h-4 w-4 mr-1" />
              Добавить
            </Button>
          </div>

          {(content.mixedResults || []).map((m, mIndex) => (
            <GlassCard key={mIndex} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  value={m.categories.join(", ")}
                  onChange={(e) =>
                    updateMixedResult(mIndex, {
                      categories: e.target.value.split(",").map((c) => c.trim().toUpperCase()),
                    })
                  }
                  placeholder="A, B"
                  className="w-24 text-center font-medium"
                />
                <Input
                  value={m.title}
                  onChange={(e) => updateMixedResult(mIndex, { title: e.target.value })}
                  placeholder="Название"
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteMixedResult(mIndex)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                value={m.description}
                onChange={(e) => updateMixedResult(mIndex, { description: e.target.value })}
                placeholder="Описание..."
                rows={2}
              />
            </GlassCard>
          ))}
        </div>

        {/* Button text */}
        <div>
          <Label>Текст кнопки</Label>
          <Input
            value={content.buttonText || "Узнать результат"}
            onChange={(e) => updateContent({ buttonText: e.target.value })}
            placeholder="Узнать результат"
          />
        </div>
      </div>
    );
  }

  // ============ STUDENT VIEW ============
  return (
    <div className="space-y-6">
      {/* Title */}
      {content.title && (
        <div className="flex items-center gap-3 mb-2">
          <ClipboardList className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">{content.title}</h2>
        </div>
      )}

      {/* Instruction */}
      {content.instruction && (
        <GlassCard className="p-4 bg-primary/5 border-primary/20">
          <div
            className="text-sm text-muted-foreground prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: content.instruction }}
          />
        </GlassCard>
      )}

      {/* Questions - Glass Cards */}
      <div className="space-y-6">
        {content.questions.map((q, qIndex) => (
          <div
            key={q.id}
            className={cn(
              "p-5 rounded-2xl backdrop-blur-xl border transition-all duration-300",
              answers[q.id] 
                ? "border-primary/40 shadow-lg shadow-primary/10" 
                : "border-border/30 shadow-md"
            )}
            style={{
              background: answers[q.id]
                ? "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.03))"
                : "linear-gradient(135deg, hsl(var(--card) / 0.5), hsl(var(--card) / 0.25))",
              boxShadow: answers[q.id]
                ? "0 12px 40px hsl(var(--primary) / 0.1), inset 0 1px 0 hsl(0 0% 100% / 0.2)"
                : "0 8px 32px rgba(0, 0, 0, 0.06), inset 0 1px 0 hsl(0 0% 100% / 0.15)"
            }}
          >
            <div
              className="font-medium mb-4 whitespace-pre-line"
              dangerouslySetInnerHTML={{
                __html: q.question.replace(/\n/g, "<br />"),
              }}
            />

            <RadioGroup
              value={answers[q.id] || ""}
              onValueChange={(value) => handleSelectOption(q.id, value)}
              className="space-y-2"
              disabled={showResults}
            >
              {q.options.map((opt) => (
                <label
                  key={opt.id}
                  className={cn(
                    "flex items-start gap-3 p-4 rounded-xl backdrop-blur-sm border cursor-pointer transition-all duration-200",
                    answers[q.id] === opt.id 
                      ? "bg-primary/15 border-primary/40 shadow-md"
                      : "bg-white/10 border-white/20 hover:bg-white/20 hover:border-white/30",
                    showResults && "cursor-default hover:bg-transparent"
                  )}
                >
                  <RadioGroupItem value={opt.id} className="mt-0.5" />
                  <span className="text-sm leading-relaxed">{opt.text}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
        ))}
      </div>

      {/* Submit Button with Gradient */}
      {!showResults && (
        <div className="flex justify-center pt-4">
          <Button
            size="lg"
            onClick={handleSubmitResults}
            disabled={!allQuestionsAnswered}
            className="gap-2 bg-gradient-to-r from-primary via-primary/90 to-accent/80 hover:from-primary/90 hover:to-accent/70 shadow-lg shadow-primary/25 border-0 disabled:opacity-50 disabled:shadow-none"
          >
            <Sparkles className="h-4 w-4" />
            {content.buttonText || "Узнать результат"}
          </Button>
        </div>
      )}

      {/* Results Section - Glass Design */}
      {showResults && (
        <div className="space-y-6 animate-in fade-in-50 duration-500">
          {/* Category Scores - Glass Card */}
          <div 
            className="p-5 rounded-2xl backdrop-blur-2xl border border-primary/30 shadow-xl overflow-hidden relative"
            style={{
              background: "linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.03))",
              boxShadow: "0 16px 48px hsl(var(--primary) / 0.15), inset 0 1px 0 hsl(0 0% 100% / 0.3)"
            }}
          >
            {/* Floating decoration */}
            <div className="absolute -top-12 -right-12 w-40 h-40 bg-primary/20 rounded-full blur-3xl pointer-events-none" />
            
            <h3 className="font-semibold mb-4 flex items-center gap-2 relative z-10">
              <div className="p-2 rounded-xl bg-primary/20 backdrop-blur-sm">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              Ваш результат
            </h3>

            <div className="space-y-3 mb-6 relative z-10">
              {Object.entries(categoryScores)
                .sort(([, a], [, b]) => b - a)
                .map(([category, score]) => {
                  const maxPossible = content.questions.length;
                  const percentage = (score / maxPossible) * 100;
                  const resultDef = content.results.find((r) => r.category === category);
                  const colors = colorMap[resultDef?.color || "blue"];

                  return (
                    <div key={category} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{category}</span>
                        <span className="text-muted-foreground/90">
                          {score} из {maxPossible}
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-white/20 backdrop-blur-sm overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all duration-700", colors.bg)}
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: `hsl(var(--primary) / 0.6)`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Dominant Category Result - Glass */}
            {resultToShow && (
              <div
                className={cn(
                  "p-5 mt-4 rounded-xl backdrop-blur-sm border relative z-10",
                  colorMap[resultToShow.color || "blue"]?.bg,
                  colorMap[resultToShow.color || "blue"]?.border
                )}
                style={{
                  boxShadow: "inset 0 1px 0 hsl(0 0% 100% / 0.2)"
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "p-2 rounded-xl backdrop-blur-sm",
                      colorMap[resultToShow.color || "blue"]?.bg
                    )}
                  >
                    <Sparkles
                      className={cn("h-5 w-5", colorMap[resultToShow.color || "blue"]?.text)}
                    />
                  </div>
                  <div>
                    <h4 className="font-semibold text-lg">{resultToShow.title}</h4>
                    <p className="text-muted-foreground/90 mt-1">{resultToShow.description}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Reset Button - Glass Style */}
          <div className="flex justify-center">
            <Button 
              variant="outline" 
              onClick={handleReset} 
              className="gap-2 backdrop-blur-sm bg-white/10 border-white/30 hover:bg-white/20"
            >
              <RotateCcw className="h-4 w-4" />
              Пройти ещё раз
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
