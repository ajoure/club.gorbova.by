import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Search, Link2, SkipForward, CheckCircle2, Loader2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { transliterateToCyrillic, transliterateToLatin } from "@/utils/transliteration";

interface UnmatchedContact {
  amo_id: string;
  full_name: string;
  email?: string;
  phone?: string;
}

interface FuzzyMatchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: UnmatchedContact[];
  onSuccess?: () => void;
}

interface MatchCandidate {
  profileId: string;
  profileName: string;
  similarity: number;
  transliterated: string;
}

interface ContactWithCandidates {
  contact: UnmatchedContact;
  candidates: MatchCandidate[];
  status: 'pending' | 'linked' | 'skipped';
  linkedToId?: string;
}

// Calculate similarity between two strings (Sørensen–Dice coefficient)
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length < 2 || s2.length < 2) return 0;
  
  const bigrams1 = new Set<string>();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.slice(i, i + 2));
  }
  
  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.slice(i, i + 2);
    if (bigrams1.has(bigram)) {
      intersection++;
      bigrams1.delete(bigram); // Only count once
    }
  }
  
  return (2 * intersection) / (s1.length - 1 + s2.length - 1);
}

// Word-based similarity for names
function calculateNameSimilarity(name1: string, name2: string): number {
  const words1 = name1.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const words2 = name2.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  let matchedWords = 0;
  for (const w1 of words1) {
    for (const w2 of words2) {
      const sim = calculateSimilarity(w1, w2);
      if (sim >= 0.8) {
        matchedWords++;
        break;
      }
    }
  }
  
  return matchedWords / Math.max(words1.length, words2.length);
}

