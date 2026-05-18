"use client";

import { useState, type FormEvent } from "react";

export function Waitlist() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      (form.elements.namedItem("email") as HTMLInputElement).focus();
      return;
    }
    setSubmitted(true);
  }

  return (
    <section className="lp-sect" id="waitlist" style={{ padding: "40px 0 100px" }}>
      <div className="lp-wrap">
        <div className="lp-waitlist lp-reveal">
          <div className="lp-waitlist-inner">
            <div className="eyebrow">
              <i /> EARLY ACCESS · LIMITED SPOTS
            </div>
            <h2>
              Be first on the <em>mainnet rollout.</em>
            </h2>
            <p className="lede">
              Leave your email. We&apos;ll let you know when live campaigns
              open, plus a personal onboarding session for the first 100 teams.
            </p>
            {!submitted ? (
              <form className="lp-waitlist-form" onSubmit={handleSubmit} noValidate>
                <input
                  type="email"
                  name="email"
                  placeholder="you@yourproject.xyz"
                  required
                  autoComplete="email"
                />
                <button type="submit">
                  Join waitlist <span className="arrow">→</span>
                </button>
              </form>
            ) : (
              <div className="lp-waitlist-success show">
                ✓ You&apos;re on the list. We&apos;ll reach out soon.
              </div>
            )}
            <div className="lp-waitlist-meta">
              <div>
                <i style={{ background: "var(--lp-green)" }} /> <b>Founding</b>{" "}
                access open
              </div>
              <div>
                <i style={{ background: "var(--lp-violet-2)" }} />{" "}
                <b>Q3 2026</b> mainnet target
              </div>
              <div>
                <i style={{ background: "var(--lp-teal)" }} /> Product updates
                only
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
