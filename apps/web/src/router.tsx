/**
 * React Router 6 data router. Three trees (05-FRONTEND.md §2):
 *   - public:  /intake, /login, /accept-invitation
 *   - admin:   /admin/* — RequireAuth + per-page RequirePermission
 *   - client:  /client/* — RequireAuth + RequireClientContext
 * Admin and client trees are separate; no shared layout, no role branching
 * inside pages.
 */
import { createBrowserRouter, Navigate } from "react-router-dom";
import { RequireAuth } from "@/components/guards/require-auth";
import { RequireClientContext } from "@/components/guards/require-client-context";
import { RequirePermission } from "@/components/guards/require-permission";
import { AdminLayout } from "@/components/layout/admin-layout";
import { ClientLayout } from "@/components/layout/client-layout";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { useSession } from "@/lib/auth";
import { homePathFor, useMe } from "@/lib/permissions";
import { ClientDetailPage, ClientsListPage } from "@/features/clients";
import { QuestionManagerPage } from "@/features/question-manager";
import {
  RequisitionDetailPage,
  RequisitionsListPage,
} from "@/features/requisitions";
import {
  AttentionQueuePage,
  CandidatesPage,
  SettingsPage,
} from "@/routes/admin/index-pages";
import {
  ClientDashboardPage,
  ClientRequisitionsPage,
} from "@/routes/client/index-pages";
import { NotFoundPage } from "@/routes/not-found-page";
import { AcceptInvitationPage } from "@/routes/public/accept-invitation-page";
import { IntakePage } from "@/routes/public/intake-page";
import { LoginPage } from "@/routes/public/login-page";

/** Lands signed-in users on their role's home; everyone else on /login. */
function RootRedirect() {
  const { session, isLoading } = useSession();
  const { data: me, isLoading: isMeLoading } = useMe();

  if (isLoading || (session && isMeLoading)) {
    return (
      <div className="mx-auto max-w-content p-8">
        <LoadingSkeleton variant="card" rows={3} label="Loading…" />
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (me) return <Navigate to={homePathFor(me)} replace />;
  return <Navigate to="/login" replace />;
}

export const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },

  // ----- Public tree -----
  { path: "/intake", element: <IntakePage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/accept-invitation", element: <AcceptInvitationPage /> },

  // ----- Admin tree -----
  {
    path: "/admin",
    element: (
      <RequireAuth>
        <AdminLayout />
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
            <CandidatesPage />
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
          <ClientLayout />
        </RequireClientContext>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <ClientDashboardPage /> },
      { path: "requisitions", element: <ClientRequisitionsPage /> },
    ],
  },

  { path: "*", element: <NotFoundPage /> },
]);
