import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { HelpModeProvider } from "@/contexts/HelpModeContext";
// ImpersonationBar moved inside DashboardLayout (authenticated shell only)
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { SectionGuard } from "@/components/layout/SectionGuard";
import { ScrollToTop } from "@/components/layout/ScrollToTop";
import { GlobalPaymentHandler } from "@/components/payment/GlobalPaymentHandler";
import { initExternalLinkKillSwitch, BUILD_MARKER } from "@/lib/externalLinkKillSwitch";
import { LazyErrorBoundary } from "@/components/system/LazyErrorBoundary";

import { Loader2 } from "lucide-react";

// Critical pages - Landing/DomainHomePage loaded immediately (first screen)
import Landing from "./pages/Landing";
import { DomainHomePage } from "./components/layout/DomainRouter";

// Non-landing pages - lazy loaded to reduce initial bundle
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Auth = lazy(() => import("./pages/Auth"));
const AuthVerifyProxy = lazy(() => import("./pages/AuthVerifyProxy"));
const NotFound = lazy(() => import("./pages/NotFound"));
const SitePageBySlug = lazy(() => import("./pages/SitePageBySlug"));
const EmbedFormPage = lazy(() => import("./pages/embed/EmbedFormPage"));
const DocumentDownloadPage = lazy(() => import("./pages/DocumentDownloadPage"));

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
const Instruction = lazy(() => import("./pages/Instruction"));
const Contacts = lazy(() => import("./pages/Contacts"));
const MnsResponseService = lazy(() => import("./pages/audits/MnsResponseService"));
const MnsDocumentHistory = lazy(() => import("./pages/audits/MnsDocumentHistory"));
const Purchases = lazy(() => import("./pages/Purchases"));
const Pay = lazy(() => import("./pages/Pay"));
const PublicPayPage = lazy(() => import("./pages/PublicPayPage"));
const PaymentResultPage = lazy(() => import("./pages/PaymentResultPage"));
const Documentation = lazy(() => import("./pages/Documentation"));
const Help = lazy(() => import("./pages/Help"));
const ProfileSettings = lazy(() => import("./pages/settings/Profile"));
const PaymentMethodsSettings = lazy(() => import("./pages/settings/PaymentMethods"));
const ConsentsSettings = lazy(() => import("./pages/settings/Consents"));
const LegalDetailsSettings = lazy(() => import("./pages/settings/LegalDetails"));
const UserRequisitesSettings = lazy(() => import("./pages/settings/UserRequisites"));
const Learning = lazy(() => import("./pages/Learning"));
const Consultation = lazy(() => import("./pages/Consultation"));
const CourseAccountant = lazy(() => import("./pages/CourseAccountant"));
const CloseYear = lazy(() => import("./pages/CloseYear"));
const ProductPricing = lazy(() => import("./pages/ProductPricing"));
const TariffPricing = lazy(() => import("./pages/TariffPricing"));

const LibraryModule = lazy(() => import("./pages/LibraryModule"));
const LibraryLesson = lazy(() => import("./pages/LibraryLesson"));
const Support = lazy(() => import("./pages/Support"));
const SupportTicket = lazy(() => import("./pages/SupportTicket"));
const Money = lazy(() => import("./pages/Money"));
const AI = lazy(() => import("./pages/AI"));
const DocumentGeneration = lazy(() => import("./pages/DocumentGeneration"));
const Knowledge = lazy(() => import("./pages/Knowledge"));
const LiveEvents = lazy(() => import("./pages/LiveEvents"));
const BusinessTraining = lazy(() => import("./pages/BusinessTraining"));
const BusinessTrainingContent = lazy(() => import("./pages/BusinessTrainingContent"));

const Banned = lazy(() => import("./pages/Banned"));