export default function FuzzyMatchDialog({ open, onOpenChange, contacts, onSuccess }: FuzzyMatchDialogProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [contactsWithCandidates, setContactsWithCandidates] = useState<ContactWithCandidates[]>([]);
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    if (open && contacts.length > 0) {
      analyzeContacts();
    }
  }, [open, contacts]);

  const analyzeContacts = async () => {
    setIsAnalyzing(true);
    setAnalyzeProgress(0);

    try {
      // Load all profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name');

      if (!profiles || profiles.length === 0) {
        toast.error("Нет профилей для сопоставления");
        setIsAnalyzing(false);
        return;
      }

      const results: ContactWithCandidates[] = [];

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const candidates: MatchCandidate[] = [];

        // Transliterate contact name to Cyrillic
        const transliterated = transliterateToCyrillic(contact.full_name);

        for (const profile of profiles) {
          if (!profile.full_name) continue;

          // Calculate similarity with transliterated name
          const similarity = calculateNameSimilarity(transliterated, profile.full_name);

          // Also try reverse transliteration
          const profileLatin = transliterateToLatin(profile.full_name);
          const reverseSimilarity = calculateNameSimilarity(contact.full_name, profileLatin);

          const bestSimilarity = Math.max(similarity, reverseSimilarity);

          if (bestSimilarity >= 0.5) { // 50% threshold
            candidates.push({
              profileId: profile.id,
              profileName: profile.full_name,
              similarity: bestSimilarity,
              transliterated,
            });
          }
        }

        // Sort by similarity descending
        candidates.sort((a, b) => b.similarity - a.similarity);

        results.push({
          contact,
          candidates: candidates.slice(0, 3), // Top 3 candidates
          status: 'pending',
        });

        setAnalyzeProgress(((i + 1) / contacts.length) * 100);
      }

      setContactsWithCandidates(results);
    } catch (error) {
      console.error("Error analyzing contacts:", error);
      toast.error("Ошибка анализа контактов");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLink = async (contactIndex: number, profileId: string) => {
    const item = contactsWithCandidates[contactIndex];
    if (!item) return;

    setIsLinking(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ external_id_amo: item.contact.amo_id })
        .eq('id', profileId);

      if (error) throw error;

      setContactsWithCandidates(prev => 
        prev.map((c, i) => 
          i === contactIndex 
            ? { ...c, status: 'linked', linkedToId: profileId }
            : c
        )
      );

      toast.success(`${item.contact.full_name} привязан`);
    } catch (error: any) {
      toast.error("Ошибка привязки: " + error.message);
    } finally {
      setIsLinking(false);
    }
  };

  const handleSkip = (contactIndex: number) => {
    setContactsWithCandidates(prev => 
      prev.map((c, i) => 
        i === contactIndex ? { ...c, status: 'skipped' } : c
      )
    );
  };

  const stats = useMemo(() => {
    const pending = contactsWithCandidates.filter(c => c.status === 'pending' && c.candidates.length > 0).length;
    const linked = contactsWithCandidates.filter(c => c.status === 'linked').length;
    const skipped = contactsWithCandidates.filter(c => c.status === 'skipped').length;
    const noCandidates = contactsWithCandidates.filter(c => c.candidates.length === 0).length;
    return { pending, linked, skipped, noCandidates };
  }, [contactsWithCandidates]);

  const handleClose = () => {
    if (stats.linked > 0) {
      onSuccess?.();
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Нечёткий поиск совпадений
          </DialogTitle>
          <DialogDescription>
            Поиск профилей с похожими именами для {contacts.length} контактов
          </DialogDescription>
        </DialogHeader>

        {isAnalyzing ? (
          <div className="py-8 space-y-4">
            <div className="text-center text-muted-foreground">
              Анализ имён с транслитерацией...
            </div>
            <Progress value={analyzeProgress} className="h-2" />
            <div className="text-center text-sm text-muted-foreground">
              {Math.round(analyzeProgress)}%
            </div>
          </div>
        ) : (
          <>
            <div className="flex gap-4 py-2">
              <Badge variant="outline">
                Найдено кандидатов: {stats.pending}
              </Badge>
              <Badge variant="default" className="bg-green-500/20 text-green-600 border-green-500/30">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Привязано: {stats.linked}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                Пропущено: {stats.skipped}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                Без кандидатов: {stats.noCandidates}
              </Badge>
            </div>

            <ScrollArea className="flex-1 min-h-0 max-h-[60vh]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">Контакт amoCRM</TableHead>
                    <TableHead className="w-[180px]">Транслит</TableHead>
                    <TableHead>Кандидаты</TableHead>
                    <TableHead className="w-[100px]">Действие</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactsWithCandidates
                    .filter(c => c.status === 'pending' && c.candidates.length > 0)
                    .map((item, index) => {
                      const actualIndex = contactsWithCandidates.findIndex(c => c.contact.amo_id === item.contact.amo_id);
                      return (
                        <TableRow key={item.contact.amo_id}>
                          <TableCell>
                            <div className="font-medium">{item.contact.full_name}</div>
                            {item.contact.email && (
                              <div className="text-xs text-muted-foreground">{item.contact.email}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {item.candidates[0]?.transliterated || '—'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {item.candidates.map((candidate, cidx) => (
                                <div key={candidate.profileId} className="flex items-center gap-2">
                                  <Badge 
                                    variant={cidx === 0 ? "default" : "outline"}
                                    className={cidx === 0 ? "bg-purple-500/20 text-purple-600 border-purple-500/30" : ""}
                                  >
                                    {Math.round(candidate.similarity * 100)}%
                                  </Badge>
                                  <span className="text-sm">{candidate.profileName}</span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2"
                                    disabled={isLinking}
                                    onClick={() => handleLink(actualIndex, candidate.profileId)}
                                  >
                                    <Link2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSkip(actualIndex)}
                            >
                              <SkipForward className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>

              {stats.pending === 0 && stats.noCandidates > 0 && (
                <div className="py-8 text-center text-muted-foreground">
                  <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Не найдено похожих профилей для оставшихся контактов</p>
                </div>
              )}
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
