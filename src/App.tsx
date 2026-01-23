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
import Landing from "./pages/Landing";
import { DomainHomePage } from "./components/layout/DomainRouter";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import Accountant from "./pages/Accountant";
import Business from "./pages/Business";
import Audits from "./pages/Audits";
import SelfDevelopment from "./pages/SelfDevelopment";
import EisenhowerMatrix from "./pages/tools/EisenhowerMatrix";
import BalanceWheel from "./pages/tools/BalanceWheel";
import Quests from "./pages/self-development/Quests";
import QuestLessons from "./pages/self-development/QuestLessons";
import QuestLesson from "./pages/self-development/QuestLesson";
import HabitTracker from "./pages/self-development/HabitTracker";
import OrderPayment from "./pages/OrderPayment";
import Offer from "./pages/Offer";
import Privacy from "./pages/Privacy";
import Consent from "./pages/Consent";
import Contacts from "./pages/Contacts";
import NotFound from "./pages/NotFound";
import { AdminLayout } from "./components/layout/AdminLayout";
import AdminContacts from "./pages/admin/AdminContacts";
import AdminDeals from "./pages/admin/AdminDeals";
import AdminRoles from "./pages/admin/AdminRoles";
import AdminAudit from "./pages/admin/AdminAudit";
import AdminEntitlements from "./pages/admin/AdminEntitlements";
import AdminContent from "./pages/admin/AdminContent";
import AdminDuplicates from "./pages/admin/AdminDuplicates";
import AdminIntegrations from "./pages/admin/AdminIntegrations";
import TelegramClubMembers from "./pages/admin/TelegramClubMembers";
import TelegramInvites from "./pages/admin/TelegramInvites";
import ProductClubMappings from "./pages/admin/ProductClubMappings";
import TelegramChatAnalytics from "./pages/admin/TelegramChatAnalytics";
import AdminFieldRegistry from "./pages/admin/AdminFieldRegistry";
import AdminProductsV2 from "./pages/admin/AdminProductsV2";
import AdminProductDetailV2 from "./pages/admin/AdminProductDetailV2";
import AdminOrdersV2 from "./pages/admin/AdminOrdersV2";

import AdminPaymentsPage from "./pages/admin/AdminPayments";
import AdminSubscriptionsV2 from "./pages/admin/AdminSubscriptionsV2";
import AdminSystemAudit from "./pages/admin/AdminSystemAudit";
import MnsResponseService from "./pages/audits/MnsResponseService";
import MnsDocumentHistory from "./pages/audits/MnsDocumentHistory";
import Purchases from "./pages/Purchases";
import Pay from "./pages/Pay";
import Documentation from "./pages/Documentation";
import Help from "./pages/Help";
import ProfileSettings from "./pages/settings/Profile";
import PaymentMethodsSettings from "./pages/settings/PaymentMethods";
import ConsentsSettings from "./pages/settings/Consents";
import LegalDetailsSettings from "./pages/settings/LegalDetails";
import AdminInstallments from "./pages/admin/AdminInstallments";
import AdminConsents from "./pages/admin/AdminConsents";
import AdminPreregistrations from "./pages/admin/AdminPreregistrations";
import AdminInbox from "./pages/admin/AdminInbox";
import Learning from "./pages/Learning";
import AdminExecutors from "./pages/admin/AdminExecutors";
import AdminDocumentTemplates from "./pages/admin/AdminDocumentTemplates";
import Consultation from "./pages/Consultation";
import CourseAccountant from "./pages/CourseAccountant";
import AdminBroadcasts from "./pages/admin/AdminBroadcasts";
import Library from "./pages/Library";
import LibraryModule from "./pages/LibraryModule";
import LibraryLesson from "./pages/LibraryLesson";
import AdminTrainingModules from "./pages/admin/AdminTrainingModules";
import AdminTrainingLessons from "./pages/admin/AdminTrainingLessons";
import AdminLessonBlockEditor from "./pages/admin/AdminLessonBlockEditor";
// AdminBepaidSync and AdminRefundsV2 removed - all functionality in /admin/payments
import AdminBepaidArchiveImport from "./pages/admin/AdminBepaidArchiveImport";
import Support from "./pages/Support";
import SupportTicket from "./pages/SupportTicket";
import AdminSupport from "./pages/admin/AdminSupport";
import AdminNews from "./pages/admin/AdminNews";
import AdminCommunication from "./pages/admin/AdminCommunication";
import AdminEditorial from "./pages/admin/AdminEditorial";
import AdminIlex from "./pages/admin/AdminIlex";
import AdminMarketingInsights from "./pages/admin/AdminMarketingInsights";
import AdminPaymentDiagnostics from "./pages/admin/AdminPaymentDiagnostics";

