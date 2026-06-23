import Link from "next/link";
import { SmoothScrollLink } from "@/components/landing/SmoothScrollLink";

const repoUrl = "https://github.com/Ah-Riz/velthoryn";
const docsUrl = `${repoUrl}/tree/main/docs`;

/**
 * Hero - Landing page hero section with animated Aperture brand mark.
 * All animations use native SVG <animate> elements (no JS required).
 * All class names are prefixed with `lp-` to avoid style conflicts.
 */
export function Hero() {
  return (
    <section className="lp-hero" id="top">
      <div className="lp-wrap">
        <div className="lp-hero-grid">
          <div className="lp-hero-left">
            <h1>
              Precision Vesting
              <br />
              <em>on Solana.</em>
            </h1>
            <p className="sub">
              Onchain vesting infrastructure, built for everyone. Teams, DAOs, and investors use Velthoryn to distribute tokens — automated, transparent, and trustless. 
            </p>
            <div className="cta-row">
              <SmoothScrollLink href="#waitlist" className="lp-btn primary">
                Join waitlist <span className="arrow">&rarr;</span>
              </SmoothScrollLink>
              <Link href="/dashboard" className="lp-btn ghost">
                Open app <span className="arrow">&rarr;</span>
              </Link>
              <a
                href={docsUrl}
                className="lp-btn ghost"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the docs
              </a>
            </div>
            <div className="meta">
              <div>Independent audit planned before mainnet</div>
              <div>
                <i style={{ background: "var(--lp-violet-2)" }} />{" "}
                <b>$0+</b> sent out so far
              </div>
              <div>
                <i style={{ background: "var(--lp-teal)" }} />{" "}
                <b>0</b> projects using it
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
