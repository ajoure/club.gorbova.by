import { Link } from "react-router-dom";

export function ConsultationFooter() {
  return (
    <footer className="py-8 border-t border-border/50 bg-muted/30">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-center md:text-left">
            <div className="font-semibold text-foreground">Катерина Горбова</div>
            <div className="text-sm text-muted-foreground">Консультации по налогам и законодательству</div>
          </div>
          
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/privacy" className="hover:text-foreground transition-colors">
              Политика конфиденциальности
            </Link>
            <a href="mailto:support@gorbova.by" className="hover:text-foreground transition-colors">
              support@gorbova.by
            </a>
          </div>
        </div>
        
        <div className="mt-6 pt-6 border-t border-border/50 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Все права защищены
        </div>
      </div>
    </footer>
  );
}
