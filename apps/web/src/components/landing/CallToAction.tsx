import { SmoothScrollLink } from "@/components/landing/SmoothScrollLink";

export function CallToAction() {
  return (
    <section className="lp-sect" style={{ padding: "40px 0 80px" }}>
      <div className="lp-wrap">
        <div className="lp-cta lp-reveal">
          <div className="lp-cta-left">
            <h2>
              Start your first campaign
              <br />
              <em>with Velthoryn.</em>
            </h2>
            <p>
              Bring your token, recipient list, and vesting plan. Join the
              waitlist to be first in line when live distributions open.
            </p>
            <div className="cta-row">
              <SmoothScrollLink href="#waitlist" className="lp-btn dark">
                Join waitlist
              </SmoothScrollLink>
            </div>
          </div>
          <div className="lp-cta-right">
            <svg viewBox="0 0 512 512">
              <use href="#logoA" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
