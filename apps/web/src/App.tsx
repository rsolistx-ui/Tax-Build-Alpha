import { lazy, Suspense } from "react";
import { AllClientsOnly } from "@/lib/firm-role";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedLayout } from "@/components/protected";
import { ChunkLoadRecovery } from "@/components/chunk-load-recovery";
import { LoginPage } from "@/pages/login";

const SignupPage = lazy(() => import("@/pages/signup").then((module) => ({ default: module.SignupPage })));
const ClientsPage = lazy(() => import("@/pages/clients").then((module) => ({ default: module.ClientsPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard").then((module) => ({ default: module.DashboardPage })));
const ClientWorkspacePage = lazy(() => import("@/pages/client-workspace").then((module) => ({ default: module.ClientWorkspacePage })));
const AdminPanel = lazy(() => import("@/pages/admin/admin-panel").then((module) => ({ default: module.AdminPanel })));
const BetaRedeemPage = lazy(() => import("@/pages/beta-redeem").then((module) => ({ default: module.BetaRedeemPage })));
const JoinFirmPage = lazy(() => import("@/pages/join").then((module) => ({ default: module.JoinFirmPage })));
const DocumentReviewPage = lazy(() => import("@/pages/document-review").then((module) => ({ default: module.DocumentReviewPage })));
const WorkQueuePage = lazy(() => import("@/pages/work-queue").then((module) => ({ default: module.WorkQueuePage })));
const TaxWorkbenchPage = lazy(() => import("@/pages/tax-workbench").then((module) => ({ default: module.TaxWorkbenchPage })));
const TeamPage = lazy(() => import("@/pages/team").then((module) => ({ default: module.TeamPage })));
const AgentDeskPage = lazy(() => import("@/pages/agent-desk").then((module) => ({ default: module.AgentDeskPage })));
const PortalPage = lazy(() => import("@/pages/portal").then((module) => ({ default: module.PortalPage })));
const ConsentPage = lazy(() => import("@/pages/consent").then((module) => ({ default: module.ConsentPage })));
const SignPage = lazy(() => import("@/pages/sign").then((module) => ({ default: module.SignPage })));
const ProjectsPage = lazy(() => import("@/pages/projects").then((module) => ({ default: module.ProjectsPage })));
const CalendarPage = lazy(() => import("@/pages/calendar").then((module) => ({ default: module.CalendarPage })));
const AnalyticsDashboard = lazy(() => import("@/pages/analytics"));
const ConnectionsPage = lazy(() => import("@/pages/connections").then((module) => ({ default: module.ConnectionsPage })));

function RouteLoading() {
  return <div className="flex min-h-40 items-center justify-center text-sm text-[var(--color-muted-foreground)]" role="status">Opening workspace…</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ChunkLoadRecovery>
      <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/beta-redeem" element={<BetaRedeemPage />} />
        <Route path="/join" element={<JoinFirmPage />} />
        <Route path="/redeem" element={<Navigate to="/beta-redeem" replace />} />
        <Route path="/portal" element={<PortalPage />} />
        <Route path="/sign" element={<SignPage />} />
        <Route path="/consent" element={<ConsentPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientWorkspacePage />} />
          <Route path="/projects" element={<AllClientsOnly><ProjectsPage /></AllClientsOnly>} />
          <Route path="/calendar" element={<AllClientsOnly><CalendarPage /></AllClientsOnly>} />
          <Route path="/control" element={<AdminPanel />} />
          <Route path="/system-control" element={<AdminPanel />} />
          <Route path="/admin" element={<Navigate to="/control" replace />} />
          <Route path="/beta-admin" element={<Navigate to="/control" replace />} />
          <Route path="/documents/review" element={<DocumentReviewPage />} />
          <Route path="/work-queue" element={<WorkQueuePage />} />
          <Route path="/workbench" element={<TaxWorkbenchPage />} />
          <Route path="/team" element={<TeamPage />} />
          <Route path="/agent-desk" element={<AgentDeskPage />} />
          <Route path="/analytics" element={<AllClientsOnly><AnalyticsDashboard /></AllClientsOnly>} />
          <Route path="/connections" element={<AllClientsOnly><ConnectionsPage /></AllClientsOnly>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </ChunkLoadRecovery>
    </BrowserRouter>
  );
}
