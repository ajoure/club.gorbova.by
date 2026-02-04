// iOS Safari preview detection (safe - no document.write)
function isIOSSafariInPreview(): boolean {
  if (typeof window === 'undefined') return false;
  
  const ua = navigator.userAgent || '';
  const isIOS = /iP(hone|ad|od)/.test(ua);
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
  if (!isIOS || !isSafari) return false;
  
  let inIframe = false;
  try { inIframe = window.self !== window.top; } catch { inIframe = true; }
  
  const qs = window.location.search || '';
  const hasFlag = qs.includes('forceHideBadge') || qs.includes('lovable') || qs.includes('preview');
  const ref = document.referrer || '';
  const hasRef = ref.includes('lovable.dev');
  
  return inIframe || hasFlag || hasRef;
}

// Simple iOS preview message component
function IOSPreviewMessage() {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#f8fafc',
      margin: 0,
      padding: '20px',
      textAlign: 'center'
    }}>
      <div style={{ maxWidth: '320px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📱</div>
        <h2 style={{ color: '#1e293b', margin: '0 0 8px', fontSize: '20px' }}>Мобильный режим</h2>
        <p style={{ color: '#64748b', margin: '0 0 20px', lineHeight: 1.5, fontSize: '14px' }}>
          Предпросмотр в редакторе lovable.dev на iOS перегружает Safari.<br />
          Откройте сайт в отдельной вкладке.
        </p>
        <a
          href="https://gorbova.lovable.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '14px 24px',
            background: '#3b82f6',
            color: '#fff',
            textDecoration: 'none',
            borderRadius: '12px',
            fontWeight: 600,
            fontSize: '15px',
            boxShadow: '0 4px 14px rgba(59,130,246,0.4)'
          }}
        >
          Открыть сайт →
        </a>
        <p style={{ color: '#94a3b8', margin: '16px 0 0', fontSize: '12px' }}>
          Desktop preview работает как обычно.
        </p>
      </div>
    </div>
  );
}

import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { HelpModeProvider } from "@/contexts/HelpModeContext";
import { ImpersonationBar } from "@/components/layout/ImpersonationBar";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { GlobalPaymentHandler } from "@/components/payment/GlobalPaymentHandler";
import { initExternalLinkKillSwitch, BUILD_MARKER } from "@/lib/externalLinkKillSwitch";
import { IOSAdminGuard } from "@/hooks/useIOSAdminGuard";
import { Loader2 } from "lucide-react";

