"use client";

import React, { createContext, useContext, useEffect, useRef } from "react";

interface SmoothScrollContextType {
  scrollTo: (target: HTMLElement | number, options?: { offset?: number }) => void;
}

const SmoothScrollContext = createContext<SmoothScrollContextType | null>(null);

export const useSmoothScroll = () => useContext(SmoothScrollContext);

interface SmoothScrollProviderProps {
  children: React.ReactNode;
  lerp?: number;
}

function isTouchDevice() {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window)
  );
}

export default function SmoothScrollProvider({
  children,
  lerp = 0.2,
}: SmoothScrollProviderProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const target = useRef(0);
  const rafId = useRef<number | undefined>(undefined);
  const activeRef = useRef(false);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const onScrollRef = useRef<(() => void) | null>(null);
  const onAnchorClickRef = useRef<((e: MouseEvent) => void) | null>(null);
  const lastFrameTimeRef = useRef(0);
  const slowFrameStreakRef = useRef(0);
  const disableRef = useRef<(() => void) | null>(null);
  const enableRef = useRef<(() => void) | null>(null);

  const scrollToFn = (targetEl: HTMLElement | number, options?: { offset?: number }) => {
    if (typeof window === "undefined") return;
    const offset = options?.offset || 0;
    let y: number;
    if (typeof targetEl === "number") {
      y = targetEl;
    } else {
      const rect = targetEl.getBoundingClientRect();
      y = rect.top + window.scrollY + offset;
    }
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch = isTouchDevice();
    const content = contentRef.current;

    if (prefersReducedMotion || touch || !content) {
      return;
    }

    const enable = () => {
      if (activeRef.current) return;
      activeRef.current = true;

      content.style.position = "fixed";
      content.style.top = "0";
      content.style.left = "0";
      content.style.width = "100%";
      content.style.willChange = "transform";
      if (content.parentElement) content.parentElement.style.overflow = "hidden";

      const setHeight = () => {
        document.body.style.height = `${content.scrollHeight}px`;
      };
      setHeight();

      const resizeObserver = new ResizeObserver(setHeight);
      resizeObserver.observe(content);
      resizeObserverRef.current = resizeObserver;

      current.current = window.scrollY;
      target.current = window.scrollY;

      const onScroll = () => {
        target.current = window.scrollY;
      };
      onScrollRef.current = onScroll;
      window.addEventListener("scroll", onScroll, { passive: true });

      lastFrameTimeRef.current = performance.now();
      slowFrameStreakRef.current = 0;

      const raf = (now: number) => {
        const delta = now - lastFrameTimeRef.current;
        lastFrameTimeRef.current = now;

        if (delta > 33) {
          slowFrameStreakRef.current += 1;
        } else {
          slowFrameStreakRef.current = 0;
        }

        if (slowFrameStreakRef.current >= 5) {
          disableRef.current?.();
          return;
        }

        current.current += (target.current - current.current) * lerp;
        if (Math.abs(target.current - current.current) < 0.05) {
          current.current = target.current;
        }
        content.style.transform = `translate3d(0, ${-current.current}px, 0)`;
        rafId.current = requestAnimationFrame(raf);
      };
      rafId.current = requestAnimationFrame(raf);

      const handleAnchorClick = (e: MouseEvent) => {
        const el = e.target as HTMLElement;
        const anchor = el.closest("a");
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href) return;
        if (href.startsWith("#") || href.startsWith("/#")) {
          const hash = href.startsWith("/#") ? href.substring(1) : href;
          if (hash === "#") return;
          const targetEl = document.querySelector(hash) as HTMLElement | null;
          if (targetEl) {
            e.preventDefault();
            scrollToFn(targetEl, { offset: -80 });
          }
        }
      };
      onAnchorClickRef.current = handleAnchorClick;
      document.addEventListener("click", handleAnchorClick, { capture: true });
    };

    const disable = () => {
      if (!activeRef.current) return;
      activeRef.current = false;

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      document.body.style.height = "";
      if (onScrollRef.current) {
        window.removeEventListener("scroll", onScrollRef.current);
        onScrollRef.current = null;
      }
      if (onAnchorClickRef.current) {
        document.removeEventListener("click", onAnchorClickRef.current, {
          capture: true,
        });
        onAnchorClickRef.current = null;
      }
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = undefined;
      }

      content.style.position = "";
      content.style.top = "";
      content.style.left = "";
      content.style.width = "";
      content.style.transform = "";
      content.style.willChange = "";
      if (content.parentElement) content.parentElement.style.overflow = "";
    };

    disableRef.current = disable;
    enableRef.current = enable;

    enable();

    const retryInterval = window.setInterval(() => {
      if (!activeRef.current) {
        enable();
      }
    }, 2000);

    return () => {
      window.clearInterval(retryInterval);
      disable();
      disableRef.current = null;
      enableRef.current = null;
    };
  }, [lerp]);

  return (
    <SmoothScrollContext.Provider value={{ scrollTo: scrollToFn }}>
      <div>
        <div ref={contentRef}>{children}</div>
      </div>
    </SmoothScrollContext.Provider>
  );
}