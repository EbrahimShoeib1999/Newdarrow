import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

export function GoogleSignInButton({
  className,
  appearance = "dark",
}: {
  className?: string;
  appearance?: "light" | "dark";
}) {
  const { t } = useTranslation("auth");

  return (
    <div className={className}>
      <Button
        type="button"
        variant="bordered"
        size="lg"
        radius="lg"
        className={`h-12 w-full font-semibold text-slate-500 border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 cursor-not-allowed`}
        isDisabled
      >
        {t("login.google", { fallback: "Sign in with Google" })}
      </Button>
      <p className="mt-2 text-xs text-center text-slate-400">
        {t("login.googleComingSoon", { fallback: "Google sign-in coming soon" })}
      </p>
    </div>
  );
}
