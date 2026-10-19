import { Link } from "react-router-dom";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import {
  LanguageSwitcher,
  LanguageTogglePills,
} from "@/components/layout/language-switcher";
import { Logo } from "@/components/shared/logo";

export interface AuthBrandFeature {
  key: string;
  icon: LucideIcon;
}

interface AuthBrandLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  brandEyebrow: string;
  brandHeadline: string;
  brandDescription: string;
  features: readonly AuthBrandFeature[];
  featureLabel: (key: string) => string;
  backLabel: string;
  maxWidthClass?: string;
  appearance?: "light" | "dark";
}

export function AuthBrandLayout({
  title,
  subtitle,
  children,
  brandEyebrow,
  brandHeadline,
  brandDescription,
  features,
  featureLabel,
  backLabel,
  maxWidthClass = "max-w-[440px]",
  appearance = "dark",
}: AuthBrandLayoutProps) {
  const isLight = appearance === "light";

  return (
    <div className={`relative flex min-h-screen selection:bg-primary selection:text-white ${isLight ? "bg-slate-50 text-slate-900" : "bg-slate-950 text-slate-100"}`}>
      {/* Background ambient lighting */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className={`absolute -top-40 end-0 h-[500px] w-[500px] rounded-full blur-[120px] ${isLight ? "bg-primary/10" : "bg-primary/15"}`} />
        <div className={`absolute bottom-0 start-0 h-[450px] w-[450px] rounded-full blur-[120px] ${isLight ? "bg-secondary/10" : "bg-secondary/15"}`} />
        <div className={`absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full blur-[140px] ${isLight ? "bg-cyan-500/[0.03]" : "bg-cyan-500/5"}`} />
      </div>

      {/* Brand Aside (Desktop) */}
      <aside className={`relative hidden w-[45%] max-w-xl shrink-0 flex-col justify-between overflow-hidden border-e p-10 backdrop-blur-2xl lg:flex xl:p-14 ${isLight ? "border-slate-200/80 bg-white/80" : "border-white/10 bg-slate-900/60"}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
        >
          <div className={`absolute -top-24 -start-24 h-96 w-96 rounded-full blur-3xl ${isLight ? "bg-primary/10" : "bg-primary/20"}`} />
          <div className={`absolute bottom-10 end-0 h-96 w-96 rounded-full blur-3xl ${isLight ? "bg-secondary/10" : "bg-secondary/20"}`} />
          <div className={`absolute inset-0 ${isLight ? "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.7),transparent_60%)]" : "bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.08),transparent_60%)]"}`} />
        </div>

        <div className="relative z-10">
          <Link to="/" className="inline-block transition-transform hover:scale-[1.02]">
            <Logo size="md" className="h-14 w-auto max-w-[220px] drop-shadow-md" />
          </Link>
        </div>

        <div className="relative z-10 space-y-8 my-auto">
          <div>
            <div className={`inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-semibold backdrop-blur-md ${isLight ? "text-primary-700" : "text-primary-300"}`}>
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              {brandEyebrow}
            </div>
            <h2 className={`mt-4 text-3xl font-black leading-tight tracking-tight xl:text-4xl ${isLight ? "text-slate-900" : "text-white"}`}>
              {brandHeadline}
            </h2>
            <p className={`mt-4 max-w-md text-sm leading-relaxed xl:text-base ${isLight ? "text-slate-600" : "text-slate-300/90"}`}>
              {brandDescription}
            </p>
          </div>

          <ul className="space-y-3.5 pt-2">
            {features.map(({ key, icon: Icon }) => (
              <li
                key={key}
                className={`group flex items-center gap-3.5 rounded-2xl border p-3 transition-all duration-300 ${isLight ? "border-slate-200 bg-white/80 hover:border-primary/30 hover:bg-white" : "border-white/5 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"}`}
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 transition-colors group-hover:bg-primary group-hover:text-white ${isLight ? "text-primary-700" : "text-primary-300"}`}>
                  <Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <span className={`text-sm font-medium ${isLight ? "text-slate-700" : "text-slate-200"}`}>
                  {featureLabel(key)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className={`relative z-10 flex items-center justify-between border-t pt-4 text-xs ${isLight ? "border-slate-200 text-slate-500" : "border-white/10 text-slate-400"}`}>
          <p>© 2026 D-Arrow Business</p>
          <span className={`font-mono text-[10px] tracking-wider uppercase ${isLight ? "text-slate-500" : "text-slate-400"}`}>Enterprise Edition</span>
        </div>
      </aside>

      {/* Main Login Area */}
      <main className="relative flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-10">
          <Link
            to="/"
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-colors sm:text-sm ${isLight ? "border-slate-200 bg-white/80 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900" : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10 hover:text-white"}`}
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            {backLabel}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageTogglePills className="hidden sm:inline-flex" />
            <LanguageSwitcher compact className="sm:hidden" />
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-12 pt-4 sm:px-6 lg:px-10">
          <Link
            to="/"
            className="mb-8 transition-transform hover:scale-[1.02] lg:hidden"
          >
            <Logo size="lg" className="h-20 w-auto max-w-[260px]" />
          </Link>

          <div
            className={`w-full ${maxWidthClass} animate-in fade-in slide-in-from-bottom-4 duration-500`}
          >
            <div className="mb-6 text-center lg:text-start">
              <h1 className={`text-2xl font-black tracking-tight sm:text-3xl ${isLight ? "text-slate-900" : "text-white"}`}>
                {title}
              </h1>
              <p className={`mt-2 text-sm sm:text-base ${isLight ? "text-slate-600" : "text-slate-400"}`}>{subtitle}</p>
            </div>

            <div className={`relative rounded-3xl border p-6 backdrop-blur-xl sm:p-8 ${isLight ? "border-slate-200/80 bg-white/90 shadow-2xl shadow-slate-900/10" : "border-white/10 bg-slate-900/80 shadow-2xl shadow-black/50"}`}>
              <div className={`pointer-events-none absolute -top-px left-1/2 h-px w-3/4 -translate-x-1/2 bg-gradient-to-r from-transparent to-transparent ${isLight ? "via-primary/40" : "via-primary/50"}`} />
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
