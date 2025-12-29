import { LandingHeader } from "@/components/landing/LandingHeader";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { GlassCard } from "@/components/ui/GlassCard";
import { Shield } from "lucide-react";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      <LandingHeader />
      
      <main className="container mx-auto px-4 py-24">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold text-center mb-4">ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ</h1>
          <p className="text-muted-foreground text-center mb-12">
            Защита ваших персональных данных
          </p>
          
          <GlassCard className="p-12 text-center">
            <div className="flex justify-center mb-6">
              <div className="p-4 rounded-full bg-primary/10">
                <Shield className="h-12 w-12 text-primary" />
              </div>
            </div>
            
            <h2 className="text-2xl font-semibold mb-4">
              Политика конфиденциальности будет опубликована
            </h2>
            
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Мы работаем над подготовкой полного текста Политики конфиденциальности. 
              Документ будет размещён в ближайшее время.
            </p>
            
            <div className="border-t border-border/50 pt-8 mt-8">
              <h3 className="font-medium mb-4">Контакты для связи</h3>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
                <a href="tel:+375447594321" className="text-primary hover:underline">
                  +375 44 759-43-21
                </a>
                <a href="mailto:info@ajoure.by" className="text-primary hover:underline">
                  info@ajoure.by
                </a>
              </div>
            </div>
          </GlassCard>
          
          <div className="mt-12 text-center text-sm text-muted-foreground">
            <p>
              <strong>ЗАО «АЖУР инкам»</strong><br />
              УНП: 193405000<br />
              220035, г. Минск, ул. Панфилова, 2, офис 49Л
            </p>
          </div>
        </div>
      </main>
      
      <LandingFooter />
    </div>
  );
}
