import { useCallback, useRef, useState, useEffect, type CSSProperties } from "react";

const animatedIds = new Set<string>();

type Vars = { hidden: CSSProperties; visible: CSSProperties };

export const fadeInUpVariants: Vars = {
  hidden: { opacity: 0, transform: "translateY(20px)" },
  visible: { opacity: 1, transform: "translateY(0px)" },
};

export const fadeInDownVariants: Vars = {
  hidden: { opacity: 0, transform: "translateY(-20px)" },
  visible: { opacity: 1, transform: "translateY(0px)" },
};

export const fadeInLeftVariants: Vars = {
  hidden: { opacity: 0, transform: "translateX(-20px)" },
  visible: { opacity: 1, transform: "translateX(0px)" },
};

export const fadeInRightVariants: Vars = {
  hidden: { opacity: 0, transform: "translateX(20px)" },
  visible: { opacity: 1, transform: "translateX(0px)" },
};

export const fadeInVariants: Vars = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const scaleInVariants: Vars = {
  hidden: { opacity: 0, transform: "scale(0.95)" },
  visible: { opacity: 1, transform: "scale(1)" },
};

interface AnimatedDivProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  variants?: Vars;
  triggerOnScroll?: boolean;
  waitUntilLoaded?: boolean;
  amount?: number;
  id?: string;
}

const AnimatedDiv = ({
  children,
  delay = 0,
  duration = 0.5,
  variants: customVariants,
  triggerOnScroll = false,
  waitUntilLoaded = false,
  amount = 0.1,
  id,
  className = "",
  style,
  ...props
}: AnimatedDivProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(() => (id ? animatedIds.has(id) : false));
  const [readyToAnimate, setReadyToAnimate] = useState(!waitUntilLoaded);
  const [inView, setInView] = useState(() => (id ? animatedIds.has(id) : false));
  const activeVariants = customVariants || fadeInUpVariants;

  const markAnimated = useCallback(() => {
    if (id) animatedIds.add(id);
    setHasAnimated(true);
  }, [id]);

  useEffect(() => {
    if (waitUntilLoaded && typeof window !== "undefined") {
      const onFinish = () => setReadyToAnimate(true);
      window.addEventListener("preloaderFinished", onFinish);
      return () => window.removeEventListener("preloaderFinished", onFinish);
    }
  }, [waitUntilLoaded]);

  useEffect(() => {
    if (triggerOnScroll || hasAnimated) return;
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!hasAnimated) {
          markAnimated();
          setInView(true);
        }
      });
    });
    return () => cancelAnimationFrame(rafId);
  }, [triggerOnScroll, hasAnimated, markAnimated]);

  useEffect(() => {
    if (!triggerOnScroll || !ref.current || hasAnimated) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          markAnimated();
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold: amount }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [triggerOnScroll, amount, hasAnimated, markAnimated]);

  const show = hasAnimated ? readyToAnimate : readyToAnimate && inView;
  const currentStyle = show ? activeVariants.visible : activeVariants.hidden;
  const isLocked = hasAnimated && Boolean(id);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...(isLocked ? {} : currentStyle),
        transition: isLocked
          ? "none"
          : `opacity ${duration}s ease-out ${delay}s, transform ${duration}s ease-out ${delay}s`,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
};

export default AnimatedDiv;