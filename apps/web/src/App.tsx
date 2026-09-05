import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedLayout } from "@/components/protected";
import { LoginPage } from "@/pages/login";
import { SignupPage } from "@/pages/signup";
import { ClientsPage } from "@/pages/clients";
import { ClientWorkspacePage } from "@/pages/client-workspace";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<ClientsPage />} />
          <Route path="/clients/:clientId" element={<ClientWorkspacePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
