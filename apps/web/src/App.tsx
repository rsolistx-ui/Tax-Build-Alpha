import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedLayout } from "@/components/protected";
import { LoginPage } from "@/pages/login";
import { SignupPage } from "@/pages/signup";
import { ClientsPage } from "@/pages/clients";
import { DashboardPage } from "@/pages/dashboard";
import { ClientWorkspacePage } from "@/pages/client-workspace";
import { BetaAdminPage } from "@/pages/beta-admin";
import { BetaRedeemPage } from "@/pages/beta-redeem";
import { DocumentReviewPage } from "@/pages/document-review";
import { WorkQueuePage } from "@/pages/work-queue";
import { AgentDeskPage } from "@/pages/agent-desk";
import { PortalPage } from "@/pages/portal";
import { ProjectsPage } from "@/pages/projects";
import { CalendarPage } from "@/pages/calendar";
import AnalyticsDashboard from "@/pages/analytics";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/beta-redeem" element={<BetaRedeemPage />} />
        <Route path="/portal" element={<PortalPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientWorkspacePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/beta-admin" element={<BetaAdminPage />} />
          <Route path="/documents/review" element={<DocumentReviewPage />} />
          <Route path="/work-queue" element={<WorkQueuePage />} />
          <Route path="/agent-desk" element={<AgentDeskPage />} />
          <Route path="/analytics" element={<AnalyticsDashboard />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
