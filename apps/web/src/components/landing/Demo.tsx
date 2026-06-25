import { SmoothScrollLink } from "@/components/landing/SmoothScrollLink";

const DEMO_VIDEO_URL =
  "https://akxrfgwkdmragzlzlgbd.supabase.co/storage/v1/object/sign/velthoryn-bucket/Demo-Backup-Velthoryn%20(1).mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV81YTgzZDI4Zi1hNWE3LTQ0YmMtYWY2OC0zMjkzYTEzMzZjY2QiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJ2ZWx0aG9yeW4tYnVja2V0L0RlbW8tQmFja3VwLVZlbHRob3J5biAoMSkubXA0Iiwic2NvcGUiOiJkb3dubG9hZCIsImlhdCI6MTc4MjQxNTA1MSwiZXhwIjoxODEzOTUxMDUxfQ.UVoU7d0lJ5musRCVnPukDn0VYeYlxdxqMyvHp8TAKBE";

export function Demo() {
  return (
    <section className="lp-sect" id="demo" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <div className="lp-sect-eyebrow">
          <span className="lp-demo-dot" style={{ marginRight: 8 }} />
          Watch Demo
        </div>
        <h2 className="lp-sect-title lp-reveal">
          See how a campaign comes together.
        </h2>
        <p className="lp-sect-sub">
          Full walkthrough — campaign setup, vesting configuration, and
          recipient claims in under five minutes.
        </p>

        <div className="lp-demo-vp-wrap lp-reveal">
          <div className="lp-demo-vp-glow" />
          <div className="lp-demo-vp-card">

            {/* Browser chrome bar */}
            <div className="lp-demo-vp-chrome">
              <div className="lp-demo-vp-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="lp-demo-vp-url">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                app.velthoryn.site
              </div>
              <div className="lp-demo-vp-badge">
                <span className="lp-demo-dot" />
                LIVE
              </div>
            </div>

            {/* Video */}
            <video
              className="lp-demo-vp-video"
              src={DEMO_VIDEO_URL}
              controls
              playsInline
              preload="metadata"
            />

            {/* Footer metadata */}
            <div className="lp-demo-vp-footer">
              <span>Velthoryn Protocol &middot; <b>Campaign Walkthrough</b></span>
              <span>~4 min</span>
            </div>
          </div>
        </div>

        <div className="lp-demo-vp-cta">
          <SmoothScrollLink href="#waitlist" className="lp-btn primary lp-demo-cta">
            Join waitlist{" "}
            <span className="arrow">&rarr;</span>
          </SmoothScrollLink>
        </div>
      </div>
    </section>
  );
}
