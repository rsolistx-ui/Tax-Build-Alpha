import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedLayout } from "@/components/protected";
import { LoginPage } from "@/pages/login";
import { SignupPage } from "@/pages/signup";
import { ClientsPage } from "@/pages/clients";
import { ClientWorkspacePage } from "@/pages/client-workspace";
import { ClientOverviewPage } from "@/pages/client-overview";
import { ClientReceiptsPage } from "@/pages/client-receipts";
import { ClientBankingPage } from "@/pages/client-banking";
import { ClientReportsPage } from "@/pages/client-reports";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientWorkspacePage />}>
            <Route index element={<ClientOverviewPage />} />
            <Route path="receipts" element={<ClientReceiptsPage />} />
            <Route path="banking" element={<ClientBankingPage />} />
            <Route path="reports" element={<ClientReportsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