// Admin pages - lazy loaded (heavy components)
const AdminLayout = lazy(() => import("./components/layout/AdminLayout").then(m => ({ default: m.AdminLayout })));
const AdminContacts = lazy(() => import("./pages/admin/AdminContacts"));
const AdminDeals = lazy(() => import("./pages/admin/AdminDeals"));
const AdminRoles = lazy(() => import("./pages/admin/AdminRoles"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit"));
const AdminTenants = lazy(() => import("./pages/admin/AdminTenants"));
const AdminEntitlements = lazy(() => import("./pages/admin/AdminEntitlements"));
const AdminContent = lazy(() => import("./pages/admin/AdminContent"));
const AdminDuplicates = lazy(() => import("./pages/admin/AdminDuplicates"));
const AdminIntegrations = lazy(() => import("./pages/admin/AdminIntegrations"));
// UI-only PATCH (Phase 2): Stripe настраивается из /admin/integrations/payments,
// отдельный маршрут /admin/integrations/acquiring убран.

const TelegramClubMembers = lazy(() => import("./pages/admin/TelegramClubMembers"));
const TelegramInvites = lazy(() => import("./pages/admin/TelegramInvites"));
const ProductClubMappings = lazy(() => import("./pages/admin/ProductClubMappings"));
const TelegramChatAnalytics = lazy(() => import("./pages/admin/TelegramChatAnalytics"));
const AdminFieldRegistry = lazy(() => import("./pages/admin/AdminFieldRegistry"));
const AdminProductsV2 = lazy(() => import("./pages/admin/AdminProductsV2"));
const AdminProductDetailV2 = lazy(() => import("./pages/admin/AdminProductDetailV2"));
const AdminProductsDocs = lazy(() => import("./pages/admin/AdminProductsDocs"));
const AdminSystemDocs = lazy(() => import("./pages/admin/AdminSystemDocs"));
const AdminOrdersV2 = lazy(() => import("./pages/admin/AdminOrdersV2"));
const AdminPaymentsPage = lazy(() => import("./pages/admin/AdminPayments"));
const AdminPaymentsHub = lazy(() => import("./pages/admin/AdminPaymentsHub"));
const AdminSubscriptionsV2 = lazy(() => import("./pages/admin/AdminSubscriptionsV2"));
const AdminSystemAudit = lazy(() => import("./pages/admin/AdminSystemAudit"));
const AdminSystemHealth = lazy(() => import("./pages/admin/AdminSystemHealth"));
const AdminConsents = lazy(() => import("./pages/admin/AdminConsents"));
const AdminPreregistrations = lazy(() => import("./pages/admin/AdminPreregistrations"));
const AdminFormsHub = lazy(() => import("./pages/admin/AdminFormsHub"));
// AdminInbox removed - redirects to /admin/communication
const AdminExecutors = lazy(() => import("./pages/admin/AdminExecutors"));
const AdminDocumentTemplates = lazy(() => import("./pages/admin/AdminDocumentTemplates"));
const AdminDocumentsNumbering = lazy(() => import("./pages/admin/AdminDocumentsNumbering"));
// AdminBroadcasts removed - redirects to /admin/communication?tab=broadcasts
const AdminTrainingModules = lazy(() => import("./pages/admin/AdminTrainingModules"));
const AdminTrainingLessons = lazy(() => import("./pages/admin/AdminTrainingLessons"));
const AdminLessonBlockEditor = lazy(() => import("./pages/admin/AdminLessonBlockEditor"));
const AdminLessonProgress = lazy(() => import("./pages/admin/AdminLessonProgress"));
const AdminBepaidArchiveImport = lazy(() => import("./pages/admin/AdminBepaidArchiveImport"));
const AdminSupport = lazy(() => import("./pages/admin/AdminSupport"));
const AdminNews = lazy(() => import("./pages/admin/AdminNews"));
const AdminCommunication = lazy(() => import("./pages/admin/AdminCommunication"));
const AdminEditorial = lazy(() => import("./pages/admin/AdminEditorial"));
const AdminIlex = lazy(() => import("./pages/admin/AdminIlex"));
const AdminAI = lazy(() => import("./pages/admin/AdminAI"));
const AdminDocuments = lazy(() => import("./pages/admin/AdminDocuments"));
const AdminMarketingInsights = lazy(() => import("./pages/admin/AdminMarketingInsights"));
const AdminPaymentDiagnostics = lazy(() => import("./pages/admin/AdminPaymentDiagnostics"));
const AdminTelegramDiagnostics = lazy(() => import("./pages/admin/AdminTelegramDiagnostics"));
const AdminTelegramInviteAudit = lazy(() => import("./pages/admin/AdminTelegramInviteAudit"));
const AdminTelegramAuditShapeRuns = lazy(() => import("./pages/admin/AdminTelegramAuditShapeRuns"));
const AdminSections = lazy(() => import("./pages/admin/AdminSections"));
const AdminKbImport = lazy(() => import("./pages/admin/AdminKbImport"));
const AdminSiteBuilder = lazy(() => import("./pages/admin/AdminSiteBuilder"));
const AdminSiteEditor = lazy(() => import("./pages/admin/AdminSiteEditor"));
const AdminLiveEvents = lazy(() => import("./pages/admin/AdminLiveEvents"));
const LiveEvent = lazy(() => import("./pages/LiveEvent"));
const LiveAccessEntry = lazy(() => import("./pages/LiveAccessEntry"));
// AdminBepaidSubscriptions removed - redirects to /admin/payments/bepaid-subscriptions

// Page loader component for Suspense fallback
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted to-background">
    <Loader2 className="h-8 w-8 animate-spin text-primary" />
  </div>
);

// Wrapper for lazy routes with Suspense
const LazyRoute = ({ children }: { children: React.ReactNode }) => (
  <LazyErrorBoundary>
    <Suspense fallback={<PageLoader />}>{children}</Suspense>
  </LazyErrorBoundary>
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
  return (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
          <AuthProvider>
            <HelpModeProvider>
              <ScrollToTop />
              <GlobalPaymentHandler />
              <div className="impersonation-offset">
                <Routes>
              {/* Public routes */}
              <Route path="/" element={<DomainHomePage />} />
              <Route path="/auth" element={<LazyRoute><Auth /></LazyRoute>} />
              <Route path="/pricing/tariff/:tariffPublicId" element={<LazyRoute><TariffPricing /></LazyRoute>} />
              <Route path="/pricing/:productSlug" element={<LazyRoute><ProductPricing /></LazyRoute>} />
              <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
              <Route path="/order-payment" element={<LazyRoute><OrderPayment /></LazyRoute>} />
              <Route path="/offer" element={<LazyRoute><Offer /></LazyRoute>} />
              <Route path="/pay/:token" element={<LazyRoute><PublicPayPage /></LazyRoute>} />
              <Route path="/pay" element={<LazyRoute><Pay /></LazyRoute>} />
              <Route path="/payment/result" element={<LazyRoute><PaymentResultPage /></LazyRoute>} />
              <Route path="/document-download/:documentId" element={<LazyRoute><DocumentDownloadPage /></LazyRoute>} />
              <Route path="/privacy" element={<LazyRoute><Privacy /></LazyRoute>} />
              <Route path="/consent" element={<LazyRoute><Consent /></LazyRoute>} />
              <Route path="/instruction" element={<LazyRoute><Instruction /></LazyRoute>} />
              <Route path="/contacts" element={<LazyRoute><Contacts /></LazyRoute>} />
              <Route path="/help" element={<LazyRoute><Help /></LazyRoute>} />
              <Route path="/consultation" element={<LazyRoute><Consultation /></LazyRoute>} />
              <Route path="/course-accountant" element={<LazyRoute><CourseAccountant /></LazyRoute>} />
              <Route path="/close-year" element={<LazyRoute><CloseYear /></LazyRoute>} />
              <Route path="/business-training" element={<LazyRoute><BusinessTraining /></LazyRoute>} />
              <Route path="/club" element={<Landing />} />
              
              <Route path="/banned" element={<LazyRoute><Banned /></LazyRoute>} />
              <Route path="/live" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="live"><LiveEvents /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/live/:slug" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="live"><LiveEvent /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/live-access/:token" element={<LazyRoute><LiveAccessEntry /></LazyRoute>} />
              
              {/* Protected routes */}
              <Route path="/products" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="products"><Learning /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="dashboard"><Dashboard /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/money" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="money"><Money /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/ai" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="ai"><AI /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/document-generation" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="document_generation"><DocumentGeneration /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/knowledge" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="knowledge"><Knowledge /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/purchases" element={<ProtectedRoute><LazyRoute><Purchases /></LazyRoute></ProtectedRoute>} />
              <Route path="/accountant" element={<ProtectedRoute><LazyRoute><Accountant /></LazyRoute></ProtectedRoute>} />
              <Route path="/business" element={<ProtectedRoute><LazyRoute><Business /></LazyRoute></ProtectedRoute>} />
              <Route path="/audits" element={<ProtectedRoute><LazyRoute><Audits /></LazyRoute></ProtectedRoute>} />
              <Route path="/audits/mns-response" element={<ProtectedRoute><LazyRoute><MnsResponseService /></LazyRoute></ProtectedRoute>} />
              <Route path="/audits/mns-history" element={<ProtectedRoute><LazyRoute><MnsDocumentHistory /></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="self_development"><SelfDevelopment /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/quests" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="self_development"><Quests /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/quests/:questSlug" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="self_development"><QuestLessons /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/quests/:questSlug/:lessonSlug" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="self_development"><QuestLesson /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/habits" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="self_development"><HabitTracker /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/self-development/balance-wheel" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="self_development"><BalanceWheel /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/tools" element={<Navigate to="/tools/eisenhower" replace />} />
              <Route path="/tools/eisenhower" element={<ProtectedRoute><LazyRoute><SectionGuard sectionCode="eisenhower"><EisenhowerMatrix /></SectionGuard></LazyRoute></ProtectedRoute>} />
              <Route path="/tools/balance-wheel" element={<Navigate to="/self-development/balance-wheel" replace />} />
              <Route path="/support" element={<ProtectedRoute><LazyRoute><Support /></LazyRoute></ProtectedRoute>} />
              <Route path="/support/:ticketId" element={<ProtectedRoute><LazyRoute><SupportTicket /></LazyRoute></ProtectedRoute>} />
              <Route path="/docs" element={<ProtectedRoute><LazyRoute><Documentation /></LazyRoute></ProtectedRoute>} />
              <Route path="/library" element={<Navigate to="/knowledge" replace />} />
              <Route path="/library/buh-business" element={<ProtectedRoute><LazyRoute><BusinessTrainingContent /></LazyRoute></ProtectedRoute>} />
              <Route path="/library/:moduleSlug" element={<ProtectedRoute><LazyRoute><LibraryModule /></LazyRoute></ProtectedRoute>} />
              <Route path="/library/:moduleSlug/:lessonSlug" element={<ProtectedRoute><LazyRoute><LibraryLesson /></LazyRoute></ProtectedRoute>} />
              
              {/* Settings routes */}
              <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
              <Route path="/settings/profile" element={<ProtectedRoute><LazyRoute><ProfileSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/payment-methods" element={<ProtectedRoute><LazyRoute><PaymentMethodsSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/legal-details" element={<ProtectedRoute><LazyRoute><LegalDetailsSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/user-requisites" element={<ProtectedRoute><LazyRoute><UserRequisitesSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/consents" element={<ProtectedRoute><LazyRoute><ConsentsSettings /></LazyRoute></ProtectedRoute>} />
              <Route path="/settings/subscriptions" element={<Navigate to="/purchases" replace />} />
              
              {/* Admin routes - CRM */}
              <Route path="/admin" element={<Navigate to="/admin/communication" replace />} />
              <Route path="/admin/inbox" element={<Navigate to="/admin/communication" replace />} />
              <Route path="/admin/communication" element={<ProtectedRoute><LazyRoute><AdminCommunication /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/broadcasts" element={<Navigate to="/admin/communication?tab=broadcasts" replace />} />
              <Route path="/admin/contacts" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminContacts /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/contacts/duplicates" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminDuplicates /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/deals" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminDeals /></AdminLayout></LazyRoute></ProtectedRoute>} />
              
              {/* Admin routes - Service */}
              <Route path="/admin/roles" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminRoles /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminAudit /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/tenants" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminTenants /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/content" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminContent /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/sections" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminSections /></AdminLayout></LazyRoute></ProtectedRoute>} />
              
              {/* Integrations routes */}
              <Route path="/admin/integrations" element={<Navigate to="/admin/integrations/crm" replace />} />
              <Route path="/admin/integrations/crm" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/payments" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/email" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/other" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/socials" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminIntegrations /></AdminLayout></LazyRoute></ProtectedRoute>} />
              {/* /admin/integrations/acquiring removed (UI merge patch — Stripe lives in /admin/integrations/payments). */}
              <Route path="/admin/integrations/telegram/clubs/:clubId/members" element={<ProtectedRoute><LazyRoute><TelegramClubMembers /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/invites" element={<ProtectedRoute><LazyRoute><TelegramInvites /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/product-mappings" element={<ProtectedRoute><LazyRoute><ProductClubMappings /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/analytics" element={<ProtectedRoute><LazyRoute><AdminLayout><TelegramChatAnalytics /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/telegram-diagnostics" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminTelegramDiagnostics /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/telegram/invite-audit" element={<ProtectedRoute><LazyRoute><AdminTelegramInviteAudit /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/telegram/audit-shape-runs" element={<ProtectedRoute><LazyRoute><AdminTelegramAuditShapeRuns /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/fields" element={<ProtectedRoute><LazyRoute><AdminFieldRegistry /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/system/audit" element={<ProtectedRoute><LazyRoute><AdminSystemAudit /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/system-health" element={<ProtectedRoute><LazyRoute><AdminSystemHealth /></LazyRoute></ProtectedRoute>} />
              
              {/* Admin routes - V2 (Products, Orders, Payments, Subscriptions) */}
              <Route path="/admin/products-v2" element={<ProtectedRoute><LazyRoute><AdminProductsV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/products-v2/docs" element={<ProtectedRoute><LazyRoute><AdminProductsDocs /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/docs" element={<ProtectedRoute><LazyRoute><AdminSystemDocs /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/products-v2/:productId" element={<ProtectedRoute><LazyRoute><AdminProductDetailV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/orders-v2" element={<ProtectedRoute><LazyRoute><AdminOrdersV2 /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments-v2" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/subscriptions-v2" element={<AdminSubscriptionsV2 />} />
              <Route path="/admin/consents" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminConsents /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/entitlements" element={<ProtectedRoute><LazyRoute><AdminLayout><AdminEntitlements /></AdminLayout></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/executors" element={<ProtectedRoute><LazyRoute><AdminExecutors /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/document-templates" element={<ProtectedRoute><LazyRoute><AdminDocumentTemplates /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/documents/numbering" element={<ProtectedRoute><LazyRoute><AdminDocumentsNumbering /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-modules" element={<ProtectedRoute><LazyRoute><AdminTrainingModules /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-modules/:moduleId/lessons" element={<ProtectedRoute><LazyRoute><AdminTrainingLessons /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-lessons/:moduleId/edit/:lessonId" element={<ProtectedRoute><LazyRoute><AdminLessonBlockEditor /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/training-lessons/:moduleId/progress/:lessonId" element={<ProtectedRoute><LazyRoute><AdminLessonProgress /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/bepaid-sync" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/refunds-v2" element={<Navigate to="/admin/payments" replace />} />
              {/* Payments Hub routes */}
              <Route path="/admin/payments" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              {/* Route removed: /admin/payments/installments - tab deleted */}
              <Route path="/admin/payments/preorders" element={<Navigate to="/admin/forms?tab=preorders" replace />} />
              <Route path="/admin/payments/diagnostics" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/auto-renewals" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/statement" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/links" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/payments/bepaid-subscriptions" element={<ProtectedRoute><LazyRoute><AdminPaymentsHub /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/bepaid-subscriptions" element={<Navigate to="/admin/payments/bepaid-subscriptions" replace />} />
              {/* Forms Hub */}
              <Route path="/admin/forms" element={<ProtectedRoute><LazyRoute><AdminFormsHub /></LazyRoute></ProtectedRoute>} />
              {/* Legacy redirects */}
              <Route path="/admin/installments" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/preregistrations" element={<Navigate to="/admin/forms?tab=preorders" replace />} />
              <Route path="/admin/bepaid-archive-import" element={<ProtectedRoute><LazyRoute><AdminBepaidArchiveImport /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/support" element={<ProtectedRoute><LazyRoute><AdminSupport /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/news" element={<ProtectedRoute><LazyRoute><AdminNews /></LazyRoute></ProtectedRoute>} />
              
              {/* Admin routes - Editorial */}
              <Route path="/admin/editorial" element={<ProtectedRoute><LazyRoute><AdminEditorial /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/editorial/sources" element={<Navigate to="/admin/editorial" replace />} />
              <Route path="/admin/ilex" element={<ProtectedRoute><LazyRoute><AdminIlex /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/ai" element={<ProtectedRoute><LazyRoute><AdminAI /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/documents" element={<ProtectedRoute><LazyRoute><AdminDocuments /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/marketing" element={<ProtectedRoute><LazyRoute><AdminMarketingInsights /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/kb-import" element={<ProtectedRoute><LazyRoute><AdminKbImport /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/sites" element={<ProtectedRoute><LazyRoute><AdminSiteBuilder /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/sites/:id" element={<ProtectedRoute><LazyRoute><AdminSiteEditor /></LazyRoute></ProtectedRoute>} />
              <Route path="/admin/live-events" element={<ProtectedRoute><LazyRoute><AdminLiveEvents /></LazyRoute></ProtectedRoute>} />
              
              {/* Legacy redirects - для обратной совместимости */}
              <Route path="/admin/users" element={<Navigate to="/admin/contacts" replace />} />
              <Route path="/admin/users/duplicates" element={<Navigate to="/admin/contacts/duplicates" replace />} />
              <Route path="/admin/products" element={<Navigate to="/admin/products-v2" replace />} />
              <Route path="/admin/amocrm" element={<Navigate to="/admin/integrations/crm" replace />} />
              <Route path="/admin/duplicates" element={<Navigate to="/admin/contacts/duplicates" replace />} />
              
              {/* Public embed routes (без AdminLayout, без auth) */}
              <Route path="/embed/form/:pageId/:blockId" element={<LazyRoute><EmbedFormPage /></LazyRoute>} />

              {/* Public slug resolution layer — explicit static routes always take priority */}
              <Route path="/:slug" element={<LazyRoute><SitePageBySlug /></LazyRoute>} />
              <Route path="*" element={<LazyRoute><NotFound /></LazyRoute>} />
              </Routes>
            </div>
          </HelpModeProvider>
        </AuthProvider>
    </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  );
};

export default App;
