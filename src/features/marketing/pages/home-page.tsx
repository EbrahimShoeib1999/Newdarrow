import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "@heroui/react";
import { useAuth } from "@/features/auth/context/auth-context";
import { hasPostLoginIntent, PORTAL_PICKER_PATH } from "@/features/auth/utils/post-login";
import { LandingPage } from "./landing-page";

export function HomePage() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-default-50">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  // Boundary guard: a navigation into "/" that carries a completed-auth
  // intent must never render the public marketing site. Deep links from
  // older flows and stale history entries land here and get forwarded to
  // the portal picker. Plain visits to "/" still show the marketing page
  // (with its "My Workspace" CTA) to signed-in users.
  if (isAuthenticated && hasPostLoginIntent(location)) {
    return <Navigate to={PORTAL_PICKER_PATH} replace state={{ choosePortal: true }} />;
  }

  return <LandingPage isAuthenticated={isAuthenticated} />;
}