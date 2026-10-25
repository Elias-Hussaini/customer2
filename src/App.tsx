import { Routes, Route } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { DashboardPage } from "./pages/DashboardPage";
import { ListsPage } from "./pages/ListsPage";
import { ListDetailPage } from "./pages/ListDetailPage";
import { CustomersPage } from "./pages/CustomersPage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { RepresentativesPage } from "./pages/RepresentativesPage";
import { RepresentativeDetailPage } from "./pages/RepresentativeDetailPage";
import { RequestFormPage } from "./pages/RequestFormPage";
import { RequestsPage } from "./pages/RequestsPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SearchPage } from "./pages/SearchPage";
import { ArchivePage } from "./pages/ArchivePage";
import { BackupPage } from "./pages/BackupPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DocFillPage } from "./pages/DocFillPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="lists" element={<ListsPage />} />
        <Route path="lists/:id" element={<ListDetailPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route path="representatives" element={<RepresentativesPage />} />
        <Route path="representatives/:id" element={<RepresentativeDetailPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="requests/new" element={<RequestFormPage />} />
        <Route path="requests/:id/edit" element={<RequestFormPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="docfill" element={<DocFillPage />} />
        <Route path="docfill/:customerId" element={<DocFillPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
