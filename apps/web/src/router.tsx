/**
 * React Router 6 data router. Three trees (05-FRONTEND.md §2):
 *   - public:  /intake, /login, /forgot-password, /reset-password,
 *              /accept-invitation — served from the ENTRY chunk
 *   - admin:   /admin/* — RequireAuth + per-page RequirePermission
 *   - client:  /client/* — RequireAuth + RequireClientContext
 * Admin and client trees are separate; no shared layout, no role branching
 * inside pages.
 *
 * Code splitting (UX 3.6): the admin and client trees are React.lazy —
 * Recharts, dnd-kit, and TanStack Table never load on the public pages.
 * Layouts wrap their Outlet in a Suspense so per-page chunks resolve inside
 * the shell; this top-level fallback covers the layout chunk itself.
 */
import { Suspense, lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { RequireAuth } from "@/components/guards/require-auth";
import { RequireClientContext } from "@/components/guards/require-client-context";
import { RequirePermission } from "@/components/guards/require-permission";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { useSession } from "@/lib/auth";
import { homePathFor, useMe } from "@/lib/permissions";
import { NotFoundPage } from "@/routes/not-found-page";
import { AcceptInvitationPage } from "@/routes/public/accept-invitation-page";
import { ForgotPasswordPage } from "@/routes/public/forgot-password-page";
import { IntakePage } from "@/routes/public/intake-page";
import { RegisterPage } from "@/routes/public/register-page";
import { PublicFormPage } from "@/routes/public/public-form-page";
import { LoginPage } from "@/routes/public/login-page";
import { ResetPasswordPage } from "@/routes/public/reset-password-page";

// ----- Lazy admin tree -----
const AdminLayout = lazy(() =>
  import("@/components/layout/admin-layout").then((m) => ({
    default: m.AdminLayout,
  })),
);
const AttentionQueuePage = lazy(() =>
  import("@/features/admin-dashboard").then((m) => ({
    default: m.AttentionQueuePage,
  })),
);
const StatsPage = lazy(() =>
  import("@/features/admin-dashboard").then((m) => ({ default: m.StatsPage })),
);
const RejectionReasonsReportPage = lazy(() =>
  import("@/features/admin-dashboard").then((m) => ({
    default: m.RejectionReasonsReportPage,
  })),
);
const ClientsListPage = lazy(() =>
  import("@/features/clients").then((m) => ({ default: m.ClientsListPage })),
);
const ClientDetailPage = lazy(() =>
  import("@/features/clients").then((m) => ({ default: m.ClientDetailPage })),
);
const RequisitionsListPage = lazy(() =>
  import("@/features/requisitions").then((m) => ({
    default: m.RequisitionsListPage,
  })),
);
const RequisitionDetailPage = lazy(() =>
  import("@/features/requisitions").then((m) => ({
    default: m.RequisitionDetailPage,
  })),
);
const CandidatesListPage = lazy(() =>
  import("@/features/candidates").then((m) => ({
    default: m.CandidatesListPage,
  })),
);
const CandidateNewPage = lazy(() =>
  import("@/features/candidates").then((m) => ({ default: m.CandidateNewPage })),
);
const CandidateDetailPage = lazy(() =>
  import("@/features/candidates").then((m) => ({
    default: m.CandidateDetailPage,
  })),
);
const QuestionManagerPage = lazy(() =>
  import("@/features/question-manager").then((m) => ({
    default: m.QuestionManagerPage,
  })),
);
const FormsListPage = lazy(async () => ({
  default: (await import("@/features/form-builder/builder/forms-list-page"))
    .FormsListPage,
}));
const FormBuilderPage = lazy(async () => ({
  default: (await import("@/features/form-builder/builder/form-builder-page"))
    .FormBuilderPage,
}));
const NotificationsPage = lazy(() =>
  import("@/features/notifications").then((m) => ({
    default: m.NotificationsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/routes/admin/index-pages").then((m) => ({
    default: m.SettingsPage,
  })),
);

// ----- Lazy client tree -----
const ClientLayout = lazy(() =>
  import("@/components/layout/client-layout").then((m) => ({
    default: m.ClientLayout,
  })),
);
const ClientDashboardPage = lazy(() =>
  import("@/features/client-portal").then((m) => ({
    default: m.ClientDashboardPage,
  })),
);
const ClientRequisitionsPage = lazy(() =>
  import("@/features/client-portal").then((m) => ({
    default: m.ClientRequisitionsPage,
  })),
);
const ClientRequisitionNewPage = lazy(() =>
  import("@/features/client-portal").then((m) => ({
    default: m.ClientRequisitionNewPage,
  })),
);
const ClientRequisitionDetailPage = lazy(() =>
  import("@/features/client-portal").then((m) => ({
    default: m.ClientRequisitionDetailPage,
  })),
);

function RouteFallback() {
  return (
    <div className="mx-auto max-w-content p-8">
      <LoadingSkeleton variant="card" rows={3} label="Loading…" />
    </div>
  );
}

/** Lands signed-in users on their role's home; everyone else on /login. */
function RootRedirect() {
  const { session, isLoading } = useSession();
  const { data: me, isLoading: isMeLoading } = useMe();

  if (isLoading || (session && isMeLoading)) {
    return <RouteFallback />;
  }

  if (!session) return <Navigate to="/login" replace />;
  if (me) return <Navigate to={homePathFor(me)} replace />;
  return <Navigate to="/login" replace />;
}

export const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },

  // ----- Public tree (entry chunk) -----
  { path: "/intake", element: <IntakePage /> },
  { path: "/register", element: <RegisterPage /> },
  { path: "/f/:slug", element: <PublicFormPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/accept-invitation", element: <AcceptInvitationPage /> },

  // ----- Admin tree -----
  {
    path: "/admin",
    element: (
      <RequireAuth>
        <Suspense fallback={<RouteFallback />}>
          <AdminLayout />
        </Suspense>
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: (
          <RequirePermission permission="assignment.advance">
            <AttentionQueuePage />
          </RequirePermission>
        ),
      },
      {
        path: "clients",
        element: (
          <RequirePermission permission="client.view">
            <ClientsListPage />
          </RequirePermission>
        ),
      },
      {
        path: "clients/:id",
        element: (
          <RequirePermission permission="client.view">
            <ClientDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "requisitions",
        element: (
          <RequirePermission permission="requisition.view">
            <RequisitionsListPage />
          </RequirePermission>
        ),
      },
      {
        path: "requisitions/:id",
        element: (
          <RequirePermission permission="requisition.view">
            <RequisitionDetailPage />
          </RequirePermission>
        ),
      },
      {
        path: "candidates",
        element: (
          <RequirePermission permission="candidate.view">
            <CandidatesListPage />
          </RequirePermission>
        ),
      },
      {
        path: "candidates/new",
        element: (
          <RequirePermission permission="candidate.create">
            <CandidateNewPage />
          </RequirePermission>
        ),
      },
      {
        path: "candidates/:id",
        element: (
          <RequirePermission permission="candidate.view">
            <CandidateDetailPage />
          </RequirePermission>
        ),
      },
      {
        // 04 §12: GET /admin/stats requires requisition.view.
        path: "stats",
        element: (
          <RequirePermission permission="requisition.view">
            <StatsPage />
          </RequirePermission>
        ),
      },
      {
        // 04 §12: GET /reports/rejection-reasons requires event.view.
        path: "reports/rejection-reasons",
        element: (
          <RequirePermission permission="event.view">
            <RejectionReasonsReportPage />
          </RequirePermission>
        ),
      },
      {
        path: "questions",
        element: (
          <RequirePermission permission="question.view">
            <QuestionManagerPage />
          </RequirePermission>
        ),
      },
      {
        // A form builder is question configuration with a layout layer, so it
        // reuses question.view / question.manage rather than inventing a key.
        path: "forms",
        element: (
          <RequirePermission permission="question.view">
            <FormsListPage />
          </RequirePermission>
        ),
      },
      {
        path: "forms/:id",
        element: (
          <RequirePermission permission="question.manage">
            <FormBuilderPage />
          </RequirePermission>
        ),
      },
      {
        // GET /admin/notifications requires event.view; the resend action
        // inside additionally needs settings.manage and hides itself.
        path: "notifications",
        element: (
          <RequirePermission permission="event.view">
            <NotificationsPage />
          </RequirePermission>
        ),
      },
      {
        path: "settings",
        element: (
          <RequirePermission permission="settings.manage">
            <SettingsPage />
          </RequirePermission>
        ),
      },
    ],
  },

  // ----- Client tree -----
  {
    path: "/client",
    element: (
      <RequireAuth>
        <RequireClientContext>
          <Suspense fallback={<RouteFallback />}>
            <ClientLayout />
          </Suspense>
        </RequireClientContext>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <ClientDashboardPage /> },
      { path: "requisitions", element: <ClientRequisitionsPage /> },
      { path: "requisitions/new", element: <ClientRequisitionNewPage /> },
      { path: "requisitions/:id", element: <ClientRequisitionDetailPage /> },
    ],
  },

  { path: "*", element: <NotFoundPage /> },
]);