// Critical pages - loaded immediately (first screen)
import Landing from "./pages/Landing";
import { DomainHomePage } from "./components/layout/DomainRouter";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Lazy-loaded pages - code splitting for bundle optimization
const Accountant = lazy(() => import("./pages/Accountant"));
const Business = lazy(() => import("./pages/Business"));
const Audits = lazy(() => import("./pages/Audits"));
const SelfDevelopment = lazy(() => import("./pages/SelfDevelopment"));
const EisenhowerMatrix = lazy(() => import("./pages/tools/EisenhowerMatrix"));
const BalanceWheel = lazy(() => import("./pages/tools/BalanceWheel"));
const Quests = lazy(() => import("./pages/self-development/Quests"));
const QuestLessons = lazy(() => import("./pages/self-development/QuestLessons"));
const QuestLesson = lazy(() => import("./pages/self-development/QuestLesson"));
const HabitTracker = lazy(() => import("./pages/self-development/HabitTracker"));
const OrderPayment = lazy(() => import("./pages/OrderPayment"));
const Offer = lazy(() => import("./pages/Offer"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Consent = lazy(() => import("./pages/Consent"));
const Contacts = lazy(() => import("./pages/Contacts"));
const MnsResponseService = lazy(() => import("./pages/audits/MnsResponseService"));
const MnsDocumentHistory = lazy(() => import("./pages/audits/MnsDocumentHistory"));
const Purchases = lazy(() => import("./pages/Purchases"));
const Pay = lazy(() => import("./pages/Pay"));
const Documentation = lazy(() => import("./pages/Documentation"));
const Help = lazy(() => import("./pages/Help"));
const ProfileSettings = lazy(() => import("./pages/settings/Profile"));
const PaymentMethodsSettings = lazy(() => import("./pages/settings/PaymentMethods"));
const ConsentsSettings = lazy(() => import("./pages/settings/Consents"));
const LegalDetailsSettings = lazy(() => import("./pages/settings/LegalDetails"));
const Learning = lazy(() => import("./pages/Learning"));
const Consultation = lazy(() => import("./pages/Consultation"));
const CourseAccountant = lazy(() => import("./pages/CourseAccountant"));
const Library = lazy(() => import("./pages/Library"));
const LibraryModule = lazy(() => import("./pages/LibraryModule"));
const LibraryLesson = lazy(() => import("./pages/LibraryLesson"));
const Support = lazy(() => import("./pages/Support"));
const SupportTicket = lazy(() => import("./pages/SupportTicket"));
const Money = lazy(() => import("./pages/Money"));
const AI = lazy(() => import("./pages/AI"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const BusinessTraining = lazy(() => import("./pages/BusinessTraining"));
const BusinessTrainingContent = lazy(() => import("./pages/BusinessTrainingContent"));

// Admin pages - lazy loaded (heavy components)
const AdminLayout = lazy(() => import("./components/layout/AdminLayout").then(m => ({ default: m.AdminLayout })));
const AdminContacts = lazy(() => import("./pages/admin/AdminContacts"));
const AdminDeals = lazy(() => import("./pages/admin/AdminDeals"));
const AdminRoles = lazy(() => import("./pages/admin/AdminRoles"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminEntitlements = lazy(() => import("./pages/admin/AdminEntitlements"));
const AdminContent = lazy(() => import("./pages/admin/AdminContent"));
const AdminDuplicates = lazy(() => import("./pages/admin/AdminDuplicates"));
const AdminIntegrations = lazy(() => import("./pages/admin/AdminIntegrations"));
const TelegramClubMembers = lazy(() => import("./pages/admin/TelegramClubMembers"));
const TelegramInvites = lazy(() => import("./pages/admin/TelegramInvites"));
const ProductClubMappings = lazy(() => import("./pages/admin/ProductClubMappings"));
const TelegramChatAnalytics = lazy(() => import("./pages/admin/TelegramChatAnalytics"));
const AdminFieldRegistry = lazy(() => import("./pages/admin/AdminFieldRegistry"));
const AdminProductsV2 = lazy(() => import("./pages/admin/AdminProductsV2"));
const AdminProductDetailV2 = lazy(() => import("./pages/admin/AdminProductDetailV2"));
const AdminOrdersV2 = lazy(() => import("./pages/admin/AdminOrdersV2"));
const AdminPaymentsPage = lazy(() => import("./pages/admin/AdminPayments"));
const AdminPaymentsHub = lazy(() => import("./pages/admin/AdminPaymentsHub"));
const AdminSubscriptionsV2 = lazy(() => import("./pages/admin/AdminSubscriptionsV2"));
const AdminSystemAudit = lazy(() => import("./pages/admin/AdminSystemAudit"));
const AdminSystemHealth = lazy(() => import("./pages/admin/AdminSystemHealth"));
const AdminConsents = lazy(() => import("./pages/admin/AdminConsents"));
const AdminPreregistrations = lazy(() => import("./pages/admin/AdminPreregistrations"));
const AdminInbox = lazy(() => import("./pages/admin/AdminInbox"));
const AdminExecutors = lazy(() => import("./pages/admin/AdminExecutors"));
const AdminDocumentTemplates = lazy(() => import("./pages/admin/AdminDocumentTemplates"));
const AdminBroadcasts = lazy(() => import("./pages/admin/AdminBroadcasts"));
const AdminTrainingModules = lazy(() => import("./pages/admin/AdminTrainingModules"));
const AdminTrainingLessons = lazy(() => import("./pages/admin/AdminTrainingLessons"));
const AdminLessonBlockEditor = lazy(() => import("./pages/admin/AdminLessonBlockEditor"));
const AdminBepaidArchiveImport = lazy(() => import("./pages/admin/AdminBepaidArchiveImport"));
const AdminSupport = lazy(() => import("./pages/admin/AdminSupport"));
const AdminNews = lazy(() => import("./pages/admin/AdminNews"));
const AdminCommunication = lazy(() => import("./pages/admin/AdminCommunication"));
const AdminEditorial = lazy(() => import("./pages/admin/AdminEditorial"));
const AdminIlex = lazy(() => import("./pages/admin/AdminIlex"));
const AdminMarketingInsights = lazy(() => import("./pages/admin/AdminMarketingInsights"));
const AdminPaymentDiagnostics = lazy(() => import("./pages/admin/AdminPaymentDiagnostics"));
const AdminTelegramDiagnostics = lazy(() => import("./pages/admin/AdminTelegramDiagnostics"));
const AdminKbImport = lazy(() => import("./pages/admin/AdminKbImport"));
const AdminBepaidSubscriptions = lazy(() => import("./pages/admin/AdminBepaidSubscriptions"));

// Page loader component for Suspense fallback
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// Wrapper for lazy routes with Suspense
const LazyRoute = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<PageLoader />}>{children}</Suspense>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
      retryDelay: 1000,
    },
  },
});

// Initialize external link kill switch once at app startup
initExternalLinkKillSwitch();

const App = () => {
  // iOS Safari in lovable.dev preview - show simple message instead of heavy app
  if (isIOSSafariInPreview()) {
    return <IOSPreviewMessage />;
  }

  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <IOSAdminGuard>
          <AuthProvider>
            <HelpModeProvider>
              <ScrollToTop />
              <GlobalPaymentHandler />
              <ImpersonationBar />
              <div className="impersonation-offset">
                <Routes>
              {/* Public routes */}
              <Route path="/" element={<DomainHomePage />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
              <Route path="/order-payment" element={<LazyRoute><OrderPayment /></LazyRoute>} />
              <Route path="/offer" element={<LazyRoute><Offer /></LazyRoute>} />
              <Route path="/pay" element={<LazyRoute><Pay /></LazyRoute>} />
              <Route path="/privacy" element={<LazyRoute><Privacy /></LazyRoute>} />
              <Route path="/consent" element={<LazyRoute><Consent /></LazyRoute>} />
              <Route path="/contacts" element={<LazyRoute><Contacts /></LazyRoute>} />
              <Route path="/help" element={<LazyRoute><Help /></LazyRoute>} />
              <Route path="/consultation" element={<LazyRoute><Consultation /></LazyRoute>} />
              <Route path="/course-accountant" element={<LazyRoute><CourseAccountant /></LazyRoute>} />
              <Route path="/business-training" element={<LazyRoute><BusinessTraining /></LazyRoute>} />
              <Route path="/club" element={<Landing />} />
              
              {/* Protected routes */}
              <Route path="/products" element={<ProtectedRoute><LazyRoute><Learning /></LazyRoute></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/money" element={<ProtectedRoute><LazyRoute><Money /></LazyRoute></ProtectedRoute>} />
              <Route path="/ai" element={<ProtectedRoute><LazyRoute><AI /></LazyRoute></ProtectedRoute>} />
              <Route path="/knowledge" element={<ProtectedRoute><LazyRoute><Knowledge /></LazyRoute></ProtectedRoute>} />
              <Route path="/purchases" element={<ProtectedRoute><LazyRoute><Purchases /></LazyRoute></ProtectedRoute>} />
              <Route path="/accountant" element={<ProtectedRoute><LazyRoute><Accountant /></LazyRoute></ProtectedRoute>} />
              <Route path="/business" element={<ProtectedRoute><LazyRoute><Business /></LazyRoute></ProtectedRoute>} />
              <Route path="/audits" element={<ProtectedRoute><LazyRoute><Audits /></LazyRoute></ProtectedRoute>} />
              <Route path="/audits/mns-response" element={<ProtectedRoute><LazyRoute><MnsResponseService /></LazyRoute></ProtectedRoute>} />
              <Route path="/audits/mns-history" element={<ProtectedRoute><LazyRoute><MnsDocumentHistory /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development" element={<ProtectedRoute><LazyRoute><SelfDevelopment /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/quests" element={<ProtectedRoute><LazyRoute><Quests /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/quests/:questSlug" element={<ProtectedRoute><LazyRoute><QuestLessons /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/quests/:questSlug/:lessonSlug" element={<ProtectedRoute><LazyRoute><QuestLesson /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/habits" element={<ProtectedRoute><LazyRoute><HabitTracker /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/balance-wheel" element={<ProtectedRoute><LazyRoute><BalanceWheel /></LazyRoute></ProtectedRoute>} />
              <Route path="/tools" element={<Navigate to="/tools/eisenhower" replace />} />
              <Route path="/tools/eisenhower" element={<ProtectedRoute><LazyRoute><EisenhowerMatrix /></LazyRoute></ProtectedRoute>} />
              <Route path="/tools/balance-wheel" element={<Navigate to="/self-development/balance-wheel" replace />} />
              <Route path="/support" element={<ProtectedRoute><LazyRoute><Support /></LazyRoute></ProtectedRoute>} />
              <Route path="/support/:ticketId" element={<ProtectedRoute><LazyRoute><SupportTicket /></LazyRoute></ProtectedRoute>} />
              <Route path="/docs" element={<ProtectedRoute><LazyRoute><Documentation /></LazyRoute></ProtectedRoute>} />
              <Route path="/library" element={<ProtectedRoute><LazyRoute><Library /></LazyRoute></ProtectedRoute>} />
              <Route path="/library/buh-business" element={<ProtectedRoute><LazyRoute><BusinessTrainingContent /></LazyRoute></ProtectedRoute>} />
              <Route path="/library/:moduleSlug" element={<ProtectedRoute><LazyRoute><LibraryModule /></LazyRoute></ProtectedRoute>} />
              <Route path="/library/:moduleSlug/:lessonSlug" element={<ProtectedRoute><LazyRoute><LibraryLesson /></LazyRoute></ProtectedRoute>} />
              
              {/* Settings routes */}
              <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
              <Route path="/settings/profile" element={<ProtectedRoute><LazyRoute><ProfileSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/payment-methods" element={<ProtectedRoute><LazyRoute><PaymentMethodsSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/legal-details" element={<ProtectedRoute><LazyRoute><LegalDetailsSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/consents" element={<ProtectedRoute><LazyRoute><ConsentsSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/subscriptions" element={<Navigate to="/purchases" replace />} />
              
              {/* Admin routes - CRM */}
              <Route path="/admin" element={<Navigate to="/admin/deals" replace />} />
              <Route path="/admin/inbox" element={<ProtectedRoute><LazyRoute><AdminInbox /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/communication" element={<ProtectedRoute><LazyRoute><AdminCommunication /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/broadcasts" element={<ProtectedRoute><LazyRoute><AdminBroadcasts /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/contacts" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminContacts /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/contacts/duplicates" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminDuplicates /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/deals" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminDeals /></AdminLayout></LazyRoute></ProtectedRoute>} />
              
              {/* Admin routes - Service */}
              <Route path="/admin/roles" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminRoles /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminAudit /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/content" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminContent /></AdminLayout></LazyRoute></ProtectedRoute>} />
              
              {/* Integrations routes */}
              <Route path="/admin/integrations" element={<Navigate to="/admin/integrations/crm" replace />} />
              <Route path="/admin/integrations/crm" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/payments" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/email" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/other" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/clubs/:clubId/members" element={<ProtectedRoute><LazyRoute><TelegramClubMembers /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/invites" element={<ProtectedRoute><LazyRoute><TelegramInvites /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/product-mappings" element={<ProtectedRoute><LazyRoute><ProductClubMappings /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/analytics" element={<ProtectedRoute><LazyRoute><AdminLayout><TelegramChatAnalytics /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/telegram-diagnostics" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminTelegramDiagnostics /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/fields" element={<ProtectedRoute><LazyRoute><AdminFieldRegistry /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/system/audit" element={<ProtectedRoute><LazyRoute><AdminSystemAudit /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/system-health" element={<ProtectedRoute><LazyRoute><AdminSystemHealth /></LazyRoute></ProtectedRoute>} />
              
              {/* Admin routes - V2 (Products, Orders, Payments, Subscriptions) */}
              <Route path="/admin/products-v2" element={<ProtectedRoute><LazyRoute><AdminProductsV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/products-v2/:productId" element={<ProtectedRoute><LazyRoute><AdminProductDetailV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/orders-v2" element={<ProtectedRoute><LazyRoute><AdminOrdersV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments-v2" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/subscriptions-v2" element={<ProtectedRoute><LazyRoute><AdminSubscriptionsV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/consents" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminConsents /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/entitlements" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminEntitlements /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/executors" element={<ProtectedRoute><LazyRoute><AdminExecutors /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/document-templates" element={<ProtectedRoute><LazyRoute><AdminDocumentTemplates /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-modules" element={<ProtectedRoute><LazyRoute><AdminTrainingModules /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-modules/:moduleId/lessons" element={<ProtectedRoute><LazyRoute><AdminTrainingLessons /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-lessons/:moduleId/edit/:lessonId" element={<ProtectedRoute><LazyRoute><AdminLessonBlockEditor /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/bepaid-sync" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/refunds-v2" element={<Navigate to="/admin/payments" replace />} />
              {/* Payments Hub routes */}
              <Route path="/admin/payments" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              {/* Route removed: /admin/payments/installments - tab deleted */}
              <Route path="/admin/payments/preorders" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/diagnostics" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/auto-renewals" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/statement" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/bepaid-subscriptions" element={<ProtectedRoute><LazyRoute><AdminBepaidSubscriptions /></LazyRoute></ProtectedRoute>} />
              {/* Legacy redirects */}
              <Route path="/admin/installments" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/preregistrations" element={<Navigate to="/admin/payments/preorders" replace />} />
              <Route path="/admin/bepaid-archive-import" element={<ProtectedRoute><LazyRoute><AdminBepaidArchiveImport /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/support" element={<ProtectedRoute><LazyRoute><AdminSupport /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/news" element={<ProtectedRoute><LazyRoute><AdminNews /></LazyRoute></ProtectedRoute>} />
              
              {/* Admin routes - Editorial */}
              <Route path="/admin/editorial" element={<ProtectedRoute><LazyRoute><AdminEditorial /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/editorial/sources" element={<Navigate to="/admin/editorial" replace />} />
              <Route path="/admin/ilex" element={<ProtectedRoute><LazyRoute><AdminIlex /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/marketing" element={<ProtectedRoute><LazyRoute><AdminMarketingInsights /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/kb-import" element={<ProtectedRoute><LazyRoute><AdminKbImport /></LazyRoute></ProtectedRoute>} />
              
              {/* Legacy redirects - для обратной совместимости */}
              <Route path="/admin/users" element={<Navigate to="/admin/contacts" replace />} />
              <Route path="/admin/users/duplicates" element={<Navigate to="/admin/contacts/duplicates" replace />} />
              <Route path="/admin/products" element={<Navigate to="/admin/products-v2" replace />} />
              <Route path="/admin/amocrm" element={<Navigate to="/admin/integrations/crm" replace />} />
              <Route path="/admin/duplicates" element={<Navigate to="/admin/contacts/duplicates" replace />} />
              
              <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </HelpModeProvider>
        </AuthProvider>
      </IOSAdminGuard>
    </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
