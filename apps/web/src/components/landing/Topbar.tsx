/**
 * Topbar - Sticky navigation bar for the Velthoryn landing page.
 * All class names are prefixed with `lp-` to avoid style conflicts.
 */
"use client";

import Image from "next/image";
import { useState } from "react";
import { SmoothScrollLink } from "./SmoothScrollLink";

const navLinks = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#demo", label: "Demo" },
  { href: "#faq", label: "FAQ" },
];

export function Topbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="lp-topbar">
      <div className="lp-wrap lp-topbar-inner">
        <SmoothScrollLink className="lp-brand" href="#top" onNavigate={() => setMenuOpen(false)}>
          <span className="lp-brand-mark">
            <Image
              src="/brand/velthoryn-logo-sm.svg"
              alt=""
              aria-hidden="true"
              className="lp-brand-logo"
              width={28}
              height={28}
            />
          </span>
          <span className="name">Velthoryn</span>
        </SmoothScrollLink>
        <nav className="lp-nav">
          {navLinks.map((link) => (
            <SmoothScrollLink
              key={link.href}
              href={link.href}
              onNavigate={() => setMenuOpen(false)}
            >
              {link.label}
            </SmoothScrollLink>
          ))}
        </nav>
        <div className="lp-topbar-actions">
          <SmoothScrollLink
            href="#waitlist"
            className="lp-btn waitlist-cta"
            onNavigate={() => setMenuOpen(false)}
          >
            Join waitlist <span className="arrow">&rarr;</span>
          </SmoothScrollLink>
          <button
            type="button"
            className={`lp-menu-toggle${menuOpen ? " is-open" : ""}`}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <nav id="lp-mobile-nav" className={`lp-nav lp-nav-mobile${menuOpen ? " is-open" : ""}`}>
          {navLinks.map((link) => (
            <SmoothScrollLink
              key={link.href}
              href={link.href}
              onNavigate={() => setMenuOpen(false)}
            >
              {link.label}
            </SmoothScrollLink>
          ))}
          <SmoothScrollLink
            href="#waitlist"
            className="lp-mobile-cta"
            onNavigate={() => setMenuOpen(false)}
          >
            Join waitlist <span className="arrow">&rarr;</span>
          </SmoothScrollLink>
        </nav>
      </div>
    </header>
  );
}
