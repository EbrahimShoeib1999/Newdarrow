import { Link } from "react-router-dom";
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
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <Link to="/" className="shrink-0 transition-transform duration-300 hover:scale-105">
            <Logo size="sm" className="h-9" />
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-default-600 md:flex">
            {[
              { href: "#apps", label: t("nav.apps") },
              { href: "#features", label: t("nav.features") },
              { href: "#cta", label: t("nav.pricing") },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="group relative transition-colors hover:text-primary"
              >
                {item.label}
                <span className="absolute -bottom-1 start-0 h-0.5 w-0 bg-primary transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LanguageTogglePills className="hidden sm:inline-flex" />
            <LanguageSwitcher compact className="sm:hidden" />
            {isAuthenticated ? (
              <Button
                as={Link}
                to="/apps"
                color="primary"
                size="sm"
                className="font-semibold shadow-md shadow-primary/20 transition-transform duration-300 hover:scale-105"
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
                  className="hidden font-semibold sm:inline-flex"
                >
                  {t("nav.signIn")}
                </Button>
                <Button
                  as={Link}
                  to="/register"
                  color="primary"
                  size="sm"
                  className="font-semibold transition-transform duration-300 hover:scale-105"
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
}: {
  label: string;
  icon: LucideIcon;
  gradient: string;
}) {
  return (
    <div className="group flex flex-col items-center gap-3 text-center">
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
    </div>
  );
}

const FEATURE_ITEMS = [
  { key: "integrated", icon: Layers },
  { key: "rtl", icon: Globe2 },
  { key: "secure", icon: Shield },
  { key: "fast", icon: Zap },
] as const;

export function LandingPage({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const { t } = useTranslation("landing");
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-default-50 text-foreground">
      <LandingNav isAuthenticated={isAuthenticated} />

      <SmoothScrollProvider>
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-16 pt-12 md:px-6 md:pt-20 md:pb-24">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/8 via-transparent to-transparent" />
          <div className="relative mx-auto max-w-4xl text-center">
            <AnimatedDiv delay={0.05}>
              <h1 className="text-4xl font-black leading-tight tracking-tight md:text-6xl lg:text-7xl">
                {t("hero.title")}{" "}
                <span className="relative inline-block">
                  <span className="relative z-10">{t("hero.titleHighlight")}</span>
                  <span
                    className="absolute -inset-x-2 bottom-1 z-0 h-3 rounded-sm bg-warning/70 md:h-4 md:bottom-2"
                    aria-hidden
                  />
                </span>
              </h1>
            </AnimatedDiv>
            <AnimatedDiv delay={0.18}>
              <p className="mt-6 text-xl font-medium text-default-600 md:text-2xl">
                {t("hero.subtitle")}{" "}
                <span className="font-bold text-primary underline decoration-primary/30 underline-offset-4">
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
              delay={0.4}
              className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Button
                as={Link}
                to={isAuthenticated ? "/apps" : "/register"}
                color="primary"
                size="lg"
                className="min-w-[200px] font-bold shadow-lg shadow-primary/25 transition-transform duration-300 hover:-translate-y-0.5 hover:scale-105"
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
              <Button
                as={Link}
                to="/login"
                variant="bordered"
                size="lg"
                className="min-w-[160px] font-semibold bg-background transition-transform duration-300 hover:-translate-y-0.5"
              >
                {t("hero.ctaSecondary")}
              </Button>
            </AnimatedDiv>
          </div>
        </section>

        {/* Apps grid */}
        <section id="apps" className="bg-background px-4 py-16 md:px-6 md:py-20">
          <div className="mx-auto max-w-5xl">
            <AnimatedDiv triggerOnScroll variants={fadeInUpVariants} className="mb-12 text-center">
              <h2 className="text-2xl font-black md:text-3xl">{t("apps.title")}</h2>
              <p className="mt-3 text-default-500 max-w-2xl mx-auto">
                {t("apps.subtitle")}
              </p>
            </AnimatedDiv>

            <div className="grid grid-cols-3 gap-8 sm:grid-cols-4 md:grid-cols-7 md:gap-6">
              {LANDING_APPS.map((app, index) => (
                <AnimatedDiv
                  key={app.id}
                  triggerOnScroll
                  amount={0.15}
                  delay={index * 0.07}
                  variants={scaleInVariants}
                >
                  <AppTile
                    label={t(app.labelKey)}
                    icon={app.icon}
                    gradient={app.gradient}
                  />
                </AnimatedDiv>
              ))}
            </div>

            <AnimatedDiv triggerOnScroll delay={0.2} className="mt-12 text-center">
              <Button
                as={Link}
                to={isAuthenticated ? "/apps" : "/register"}
                variant="flat"
                color="primary"
                className="font-semibold transition-transform duration-300 hover:scale-105"
                endContent={<ArrowRight className="h-4 w-4 rtl:rotate-180" />}
              >
                {t("apps.viewAll")}
              </Button>
            </AnimatedDiv>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-4 py-16 md:px-6 md:py-20 bg-default-50">
          <div className="mx-auto max-w-5xl">
            <AnimatedDiv triggerOnScroll className="mb-12 text-center">
              <h2 className="text-2xl font-black md:text-3xl">
                {t("features.title")}
              </h2>
            </AnimatedDiv>
            <div className="grid gap-6 sm:grid-cols-2">
              {FEATURE_ITEMS.map(({ key, icon: Icon }, index) => (
                <AnimatedDiv
                  key={key}
                  triggerOnScroll
                  amount={0.2}
                  delay={index * 0.1}
                  variants={fadeInUpVariants}
                >
                  <div className="group h-full rounded-2xl border border-default-200 bg-background p-6 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10">
                    <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-all duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-lg font-bold transition-colors group-hover:text-primary">
                      {t(`features.${key}.title`)}
                    </h3>
                    <p className="mt-2 text-sm text-default-500 leading-relaxed">
                      {t(`features.${key}.desc`)}
                    </p>
                  </div>
                </AnimatedDiv>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="cta" className="px-4 py-16 md:px-6 md:py-24">
          <AnimatedDiv triggerOnScroll amount={0.3} variants={scaleInVariants} className="mx-auto max-w-3xl">
            <div className="rounded-3xl bg-gradient-to-br from-primary to-violet-600 px-8 py-14 text-center text-white shadow-xl transition-shadow duration-300 hover:shadow-2xl hover:shadow-primary/30">
              <h2 className="text-2xl font-black md:text-4xl">{t("cta.title")}</h2>
              <p className="mt-4 text-white/80 md:text-lg">{t("cta.subtitle")}</p>
              <Button
                as={Link}
                to={isAuthenticated ? "/apps" : "/register"}
                size="lg"
                className="mt-8 min-w-[200px] bg-white font-bold text-primary transition-transform duration-300 hover:-translate-y-0.5 hover:scale-105"
              >
                {isAuthenticated ? t("nav.workspace", "My Workspace") : t("cta.button")}
              </Button>
            </div>
          </AnimatedDiv>
        </section>

        {/* Footer */}
        <AnimatedDiv triggerOnScroll variants={fadeInVariants}>
          <footer className="border-t border-default-200 bg-background px-4 py-8 md:px-6">
            <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row sm:text-start">
              <p className="text-sm text-default-500 text-center sm:text-start">
                {t("footer.tagline")}
              </p>
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-6">
                <LanguageTogglePills />
                <p className="text-sm text-default-500">
                  © {year} D-Arrow. {t("footer.rights")}
                </p>
              </div>
            </div>
          </footer>
        </AnimatedDiv>
      </SmoothScrollProvider>
    </div>
  );
}