import { SmoothScrollLink } from "@/components/landing/SmoothScrollLink";

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
              Precision Vesting,
              <br />
              <em>with Zero Friction.</em>
            </h1>
            <p className="sub">
              Onchain vesting infrastructure, built for everyone. Teams, DAOs, and investors use Velthoryn to distribute tokens — automated, transparent, and trustless. 
            </p>
            <div className="cta-row">
              <SmoothScrollLink href="#waitlist" className="lp-btn primary">
                Join waitlist <span className="arrow">&rarr;</span>
              </SmoothScrollLink>
              <button className="lp-btn ghost">Read the docs</button>
            </div>
            <div className="meta">
              <div>Audit by Mr G and Mr L</div>
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

          <div className="lp-brand-anim">
            <svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg" fill="none">
              <defs>
                <linearGradient id="bThread" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#7C3AED" />
                  <stop offset="0.5" stopColor="#14F1D9" />
                  <stop offset="1" stopColor="#22C55E" />
                </linearGradient>
                <radialGradient id="bHalo">
                  <stop offset="0" stopColor="#7C3AED" stopOpacity="0.18" />
                  <stop offset="0.7" stopColor="#7C3AED" stopOpacity="0" />
                </radialGradient>
                <filter id="bGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <circle cx="300" cy="300" r="260" fill="url(#bHalo)" />
              <g stroke="#1F2430" fill="none">
                <circle cx="300" cy="300" r="260" strokeDasharray="2 6" />
                <circle cx="300" cy="300" r="180" />
                <circle cx="300" cy="300" r="100" strokeDasharray="2 4" opacity="0.55" />
              </g>

              <g className="lp-brand-rot">
                <g stroke="#2A3140" strokeWidth="2" strokeLinecap="round">
                  <line x1="300" y1="34" x2="300" y2="50" />
                  <line x1="300" y1="550" x2="300" y2="566" />
                  <line x1="34" y1="300" x2="50" y2="300" />
                  <line x1="550" y1="300" x2="566" y2="300" />
                  <line x1="124" y1="124" x2="135" y2="135" opacity="0.6" />
                  <line x1="465" y1="465" x2="476" y2="476" opacity="0.6" />
                  <line x1="476" y1="124" x2="465" y2="135" opacity="0.6" />
                  <line x1="124" y1="476" x2="135" y2="465" opacity="0.6" />
                </g>
              </g>

              <g stroke="#E5E7EB" strokeLinecap="round" opacity="0.45">
                <line x1="90" y1="140" x2="300" y2="300" strokeWidth="2.5" />
                <line x1="510" y1="100" x2="300" y2="300" strokeWidth="2.5" />
                <line x1="540" y1="320" x2="300" y2="300" strokeWidth="1.5" />
                <line x1="110" y1="470" x2="300" y2="300" strokeWidth="1.5" />
                <line x1="300" y1="300" x2="380" y2="510" strokeWidth="2.5" />
              </g>

              <path
                d="M 90 140 C 220 80 280 200 300 300 C 320 420 480 470 380 510"
                stroke="url(#bThread)" strokeWidth="3" strokeLinecap="round"
                strokeDasharray="60 600" fill="none" opacity="0.9"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-660" dur="4.5s" repeatCount="indefinite" />
              </path>

              {/* Token particles: leaf to vault */}
              <circle r="5" fill="#7C3AED" filter="url(#bGlow)">
                <animateMotion dur="3s" repeatCount="indefinite" path="M 90 140 L 300 300" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="3s" repeatCount="indefinite" />
              </circle>
              <circle r="4" fill="#7C3AED" filter="url(#bGlow)">
                <animateMotion dur="3s" begin="1.5s" repeatCount="indefinite" path="M 90 140 L 300 300" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="3s" begin="1.5s" repeatCount="indefinite" />
              </circle>
              <circle r="5" fill="#14F1D9" filter="url(#bGlow)">
                <animateMotion dur="3.2s" begin="0.6s" repeatCount="indefinite" path="M 510 100 L 300 300" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="3.2s" begin="0.6s" repeatCount="indefinite" />
              </circle>
              <circle r="3" fill="#14F1D9" filter="url(#bGlow)">
                <animateMotion dur="3.4s" begin="1.2s" repeatCount="indefinite" path="M 540 320 L 300 300" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="3.4s" begin="1.2s" repeatCount="indefinite" />
              </circle>
              <circle r="3" fill="#7C3AED" filter="url(#bGlow)">
                <animateMotion dur="3.6s" begin="2s" repeatCount="indefinite" path="M 110 470 L 300 300" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="3.6s" begin="2s" repeatCount="indefinite" />
              </circle>

              {/* Token particles: vault to claim */}
              <circle r="6" fill="#22C55E" filter="url(#bGlow)">
                <animateMotion dur="2.6s" begin="1.5s" repeatCount="indefinite" path="M 300 300 L 380 510" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="2.6s" begin="1.5s" repeatCount="indefinite" />
              </circle>
              <circle r="5" fill="#22C55E" filter="url(#bGlow)">
                <animateMotion dur="2.6s" begin="3.5s" repeatCount="indefinite" path="M 300 300 L 380 510" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.85;1" dur="2.6s" begin="3.5s" repeatCount="indefinite" />
              </circle>

              {/* Radar pulses */}
              <circle cx="90" cy="140" r="22" fill="none" stroke="#7C3AED" strokeWidth="2" opacity="0.5">
                <animate attributeName="r" values="22;58;22" dur="3.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="3.6s" repeatCount="indefinite" />
              </circle>
              <circle cx="90" cy="140" r="22" fill="#0B0D12" stroke="#7C3AED" strokeWidth="8" />

              <circle cx="510" cy="100" r="20" fill="none" stroke="#14F1D9" strokeWidth="2" opacity="0.5">
                <animate attributeName="r" values="20;55;20" dur="3.2s" begin="0.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="3.2s" begin="0.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="510" cy="100" r="20" fill="#14F1D9" />

              <circle cx="540" cy="320" r="12" fill="#14F1D9" />
              <circle cx="110" cy="470" r="14" fill="#7C3AED" />

              <g transform="translate(300 300) rotate(45)">
                <rect x="-52" y="-52" width="104" height="104" rx="6" fill="#0B0D12" stroke="#E5E7EB" strokeWidth="10" />
              </g>
              <circle cx="300" cy="300" r="12" fill="#22C55E" filter="url(#bGlow)">
                <animate attributeName="r" values="10;16;10" dur="2.4s" repeatCount="indefinite" />
              </circle>
              <circle cx="300" cy="300" r="20" fill="none" stroke="#22C55E" strokeWidth="1.5" opacity="0.5">
                <animate attributeName="r" values="14;38;14" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
              </circle>

              <circle cx="380" cy="510" r="30" fill="none" stroke="#22C55E" strokeWidth="2" opacity="0.5">
                <animate attributeName="r" values="24;48;24" dur="2.8s" begin="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="2.8s" begin="1s" repeatCount="indefinite" />
              </circle>
              <circle cx="380" cy="510" r="24" fill="#0B0D12" stroke="#22C55E" strokeWidth="7" />
              <circle cx="380" cy="510" r="8" fill="#22C55E" />

              <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#64748B" letterSpacing="1.2">
                <text x="38" y="116">LEAF · 0x8af2</text>
                <text x="446" y="76">LEAF · 0x7e3a</text>
                <text x="344" y="556">CLAIM · vested</text>
                <text x="300" y="234" textAnchor="middle" fill="#94A3B8">VAULT · ROOT 0x…c104</text>
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
