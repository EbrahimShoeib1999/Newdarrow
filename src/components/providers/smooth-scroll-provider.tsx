"use client";

import React, { createContext, useContext, useEffect } from "react";

interface SmoothScrollContextType {
  scrollTo: (target: HTMLElement | number, options?: { offset?: number }) => void;
}

const SmoothScrollContext = createContext<SmoothScrollContextType | null>(null);

export const useSmoothScroll = () => useContext(SmoothScrollContext);

interface SmoothScrollProviderProps {
  children: React.ReactNode;
  /**
   @deprecated Kept for API compatibility only. The old lerp value drove a
   JavaScript scroll-hijack (fixed positioning + transform + body-height sync +
   a rAF loop with a periodic re-enable). That machinery created competing
   scroll owners and made the page jump/freeze during ordinary scrolling, so it
   has been removed in favour of native scrolling. The prop is ignored.
   */
  lerp?: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? "auto" : "smooth");

/**
 * Anchor smooth-scrolling is handled with native CSS (`scroll-behavior: smooth`
 * on <html>) plus `scroll-margin-top` on the target sections, so the sticky nav
 * never overlaps a heading. This provider only:
 *  - applies the native smooth flag for ordinary/anchor scrolling (respecting
 *    prefers-reduced-motion), and
 *  - exposes an imperative `scrollTo` for callers that need it.
 *
 * It intentionally does NOT reposition the content or own the scroll — doing so
 * was the source of the reported homepage scroll jumps and jank.
 */
export default function SmoothScrollProvider({ children }: SmoothScrollProviderProps) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    // Reduced motion: leave the page on instant native scrolling.
    if (!prefersReducedMotion()) {
      root.style.scrollBehavior = "smooth";
    }
    return () => {
      root.style.scrollBehavior = previous;
    };
  }, []);

  const scrollToFn = (targetEl: HTMLElement | number, options?: { offset?: number }) => {
    if (typeof window === "undefined") return;
    const offset = options?.offset || 0;
    if (typeof targetEl === "number") {
      window.scrollTo({ top: targetEl, behavior: scrollBehavior() });
      return;
    }
    const rect = targetEl.getBoundingClientRect();
    window.scrollTo({ top: rect.top + window.scrollY + offset, behavior: scrollBehavior() });
  };

  return (
    <SmoothScrollContext.Provider value={{ scrollTo: scrollToFn }}>
      {children}
    </SmoothScrollContext.Provider>
  );
}
