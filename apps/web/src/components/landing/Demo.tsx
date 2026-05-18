import { SmoothScrollLink } from "@/components/landing/SmoothScrollLink";

export function Demo() {
  return (
    <section className="lp-sect" id="demo" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <h2 className="lp-sect-title lp-reveal">
          See how a campaign comes together.
        </h2>
        <p className="lp-sect-sub">
          A short walkthrough of campaign setup, vesting configuration, and
          recipient claims is on the way.
        </p>

        <div className="lp-demo-card lp-reveal">
          <div className="lp-demo-grid-bg" />
          <div
            className="lp-demo-content"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div
              className="lp-demo-video"
              style={{
                width: "100%",
                maxWidth: 800,
                aspectRatio: "16 / 9",
                borderRadius: 12,
                border: "1px solid var(--lp-line)",
                background: "rgba(255,255,255,0.03)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
              }}
            >
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                fill="none"
                style={{ opacity: 0.4 }}
              >
                <circle
                  cx="32"
                  cy="32"
                  r="30"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <polygon points="26,20 26,44 46,32" fill="currentColor" />
              </svg>
              <span
                style={{
                  color: "var(--lp-silver-2)",
                  fontSize: 14,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Walkthrough coming soon
              </span>
            </div>
            <SmoothScrollLink href="#waitlist" className="lp-btn primary lp-demo-cta">
              Join waitlist{" "}
              <span className="arrow">&rarr;</span>
            </SmoothScrollLink>
          </div>
        </div>
      </div>
    </section>
  );
}
