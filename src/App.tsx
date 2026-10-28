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
import { MonthlyStatsPage } from "./pages/MonthlyStatsPage";
import { SearchPage } from "./pages/SearchPage";
import { ArchivePage } from "./pages/ArchivePage";
import { SmartArchivePage } from "./pages/SmartArchivePage";
import { BackupPage } from "./pages/BackupPage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { AccountingShell } from "./pages/accounting/AccountingShell";
import { AccDashboardPage } from "./pages/accounting/AccDashboardPage";
import { AccPartiesPage } from "./pages/accounting/AccPartiesPage";
import { AccPartyProfilePage } from "./pages/accounting/AccPartyProfilePage";
import { AccTransactionsPage } from "./pages/accounting/AccTransactionsPage";
import { AccAccountsPage } from "./pages/accounting/AccAccountsPage";
import { AccAccountDetailPage } from "./pages/accounting/AccAccountDetailPage";
import { AccOutstandingPage } from "./pages/accounting/AccOutstandingPage";
import { AccDocumentsPage } from "./pages/accounting/AccDocumentsPage";
import { AccReportsPage } from "./pages/accounting/AccReportsPage";
import { AccBackupPage } from "./pages/accounting/AccBackupPage";

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
        <Route path="stats" element={<MonthlyStatsPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="archive" element={<ArchivePage />} />
        <Route path="smart-archive" element={<SmartArchivePage />} />
        <Route path="backup" element={<BackupPage />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* Accounting section — a separate financial world */}
        <Route path="accounting" element={<AccountingShell />}>
          <Route index element={<AccDashboardPage />} />
          <Route path="parties" element={<AccPartiesPage />} />
          <Route path="parties/:id" element={<AccPartyProfilePage />} />
          <Route path="transactions" element={<AccTransactionsPage />} />
          <Route path="accounts" element={<AccAccountsPage />} />
          <Route path="accounts/:id" element={<AccAccountDetailPage />} />
          <Route path="outstanding" element={<AccOutstandingPage />} />
          <Route path="documents" element={<AccDocumentsPage />} />
          <Route path="reports" element={<AccReportsPage />} />
          <Route path="backup" element={<AccBackupPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
