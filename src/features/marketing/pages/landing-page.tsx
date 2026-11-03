import { Link, type To } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";
import {
  ArrowRight,
  Layers,
  Globe2,
  Shield,
  Zap,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { LanguageSwitcher, LanguageTogglePills } from "@/components/layout/language-switcher";
import AnimatedDiv, {
  fadeInDownVariants,
  fadeInUpVariants,
  fadeInVariants,
  scaleInVariants,
} from "@/components/motion/animated-div";
import SmoothScrollProvider from "@/components/providers/smooth-scroll-provider";
import { LANDING_APPS } from "../constants/landing-apps";
import { PUBLIC_ACTIVITY_CARDS } from "../constants/landing-activities";
import { useAccessiblePortals } from "@/features/portals/hooks/use-portals";
import { cn } from "@/lib/utils";

function LandingNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { t } = useTranslation("landing");

  return (
    <AnimatedDiv
      id="landing-nav"
      variants={fadeInDownVariants}
      duration={0.6}
      className="sticky top-0 z-50"
    >
      <header className="border-b border-default-100 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-2 px-2 md:px-4 overflow-x-hidden">
          <Link to="/" className="shrink-0">
            <Logo size="md" className="h-11" />
          </Link>

          <nav className="hidden items-center gap-5 text-sm font-medium text-default-600 md:flex flex-1 min-w-0 justify-center">
            {[
              { href: "#apps", label: t("nav.apps") },
              { href: "#activities", label: t("nav.activities") },
              { href: "#features", label: t("nav.features") },
              { href: "#cta", label: t("nav.pricing") },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="group relative transition-colors hover:text-primary shrink-0"
              >
                {item.label}
                <span className="absolute -bottom-1 start-0 h-0.5 w-0 bg-primary transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0 min-w-fit px-2">
            <LanguageTogglePills className="hidden sm:inline-flex shrink-0" />
            <LanguageSwitcher compact className="sm:hidden shrink-0" />
            {isAuthenticated ? (
              <Button
                as={Link}
                to="/apps"
                color="primary"
                size="sm"
                className="font-semibold shadow-md shadow-primary/20 transition-transform duration-300 hover:scale-105 shrink-0 whitespace-nowrap"
                startContent={<LayoutGrid className="h-4 w-4" />}
              >
                {t("nav.workspace", "My Workspace")}
              </Button>
            ) : (
              <>
                <Button
                  as={Link}
                  to="/login"
                  variant="light"
                  size="sm"
                  className="hidden font-semibold sm:inline-flex shrink-0 whitespace-nowrap"
                >
                  {t("nav.signIn")}
                </Button>
                <Button
                  as={Link}
                  to="/register"
                  color="primary"
                  size="sm"
                  className="font-semibold transition-transform duration-300 hover:scale-105 shrink-0 whitespace-nowrap"
                >
                  {t("nav.tryFree")}
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
    </AnimatedDiv>
  );
}

function AppTile({
  label,
  icon: Icon,
  gradient,
  to,
  state,
  disabled = false,
  restrictedHint,
}: {
  label: string;
  icon: LucideIcon;
  gradient: string;
  /** Real destination — protected targets are never linked when unauthorized. */
  to: To;
  /** Optional navigation state (e.g. the login "from" contract). */
  state?: Record<string, unknown>;
  disabled?: boolean;
  restrictedHint?: string;
}) {
  const body = (
    <>
      <div
        className={cn(
          "flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md transition-all duration-300 group-hover:-translate-y-1.5 group-hover:scale-105 group-hover:shadow-xl group-hover:shadow-primary/20",
          gradient
        )}
      >
        <Icon className="h-8 w-8 transition-transform duration-300 group-hover:rotate-6" strokeWidth={1.75} />
      </div>
      <span className="text-sm font-semibold text-foreground leading-tight max-w-[100px] transition-colors group-hover:text-primary">
        {label}
      </span>
    </>
  );

  // An unauthorized destination stays visibly inert: no link, no navigation.
  if (disabled) {
    return (
      <div
        className="group flex flex-col items-center gap-3 text-center opacity-50 cursor-not-allowed"
        aria-disabled="true"
        title={restrictedHint}
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      to={to}
      state={state}
      className="group flex flex-col items-center gap-3 text-center"
      aria-label={label}
    >
      {body}
    </Link>
  );
}

const FEATURE_ITEMS = [
  {
    key: "integrated",
    icon: Layers,
    badgeAr: "بيانات موحدة",
    badgeEn: "Unified Data",
    pointsAr: ["ربط فوري بين المبيعات والمهام", "تحديث آلي للفواتير والعقود", "مشاركة البيانات بدون تكرار"],
    pointsEn: ["Real-time sales & task sync", "Automated contract & invoice flow", "Zero redundant data entry"],
  },
  {
    key: "rtl",
    icon: Globe2,
    badgeAr: "ثنائي اللغة",
    badgeEn: "Bilingual First",
    pointsAr: ["دعم RTL أصلي دقيق", "أرقام إنجليزية 0-9 موحدة", "تبديل فوري وسلس بين اللغتين"],
    pointsEn: ["Native RTL Arabic support", "Standard Western digits 0-9", "Instant language switching"],
  },
  {
    key: "secure",
    icon: Shield,
    badgeAr: "حماية متقدمة",
    badgeEn: "Enterprise Security",
    pointsAr: ["صلاحيات دقيقة لكل دور", "تشفير سحابي متقدم", "عزل تام لبيانات الشركات"],
    pointsEn: ["Granular RBAC permissions", "Advanced cloud encryption", "Isolated multi-tenant data"],
  },
  {
    key: "fast",
    icon: Zap,
    badgeAr: "أداء استثنائي",
    badgeEn: "High Performance",
    pointsAr: ["استجابة فائقة السرعة", "تحديثات فورية وتفاعلية", "واجهة سلسة ومريحة للمستخدم"],
    pointsEn: ["Ultra-fast response time", "Reactive real-time state", "Intuitive user experience"],
  },
] as const;

const KPI_METRICS = [
  { value: "10,000+", labelAr: "مهمة ومشروع منجز", labelEn: "Completed Tasks & Sprints", icon: Layers, gradient: "from-blue-500/20 to-primary/20" },
  { value: "99.9%", labelAr: "معدل استقرار وجاهزية", labelEn: "Uptime & System SLA", icon: Shield, gradient: "from-emerald-500/20 to-teal/20" },
  { value: "100%", labelAr: "أرقام غربية 0-9 موحدة", labelEn: "Standard Western Numerals", icon: Globe2, gradient: "from-amber-500/20 to-orange/20" },
  { value: "< 100ms", labelAr: "سرعة استجابة فائقة", labelEn: "Ultra-Fast Response", icon: Zap, gradient: "from-purple-500/20 to-violet/20" },
];

export function LandingPage({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const { t, i18n } = useTranslation("landing");
  const isAr = i18n.language === "ar";
  const year = 2026;
  // Permission- AND activity-aware: tiles for apps the signed-in user cannot
  // reach (role, or an inactive owning activity) are inert, never dead links.
  const accessiblePortals = useAccessiblePortals();

  return (
    <div className="min-h-screen bg-default-50 text-foreground selection:bg-primary/20 selection:text-primary">
      <LandingNav isAuthenticated={isAuthenticated} />

      <SmoothScrollProvider>
        {/* Hero Section */}
        <section className="relative overflow-hidden px-4 pb-16 pt-12 md:px-6 md:pt-20 md:pb-24">
          {/* Subtle Ambient Glowing Mesh */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-primary/5 to-transparent" />
          <div className="pointer-events-none absolute -top-40 start-1/2 -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-primary/10 blur-[120px]" />

          <div className="relative mx-auto max-w-5xl text-center">
            {/* Pill Announcement Badge */}
            <AnimatedDiv delay={0.05} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/25 text-primary text-xs font-bold mb-6 shadow-sm">
              <span className="flex h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>{isAr ? "✨ منصة الأعمال المتكاملة للشركات الذكية" : "✨ The Next-Gen Enterprise Operating System"}</span>
            </AnimatedDiv>

            <AnimatedDiv delay={0.1}>
              <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                {t("hero.title")}{" "}
                <span className="relative inline-block text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-600 to-primary-600">
                  <span className="relative z-10">{t("hero.titleHighlight")}</span>
                  <span
                    className="absolute -inset-x-2 bottom-1 z-0 h-3 rounded-md bg-warning/40 md:h-4 md:bottom-2"
                    aria-hidden
                  />
                </span>
              </h1>
            </AnimatedDiv>

            <AnimatedDiv delay={0.2}>
              <p className="mt-6 text-xl font-medium text-default-600 md:text-2xl max-w-3xl mx-auto leading-relaxed">
                {t("hero.subtitle")}{" "}
                <span className="font-bold text-primary underline decoration-primary/40 underline-offset-4">
                  {t("hero.subtitleHighlight")}
                </span>
              </p>
            </AnimatedDiv>

            <AnimatedDiv delay={0.28}>
              <p className="mt-3 text-sm font-semibold text-default-500">
                {t("hero.priceNote")}
              </p>
            </AnimatedDiv>

            <AnimatedDiv
              delay={0.35}
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Button
                as={Link}
                to={isAuthenticated ? "/apps" : "/register"}
                color="primary"
                size="lg"
                className="min-w-[210px] font-bold shadow-xl shadow-primary/25 transition-transform duration-300 hover:-translate-y-0.5 hover:scale-105 rounded-2xl h-12"
                endContent={
                  isAuthenticated ? (
                    <LayoutGrid className="h-4 w-4" />
                  ) : (
                    <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                  )
                }
              >
                {isAuthenticated ? t("nav.workspace", "My Workspace") : t("hero.ctaPrimary")}
              </Button>
              {!isAuthenticated && (
                <Button
                  as={Link}
                  to="/login"
                  variant="bordered"
                  size="lg"
                  className="min-w-[170px] font-bold bg-background/80 backdrop-blur-md transition-transform duration-300 hover:-translate-y-0.5 rounded-2xl h-12 border-default-300"
                >
                  {t("hero.ctaSecondary")}
                </Button>
              )}
            </AnimatedDiv>

            {/* KPI Metrics Ribbon (Western digits 0-9) */}
            <AnimatedDiv delay={0.45} className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 text-start">
              {KPI_METRICS.map((kpi, idx) => {
                const Icon = kpi.icon;
                return (
                  <div
                    key={idx}
                    className="p-4 rounded-3xl bg-background/80 border border-default-200/80 shadow-sm backdrop-blur-md flex items-center gap-3.5 hover:border-primary/40 hover:shadow-md transition-all group"
                  >
                    <div className={cn("p-2.5 rounded-2xl bg-gradient-to-br text-primary shadow-sm shrink-0", kpi.gradient)}>
                      <Icon className="h-5 w-5 transition-transform group-hover:scale-110" />
                    </div>
                    <div>
                      <span className="font-black text-xl text-default-900 tracking-tight font-mono block">
                        {kpi.value}
                      </span>
                      <span className="text-xs text-default-500 font-medium leading-tight block">
                        {isAr ? kpi.labelAr : kpi.labelEn}
                      </span>
                    </div>
                  </div>
                );
              })}
            </AnimatedDiv>
          </div>
        </section>

        {/* Apps grid */}
        <section id="apps" className="bg-background px-4 py-16 md:px-6 md:py-24 border-y border-default-100 scroll-mt-24">
          <div className="mx-auto max-w-5xl">
            <AnimatedDiv triggerOnScroll variants={fadeInUpVariants} className="mb-14 text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">
                {isAr ? "منظومة البرامج والتطبيقات" : "App Ecosystem"}
              </span>
              <h2 className="text-3xl font-black md:text-4xl tracking-tight text-default-900">{t("apps.title")}</h2>
              <p className="mt-3 text-default-500 max-w-2xl mx-auto text-base">
                {t("apps.subtitle")}
              </p>
            </AnimatedDiv>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-5">
              {LANDING_APPS.map((app, index) => {
                const restricted =
                  isAuthenticated &&
                  Boolean(app.portal) &&
                  !accessiblePortals.includes(app.portal!);
                return (
                  <AnimatedDiv
                    key={app.id}
                    triggerOnScroll
                    amount={0.15}
                    delay={index * 0.05}
                    variants={scaleInVariants}
                  >
                    <div className="p-4 rounded-3xl bg-default-50/70 border border-default-200/60 hover:border-primary/40 hover:bg-background hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 flex flex-col items-center text-center">
                      <AppTile
                        label={t(app.labelKey)}
                        icon={app.icon}
                        gradient={app.gradient}
                        restrictedHint={t("apps.restricted")}
                        disabled={restricted}
                        to={isAuthenticated || restricted ? app.path : "/login"}
                        state={
                          isAuthenticated || restricted
                            ? undefined
                            : // Unauthenticated: existing login flow, preserving the
                            // intended return destination.
                            { from: { pathname: app.path } }
                        }
                      />
                    </div>
                  </AnimatedDiv>
                );
              })}
            </div>

            <AnimatedDiv triggerOnScroll delay={0.2} className="mt-14 text-center">
              <Button
                as={Link}
                to={isAuthenticated ? "/apps" : "/register"}
                variant="flat"
                color="primary"
                size="lg"
                className="font-bold rounded-2xl px-8 shadow-sm transition-transform duration-300 hover:scale-105"
                endContent={<ArrowRight className="h-4 w-4 rtl:rotate-180" />}
              >
                {t("apps.viewAll")}
              </Button>
            </AnimatedDiv>
          </div>
        </section>

        {/* Industries / activity catalog. Public marketing ONLY: shows the full
            supported scope with honest availability. Cards never activate a
            module, change tenant config, or link into a gated internal route —
            live and inquiry cards both point to the public /register path. */}
        <section id="activities" className="bg-default-50 px-4 py-16 md:px-6 md:py-24 scroll-mt-24">
          <div className="mx-auto max-w-5xl">
            <AnimatedDiv triggerOnScroll variants={fadeInUpVariants} className="mb-14 text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">
                {isAr ? "القطاعات المدعومة" : "Supported Industries"}
              </span>
              <h2 className="text-3xl font-black md:text-4xl tracking-tight text-default-900">{t("activities.title")}</h2>
              <p className="mt-3 text-default-500 max-w-2xl mx-auto text-base">
                {t("activities.subtitle")}
              </p>
            </AnimatedDiv>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {PUBLIC_ACTIVITY_CARDS.map((card, index) => {
                const Icon = card.icon;
                const name = isAr ? card.nameAr : card.nameEn;
                const desc = isAr ? card.descAr : card.descEn;
                return (
                  <AnimatedDiv
                    key={card.id}
                    triggerOnScroll
                    amount={0.15}
                    delay={index * 0.05}
                    variants={fadeInUpVariants}
                  >
                    <div
                      className={cn(
                        "flex h-full flex-col rounded-3xl border bg-background p-6 shadow-sm transition-all duration-300",
                        card.live
                          ? "border-default-200/90 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"
                          : "border-dashed border-default-200 opacity-80"
                      )}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div
                          className={cn(
                            "inline-flex rounded-2xl p-3 shadow-sm transition-colors",
                            card.live ? "bg-primary/10 text-primary" : "bg-default-100 text-default-400"
                          )}
                        >
                          <Icon className="h-6 w-6" />
                        </div>
                        <span
                          className={cn(
                            "text-[11px] font-bold px-2.5 py-1 rounded-full border",
                            card.live
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                              : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                          )}
                        >
                          {card.live ? t("activities.available") : t("activities.comingSoon")}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-default-900">{name}</h3>
                      <p className="mt-2 text-sm text-default-500 leading-relaxed flex-1">{desc}</p>
                      <Link
                        to="/register"
                        className={cn(
                          "mt-5 inline-flex items-center gap-1.5 text-sm font-bold transition-colors",
                          card.live ? "text-primary hover:text-primary-600" : "text-default-500 hover:text-primary"
                        )}
                      >
                        {card.live ? t("cta.button") : t("activities.requestAccess")}
                        <ArrowRight className="h-4 w-4 rtl:rotate-180" />
                      </Link>
                    </div>
                  </AnimatedDiv>
                );
              })}
            </div>
          </div>
        </section>

        {/* Features Bento */}
        <section id="features" className="px-4 py-16 md:px-6 md:py-24 bg-default-50 scroll-mt-24">
          <div className="mx-auto max-w-5xl">
            <AnimatedDiv triggerOnScroll className="mb-14 text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-primary mb-2 block">
                {isAr ? "لماذا تختار D-Arrow Business؟" : "Core Advantages"}
              </span>
              <h2 className="text-3xl font-black md:text-4xl tracking-tight text-default-900">
                {t("features.title")}
              </h2>
            </AnimatedDiv>
            <div className="grid gap-6 sm:grid-cols-2">
              {FEATURE_ITEMS.map((item, index) => {
                const Icon = item.icon;
                const points = isAr ? item.pointsAr : item.pointsEn;
                const badge = isAr ? item.badgeAr : item.badgeEn;
                return (
                  <AnimatedDiv
                    key={item.key}
                    triggerOnScroll
                    amount={0.2}
                    delay={index * 0.1}
                    variants={fadeInUpVariants}
                  >
                    <div className="group h-full rounded-3xl border border-default-200/90 bg-background p-7 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between mb-5">
                          <div className="inline-flex rounded-2xl bg-primary/10 p-3.5 text-primary transition-all duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground shadow-sm">
                            <Icon className="h-6 w-6" />
                          </div>
                          <span className="text-xs font-bold px-3 py-1 rounded-full bg-default-100 text-default-600 border border-default-200">
                            {badge}
                          </span>
                        </div>
                        <h3 className="text-xl font-bold transition-colors group-hover:text-primary text-default-900">
                          {t(`features.${item.key}.title`)}
                        </h3>
                        <p className="mt-2.5 text-sm text-default-500 leading-relaxed">
                          {t(`features.${item.key}.desc`)}
                        </p>
                      </div>

                      <div className="mt-6 pt-5 border-t border-default-100 space-y-2">
                        {points.map((pt, pIdx) => (
                          <div key={pIdx} className="flex items-center gap-2 text-xs font-medium text-default-600">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 font-bold text-[10px]">
                              ✓
                            </span>
                            <span>{pt}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </AnimatedDiv>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA Banner */}
        <section id="cta" className="px-4 py-16 md:px-6 md:py-24 scroll-mt-24">
          <AnimatedDiv triggerOnScroll amount={0.3} variants={scaleInVariants} className="mx-auto max-w-4xl">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary-600 to-violet-700 px-8 py-16 text-center text-white shadow-2xl transition-shadow duration-300 hover:shadow-primary/30">
              {/* Radial glow background */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.2),transparent_60%)]" />

              <span className="relative z-10 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-xs font-bold mb-4">
                <span>★★★★★</span>
                <span>{isAr ? "تقييم 4.9/5 من الشركات الرائدة" : "Rated 4.9/5 by Enterprise Teams"}</span>
              </span>

              <h2 className="relative z-10 text-3xl font-black md:text-5xl tracking-tight leading-tight">{t("cta.title")}</h2>
              <p className="relative z-10 mt-4 text-white/90 md:text-lg max-w-xl mx-auto leading-relaxed">{t("cta.subtitle")}</p>

              <div className="relative z-10 mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button
                  as={Link}
                  to={isAuthenticated ? "/apps" : "/register"}
                  size="lg"
                  className="min-w-[210px] bg-white font-black text-primary transition-transform duration-300 hover:-translate-y-0.5 hover:scale-105 rounded-2xl h-12 shadow-lg"
                >
                  {isAuthenticated ? t("nav.workspace", "My Workspace") : t("cta.button")}
                </Button>
                {!isAuthenticated && (
                  <Button
                    as={Link}
                    to="/login"
                    variant="bordered"
                    size="lg"
                    className="min-w-[150px] border-white/60 text-white font-bold rounded-2xl h-12 hover:bg-white/10"
                  >
                    {t("hero.ctaSecondary")}
                  </Button>
                )}
              </div>
            </div>
          </AnimatedDiv>
        </section>

        {/* Footer */}
        <AnimatedDiv triggerOnScroll variants={fadeInVariants}>
          <footer className="border-t border-default-200 bg-background px-4 py-8 md:px-6">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row sm:text-start">
              <div className="flex items-center gap-3">
                <Logo size="sm" className="h-7" />
                <p className="text-sm text-default-500">
                  {t("footer.tagline")}
                </p>
              </div>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
                <LanguageTogglePills />
                <p className="text-sm text-default-500 font-mono">
                  © {year} D-Arrow Business. {t("footer.rights")}
                </p>
              </div>
            </div>
          </footer>
        </AnimatedDiv>
      </SmoothScrollProvider>
    </div>
  );
}