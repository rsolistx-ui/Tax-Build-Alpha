import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedLayout } from "@/components/protected";
import { LoginPage } from "@/pages/login";
import { SignupPage } from "@/pages/signup";
import { ClientsPage } from "@/pages/clients";
import { DashboardPage } from "@/pages/dashboard";
import { ClientWorkspacePage } from "@/pages/client-workspace";
import { BetaAdminPage } from "@/pages/beta-admin";
import { DocumentReviewPage } from "@/pages/document-review";
import { WorkQueuePage } from "@/pages/work-queue";
import { PortalPage } from "@/pages/portal";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portal" element={<PortalPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientWorkspacePage />} />
          <Route path="/beta-admin" element={<BetaAdminPage />} />
          <Route path="/documents/review" element={<DocumentReviewPage />} />
          <Route path="/work-queue" element={<WorkQueuePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
