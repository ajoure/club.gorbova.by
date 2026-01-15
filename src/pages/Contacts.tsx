import { useState } from "react";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, Phone, Mail, Clock, Building2, Send } from "lucide-react";

export default function Contacts() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
    consent: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.email || !formData.message) {
      toast({
        title: "Ошибка",
        description: "Пожалуйста, заполните обязательные поля",
        variant: "destructive",
      });
      return;
    }

    if (!formData.consent) {
      toast({
        title: "Ошибка",
        description: "Необходимо согласие на обработку персональных данных",
        variant: "destructive",
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast({
        title: "Ошибка",
        description: "Пожалуйста, введите корректный email",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await (supabase.from("contact_requests") as any).insert({
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim() || null,
        subject: formData.subject.trim() || null,
        message: formData.message.trim(),
      });

      if (error) throw error;

      toast({
        title: "Спасибо!",
        description: "Мы получили ваше сообщение и свяжемся с вами в ближайшее время.",
      });

      setFormData({
        name: "",
        email: "",
        phone: "",
        subject: "",
        message: "",
        consent: false,
      });
    } catch (error) {
      console.error("Error submitting contact form:", error);
      toast({
        title: "Ошибка",
        description: "Не удалось отправить сообщение. Попробуйте позже.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />

      <main className="container mx-auto px-4 py-24">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">Контакты</h1>
          <p className="text-muted-foreground text-center mb-12">
            Свяжитесь с нами удобным для вас способом
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Contact Information */}
            <div className="space-y-6">
              <GlassCard className="p-8">
                <h2 className="text-2xl font-semibold mb-6">Наши контакты</h2>
                
                <div className="space-y-5">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">ЗАО «АЖУР инкам»</p>
                      <p className="text-sm text-muted-foreground">УНП: 193405000</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                      <MapPin className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Юридический адрес</p>
                      <p className="text-sm text-muted-foreground">
                        220035, г. Минск, ул. Панфилова, 2, офис 49Л
                      </p>
                      <p className="text-sm text-muted-foreground mt-2">
                        <span className="font-medium text-foreground">Почтовый адрес:</span><br />
                        220052, Республика Беларусь, г. Минск, а/я 63
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Телефон</p>
                      <a 
                        href="tel:+375291714321" 
                        className="text-sm text-primary hover:underline"
                      >
                        +375 29 171-43-21
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">E-mail</p>
                      <a 
                        href="mailto:info@ajoure.by" 
                        className="text-sm text-primary hover:underline"
                      >
                        info@ajoure.by
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                      <Clock className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">Режим работы</p>
                      <p className="text-sm text-muted-foreground">
                        Пн–Пт 9:00–18:00 (Минск)
                      </p>
                    </div>
                  </div>
                </div>
              </GlassCard>

              {/* Map */}
              <GlassCard className="p-4 overflow-hidden">
                <iframe
                  src="https://yandex.ru/map-widget/v1/?ll=27.5474%2C53.9267&z=16&pt=27.5474%2C53.9267%2Cpm2rdm&l=map"
                  width="100%"
                  height="300"
                  style={{ border: 0, borderRadius: "0.75rem" }}
                  allowFullScreen
                  loading="lazy"
                  title="Расположение офиса"
                />
              </GlassCard>
            </div>

            {/* Contact Form */}
            <GlassCard className="p-8">
              <h2 className="text-2xl font-semibold mb-6">Форма обратной связи</h2>
              
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Имя <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="Ваше имя"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    maxLength={100}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">
                    E-mail <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="your@email.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    maxLength={255}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Телефон</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+375 XX XXX-XX-XX"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    maxLength={20}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Тема</Label>
                  <Input
                    id="subject"
                    placeholder="Тема сообщения"
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    maxLength={200}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">
                    Сообщение <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="message"
                    placeholder="Ваше сообщение..."
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    rows={5}
                    maxLength={2000}
                    required
                  />
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="consent"
                    checked={formData.consent}
                    onCheckedChange={(checked) => 
                      setFormData({ ...formData, consent: checked as boolean })
                    }
                  />
                  <Label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed cursor-pointer">
                    Согласен(на) на{" "}
                    <a 
                      href="/consent" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      обработку персональных данных
                    </a>{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                </div>

                <Button 
                  type="submit" 
                  className="w-full" 
                  size="lg"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    "Отправка..."
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Отправить сообщение
                    </>
                  )}
                </Button>
              </form>
            </GlassCard>
          </div>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}
