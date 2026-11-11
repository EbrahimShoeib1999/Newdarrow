import { Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { Providers } from "./providers";
import { router } from "./router";

export function App() {
  return (
    <Providers>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center" role="status">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      >
        <RouterProvider router={router} />
      </Suspense>
    </Providers>
  );
}
