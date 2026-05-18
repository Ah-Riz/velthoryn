"use client";

import type { AnchorHTMLAttributes, MouseEvent } from "react";

type SmoothScrollLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  onNavigate?: () => void;
};

function scrollToHash(href: string) {
  if (!href.startsWith("#")) {
    return false;
  }

  const target = document.querySelector<HTMLElement>(href);
  if (!target) {
    return false;
  }

  const topbar = document.querySelector<HTMLElement>(".lp-topbar");
  const offset = (topbar?.getBoundingClientRect().height ?? 0) + 18;
  const top = target.getBoundingClientRect().top + window.scrollY - offset;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.history.pushState(null, "", href);
  window.scrollTo({
    top: Math.max(0, top),
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });

  return true;
}

export function SmoothScrollLink({
  href,
  onClick,
  onNavigate,
  children,
  ...props
}: SmoothScrollLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (typeof href !== "string" || !href.startsWith("#")) {
      onNavigate?.();
      return;
    }

    event.preventDefault();
    const didScroll = scrollToHash(href);
    if (didScroll) {
      onNavigate?.();
    }
  }

  return (
    <a href={href} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}
