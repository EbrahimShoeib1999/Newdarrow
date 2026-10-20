import { Button, Input } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import * as z from "zod";
import { cn } from "@/lib/utils";
import { useAuth } from "../context/auth-context";
import { GoogleSignInButton } from "./google-sign-in-button";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormData = z.infer<typeof loginSchema>;

const authInputClassNames = {
  label: "font-semibold text-slate-700 pb-1 text-xs sm:text-sm",
  input: "text-sm text-slate-900 placeholder:text-slate-400",
  inputWrapper: cn(
    "bg-white shadow-none border-slate-300 hover:border-slate-400",
    "group-data-[focus=true]:border-primary group-data-[focus=true]:ring-2 group-data-[focus=true]:ring-primary/20",
    "group-data-[invalid=true]:border-danger group-data-[invalid=true]:ring-2 group-data-[invalid=true]:ring-danger/20",
    "transition-all duration-200"
  ),
  errorMessage: "text-danger text-xs",
};

export function LoginForm() {
  const { t } = useTranslation("auth");
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { isSubmitting, errors, isSubmitted },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setError("");

    try {
      await login(data.email, data.password);
      navigate("/", { replace: true, state: { choosePortal: true } });
    } catch (err: any) {
      console.error("Login attempt error:", err);
      const code = err?.code || "";
      if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError(t("login.error"));
      } else if (code === "auth/too-many-requests") {
        setError(t("login.tooManyRequests"));
      } else if (err?.message) {
        setError(err.message);
      } else {
        setError(t("login.error"));
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex w-full flex-col gap-5"
      noValidate
    >
      {error && (
        <div className="flex w-full items-center gap-3 rounded-2xl border border-danger/20 bg-danger/10 p-4 text-sm text-danger animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-semibold">{error}</span>
        </div>
      )}

      <Controller
        name="email"
        control={control}
        render={({ field }) => (
          <Input
            {...field}
            type="email"
            label={t("login.email")}
            labelPlacement="outside"
            placeholder={t("login.emailPlaceholder")}
            autoComplete="email"
            variant="bordered"
            size="lg"
            radius="lg"
            isInvalid={isSubmitted && !!errors.email}
            errorMessage={isSubmitted ? errors.email?.message : undefined}
            startContent={
              <Mail className="pointer-events-none h-4 w-4 text-default-400" />
            }
            classNames={authInputClassNames}
          />
        )}
      />

      <Controller
        name="password"
        control={control}
        render={({ field }) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="login-password"
                className="text-xs sm:text-sm font-semibold text-slate-700"
              >
                {t("login.password")}
              </label>
              <Link
                to="/forgot-password"
                className="shrink-0 text-xs font-medium text-slate-500 transition-colors hover:text-primary hover:underline"
              >
                {t("login.forgotPassword")}
              </Link>
            </div>
            <Input
              {...field}
              id="login-password"
              type={showPassword ? "text" : "password"}
              aria-label={t("login.password")}
              placeholder={t("login.passwordPlaceholder")}
              autoComplete="current-password"
              variant="bordered"
              size="lg"
              radius="lg"
              isInvalid={isSubmitted && !!errors.password}
              errorMessage={isSubmitted ? errors.password?.message : undefined}
              startContent={
                <Lock className="pointer-events-none h-4 w-4 text-slate-400" />
              }
              classNames={authInputClassNames}
              endContent={
                <button
                  className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              }
            />
          </div>
        )}
      />

      <Button
        type="submit"
        color="primary"
        className="mt-2 h-12 w-full bg-primary-gradient font-bold text-sm text-white shadow-lg shadow-primary/25 transition-transform hover:scale-[1.01] active:scale-[0.99]"
        isLoading={isSubmitting}
        endContent={!isSubmitting && <ArrowRight className="h-4 w-4 rtl:rotate-180" />}
      >
        {isSubmitting ? t("login.loading") : t("login.submit")}
      </Button>

      <div className="relative flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium text-slate-500">{t("login.or")}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <GoogleSignInButton appearance="light" />

      <p className="text-center text-sm text-slate-600">
        {t("login.dontHaveAccount")}{" "}
        <Link
          to="/register"
          className="font-bold text-primary transition-colors hover:text-primary-700 hover:underline"
        >
          {t("login.createAccountLink")}
        </Link>
      </p>
    </form>
  );
}
