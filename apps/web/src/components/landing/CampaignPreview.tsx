export function CampaignPreview() {
  return (
    <section className="lp-sect" style={{ paddingTop: 96 }}>
      <div className="lp-wrap">
        <h2 className="lp-sect-title lp-reveal">
          What your campaign
          <br />
          <em>looks like.</em>
        </h2>
        <p className="lp-sect-sub">
          Every campaign, its own page. See who&apos;s unlocked, who&apos;s claimed, and what&apos;s pending - in real time. Recipients only see their own allocation.
        </p>

        <div style={{ position: "relative", maxWidth: 720, margin: "0 auto" }}>
          <div className="lp-annotate tl">example campaign view</div>
          <div className="lp-annotate tr" style={{ color: "var(--lp-violet-2)" }}>
            <b>● DEMO</b>
          </div>
          <div className="lp-live-card">
            <div className="lc-head">
              <span
                className="dot"
                style={{
                  background: "var(--lp-violet-2)",
                  boxShadow: "0 0 10px var(--lp-violet-2)",
                }}
              />
              <span className="t">
                <b style={{ color: "var(--lp-violet-2)" }}>● DEMO</b>
              </span>
              <span className="t" style={{ color: "var(--lp-silver-2)" }}>
                example campaign view
              </span>
              <span className="tt">root pending</span>
            </div>
            <div className="lc-body">
              <div className="lp-lc-row">
                <div className="lbl">SAMPLE CAMPAIGN</div>
                <div className="val">0 recipients</div>
              </div>
              <div className="lp-lc-title">Token allocation, 24-month linear</div>

              <div className="lp-lc-chart">
                <svg viewBox="0 0 400 130" preserveAspectRatio="none">
                  <g stroke="#1F2430" strokeWidth="0.5">
                    <line x1="0" y1="32" x2="400" y2="32" />
                    <line x1="0" y1="64" x2="400" y2="64" />
                    <line x1="0" y1="96" x2="400" y2="96" />
                  </g>
                  <path
                    d="M 0 128 L 30 128 L 30 116 L 70 108 L 110 92 L 145 76 L 175 60 L 210 50 L 245 40 L 280 32 L 315 24 L 350 18 L 400 14 L 400 130 L 0 130 Z"
                    fill="url(#curveFill)"
                  />
                  <path
                    d="M 0 128 L 30 128 L 30 116 L 70 108 L 110 92 L 145 76 L 175 60 L 210 50 L 245 40 L 280 32 L 315 24 L 350 18 L 400 14"
                    fill="none"
                    stroke="#A78BFA"
                    strokeWidth="2"
                  />
                  <line x1="30" y1="0" x2="30" y2="128" stroke="#14F1D9" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
                  <text x="34" y="14" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#14F1D9" letterSpacing="0.5">
                    cliff · 3mo
                  </text>
                </svg>
              </div>

              <div className="lp-lc-stats">
                <div className="lp-lc-stat">
                  <div className="l">VESTED</div>
                  <div className="v">
                    0<small>%</small>
                  </div>
                </div>
                <div className="lp-lc-stat">
                  <div className="l">ALLOCATION</div>
                  <div className="v">0</div>
                </div>
                <div className="lp-lc-stat">
                  <div className="l">UNLOCK</div>
                  <div className="v">—</div>
                </div>
              </div>

              <div className="lp-lc-recip">
                {[
                  { gradient: undefined },
                  { gradient: "linear-gradient(135deg,#14F1D9,#22C55E)" },
                  { gradient: "linear-gradient(135deg,#7C3AED,#A78BFA)" },
                ].map((r, i) => (
                  <div className="lp-recip" key={i}>
                    <div
                      className="ava"
                      style={r.gradient ? { background: r.gradient } : undefined}
                    />
                    <div className="addr">recipient.sol</div>
                    <span className="stat-badge pending">PENDING</span>
                    <div className="amt">0 $VLT</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
