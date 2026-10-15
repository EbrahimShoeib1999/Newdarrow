import { useAuth } from "@/features/auth/context/auth-context";
import { LandingPage } from "./landing-page";
import { Spinner } from "@heroui/react";

export function HomePage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-default-50">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  return <LandingPage isAuthenticated={isAuthenticated} />;
}