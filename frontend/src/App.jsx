import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { EntityListPage, EntityDetailPage } from './pages/EntityPages';
import Pipeline from './pages/Pipeline';
import QuotationEditor from './pages/QuotationEditor';
import { ApprovalsPage, ApprovalDetailPage } from './pages/Approvals';
import { ClaimPage, PaymentsPage, CommissionPage } from './pages/Finance';
import ForecastPage from './pages/Forecast';
import { ReportsPage, AnalyticsPage } from './pages/Reports';
import { CalendarPage, MyWorkPage, OrgChartPage } from './pages/Work';
import { AdminOverview, PermissionsPage, AuditPage, AppSettingsPage, DataQualityPage, OrgPage, IntegrationLogs } from './pages/Admin';
import { MySettingsPage } from './pages/Settings';
import DesignSystemPage from './pages/DesignSystem';

function Protected({ children }) {
  const { me, loading } = useAuth(); const loc = useLocation();
  if (loading) return <Spinner label="Loading your workspace…" />;
  if (!me) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const { me } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={me ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="my-work" element={<MyWorkPage />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="forecast" element={<ForecastPage />} />
        <Route path="quotations/:id" element={<QuotationEditor />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="approvals/:id" element={<ApprovalDetailPage />} />
        <Route path="approval_requests/:id" element={<ApprovalDetailPage />} />
        <Route path="claims/:id" element={<ClaimPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="commission" element={<CommissionPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="org-chart" element={<OrgChartPage />} />
        <Route path="admin" element={<AdminOverview />} />
        <Route path="admin/permissions" element={<PermissionsPage />} />
        <Route path="admin/audit" element={<AuditPage />} />
        <Route path="admin/data-quality" element={<DataQualityPage />} />
        <Route path="org" element={<OrgPage />} />
        <Route path="integrations/logs" element={<IntegrationLogs />} />
        <Route path="settings/app" element={<AppSettingsPage />} />
        <Route path="settings/me" element={<MySettingsPage />} />
        <Route path="design-system" element={<DesignSystemPage />} />
        <Route path=":entity" element={<EntityListPage />} />
        <Route path=":entity/:id" element={<EntityDetailPage />} />
        <Route path="*" element={<div className="empty">Page not found.</div>} />
      </Route>
    </Routes>
  );
}