import Money from "./pages/Money";
import AI from "./pages/AI";
import Knowledge from "./pages/Knowledge";
import BusinessTraining from "./pages/BusinessTraining";
import BusinessTrainingContent from "./pages/BusinessTrainingContent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
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
              <Route path="/order-payment" element={<OrderPayment />} />
              <Route path="/offer" element={<Offer />} />
              <Route path="/pay" element={<Pay />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/consent" element={<Consent />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/help" element={<Help />} />
              <Route path="/consultation" element={<Consultation />} />
              <Route path="/course-accountant" element={<CourseAccountant />} />
              <Route path="/business-training" element={<BusinessTraining />} />
              
              {/* Protected routes */}
              <Route path="/products" element={<ProtectedRoute><Learning /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/money" element={<ProtectedRoute><Money /></ProtectedRoute>} />
              <Route path="/ai" element={<ProtectedRoute><AI /></ProtectedRoute>} />
              <Route path="/knowledge" element={<ProtectedRoute><Knowledge /></ProtectedRoute>} />
              <Route path="/purchases" element={<ProtectedRoute><Purchases /></ProtectedRoute>} />
              <Route path="/accountant" element={<ProtectedRoute><Accountant /></ProtectedRoute>} />
              <Route path="/business" element={<ProtectedRoute><Business /></ProtectedRoute>} />
              <Route path="/audits" element={<ProtectedRoute><Audits /></ProtectedRoute>} />
              <Route path="/audits/mns-response" element={<ProtectedRoute><MnsResponseService /></ProtectedRoute>} />
              <Route path="/audits/mns-history" element={<ProtectedRoute><MnsDocumentHistory /></ProtectedRoute>} />
              <Route path="/self-development" element={<ProtectedRoute><SelfDevelopment /></ProtectedRoute>} />
              <Route path="/self-development/quests" element={<ProtectedRoute><Quests /></ProtectedRoute>} />
              <Route path="/self-development/quests/:questSlug" element={<ProtectedRoute><QuestLessons /></ProtectedRoute>} />
              <Route path="/self-development/quests/:questSlug/:lessonSlug" element={<ProtectedRoute><QuestLesson /></ProtectedRoute>} />
              <Route path="/self-development/habits" element={<ProtectedRoute><HabitTracker /></ProtectedRoute>} />
              <Route path="/self-development/balance-wheel" element={<ProtectedRoute><BalanceWheel /></ProtectedRoute>} />
              <Route path="/tools" element={<Navigate to="/tools/eisenhower" replace />} />
              <Route path="/tools/eisenhower" element={<ProtectedRoute><EisenhowerMatrix /></ProtectedRoute>} />
              <Route path="/tools/balance-wheel" element={<Navigate to="/self-development/balance-wheel" replace />} />
              <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
              <Route path="/support/:ticketId" element={<ProtectedRoute><SupportTicket /></ProtectedRoute>} />
              <Route path="/docs" element={<ProtectedRoute><Documentation /></ProtectedRoute>} />
              <Route path="/library" element={<ProtectedRoute><Library /></ProtectedRoute>} />
              <Route path="/library/buh-business" element={<ProtectedRoute><BusinessTrainingContent /></ProtectedRoute>} />
              <Route path="/library/:moduleSlug" element={<ProtectedRoute><LibraryModule /></ProtectedRoute>} />
              <Route path="/library/:moduleSlug/:lessonSlug" element={<ProtectedRoute><LibraryLesson /></ProtectedRoute>} />
              
              {/* Settings routes */}
              <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
              <Route path="/settings/profile" element={<ProtectedRoute><ProfileSettings /></ProtectedRoute>} />
              <Route path="/settings/payment-methods" element={<ProtectedRoute><PaymentMethodsSettings /></ProtectedRoute>} />
              <Route path="/settings/legal-details" element={<ProtectedRoute><LegalDetailsSettings /></ProtectedRoute>} />
              <Route path="/settings/consents" element={<ProtectedRoute><ConsentsSettings /></ProtectedRoute>} />
              <Route path="/settings/subscriptions" element={<Navigate to="/purchases" replace />} />
              
              {/* Admin routes - CRM */}
              <Route path="/admin" element={<Navigate to="/admin/deals" replace />} />
              <Route path="/admin/inbox" element={<ProtectedRoute><AdminInbox /></ProtectedRoute>} />
              <Route path="/admin/communication" element={<ProtectedRoute><AdminCommunication /></ProtectedRoute>} />
              <Route path="/admin/broadcasts" element={<ProtectedRoute><AdminBroadcasts /></ProtectedRoute>} />
              <Route path="/admin/contacts" element={<ProtectedRoute><AdminLayout><AdminContacts /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/contacts/duplicates" element={<ProtectedRoute><AdminLayout><AdminDuplicates /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/deals" element={<ProtectedRoute><AdminLayout><AdminDeals /></AdminLayout></ProtectedRoute>} />
              
              {/* Admin routes - Service */}
              <Route path="/admin/roles" element={<ProtectedRoute><AdminLayout><AdminRoles /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute><AdminLayout><AdminAudit /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/content" element={<ProtectedRoute><AdminLayout><AdminContent /></AdminLayout></ProtectedRoute>} />
              
              {/* Integrations routes */}
              <Route path="/admin/integrations" element={<Navigate to="/admin/integrations/crm" replace />} />
              <Route path="/admin/integrations/crm" element={<ProtectedRoute><AdminLayout><AdminIntegrations /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/integrations/payments" element={<ProtectedRoute><AdminLayout><AdminIntegrations /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/integrations/email" element={<ProtectedRoute><AdminLayout><AdminIntegrations /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram" element={<ProtectedRoute><AdminLayout><AdminIntegrations /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/integrations/other" element={<ProtectedRoute><AdminLayout><AdminIntegrations /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/clubs/:clubId/members" element={<ProtectedRoute><TelegramClubMembers /></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/invites" element={<ProtectedRoute><TelegramInvites /></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/product-mappings" element={<ProtectedRoute><ProductClubMappings /></ProtectedRoute>} />
              <Route path="/admin/integrations/telegram/analytics" element={<ProtectedRoute><AdminLayout><TelegramChatAnalytics /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/fields" element={<ProtectedRoute><AdminFieldRegistry /></ProtectedRoute>} />
              <Route path="/admin/system/audit" element={<ProtectedRoute><AdminSystemAudit /></ProtectedRoute>} />
              
              {/* Admin routes - V2 (Products, Orders, Payments, Subscriptions) */}
              <Route path="/admin/products-v2" element={<ProtectedRoute><AdminProductsV2 /></ProtectedRoute>} />
              <Route path="/admin/products-v2/:productId" element={<ProtectedRoute><AdminProductDetailV2 /></ProtectedRoute>} />
              <Route path="/admin/orders-v2" element={<ProtectedRoute><AdminOrdersV2 /></ProtectedRoute>} />
              <Route path="/admin/payments-v2" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/subscriptions-v2" element={<ProtectedRoute><AdminSubscriptionsV2 /></ProtectedRoute>} />
              <Route path="/admin/installments" element={<ProtectedRoute><AdminInstallments /></ProtectedRoute>} />
              <Route path="/admin/consents" element={<ProtectedRoute><AdminLayout><AdminConsents /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/preregistrations" element={<ProtectedRoute><AdminPreregistrations /></ProtectedRoute>} />
              <Route path="/admin/entitlements" element={<ProtectedRoute><AdminLayout><AdminEntitlements /></AdminLayout></ProtectedRoute>} />
              <Route path="/admin/executors" element={<ProtectedRoute><AdminExecutors /></ProtectedRoute>} />
              <Route path="/admin/document-templates" element={<ProtectedRoute><AdminDocumentTemplates /></ProtectedRoute>} />
              <Route path="/admin/training-modules" element={<ProtectedRoute><AdminTrainingModules /></ProtectedRoute>} />
              <Route path="/admin/training-modules/:moduleId/lessons" element={<ProtectedRoute><AdminTrainingLessons /></ProtectedRoute>} />
              <Route path="/admin/training-lessons/:moduleId/edit/:lessonId" element={<ProtectedRoute><AdminLessonBlockEditor /></ProtectedRoute>} />
              <Route path="/admin/bepaid-sync" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/refunds-v2" element={<Navigate to="/admin/payments" replace />} />
              <Route path="/admin/payments" element={<ProtectedRoute><AdminPaymentsPage /></ProtectedRoute>} />
              <Route path="/admin/payments/diagnostics" element={<ProtectedRoute><AdminPaymentDiagnostics /></ProtectedRoute>} />
              <Route path="/admin/bepaid-archive-import" element={<ProtectedRoute><AdminBepaidArchiveImport /></ProtectedRoute>} />
              <Route path="/admin/support" element={<ProtectedRoute><AdminSupport /></ProtectedRoute>} />
              <Route path="/admin/news" element={<ProtectedRoute><AdminNews /></ProtectedRoute>} />
              
              {/* Admin routes - Editorial */}
              <Route path="/admin/editorial" element={<ProtectedRoute><AdminEditorial /></ProtectedRoute>} />
              <Route path="/admin/editorial/sources" element={<Navigate to="/admin/editorial" replace />} />
              <Route path="/admin/ilex" element={<ProtectedRoute><AdminIlex /></ProtectedRoute>} />
              <Route path="/admin/marketing" element={<ProtectedRoute><AdminMarketingInsights /></ProtectedRoute>} />
              
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
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
