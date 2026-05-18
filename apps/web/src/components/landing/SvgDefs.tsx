/**
 * SvgDefs - Invisible SVG containing all shared symbol and gradient definitions
 * used across the Velthoryn landing page. Rendered once at the top of the page
 * so that <use href="#..."> references resolve everywhere.
 */
export function SvgDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <linearGradient id="threadA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7C3AED" />
          <stop offset="0.6" stopColor="#14F1D9" />
          <stop offset="1" stopColor="#22C55E" />
        </linearGradient>
        <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7C3AED" stopOpacity="0.45" />
          <stop offset="1" stopColor="#7C3AED" stopOpacity="0" />
        </linearGradient>

        <symbol id="logoA" viewBox="0 0 512 512">
          <circle cx="252" cy="268" r="120" fill="none" stroke="#1F2430" strokeWidth="1" />
          <circle cx="252" cy="268" r="76" fill="none" stroke="#1F2430" strokeWidth="1" />
          <g fill="none" stroke="#E5E7EB" strokeLinecap="round">
            <line x1="88" y1="116" x2="252" y2="268" strokeWidth="3" opacity="0.85" />
            <line x1="408" y1="76" x2="252" y2="268" strokeWidth="3" opacity="0.85" />
            <line x1="452" y1="244" x2="252" y2="268" strokeWidth="2" opacity="0.55" />
            <line x1="104" y1="364" x2="252" y2="268" strokeWidth="2" opacity="0.45" />
            <line x1="252" y1="268" x2="296" y2="428" strokeWidth="3" opacity="0.85" />
          </g>
          <path d="M 60 200 C 140 80, 280 140, 252 268 C 232 372, 360 380, 296 428" fill="none" stroke="url(#threadA)" strokeWidth="3" strokeLinecap="round" strokeDasharray="600" strokeDashoffset="0" opacity="0.95">
            <animate attributeName="stroke-dashoffset" from="600" to="0" dur="3.6s" repeatCount="indefinite" />
          </path>
          <circle cx="88" cy="116" r="22" fill="#0B0D12" stroke="#7C3AED" strokeWidth="8" />
          <circle cx="408" cy="76" r="18" fill="#14F1D9" />
          <circle cx="452" cy="244" r="11" fill="#14F1D9" />
          <circle cx="104" cy="364" r="13" fill="#7C3AED" />
          <g transform="translate(252 268) rotate(45)">
            <rect x="-38" y="-38" width="76" height="76" rx="4" fill="#0B0D12" stroke="#E5E7EB" strokeWidth="10" />
          </g>
          <circle cx="252" cy="268" r="12" fill="#22C55E" />
          <circle cx="296" cy="428" r="20" fill="#0B0D12" stroke="#22C55E" strokeWidth="7" />
          <circle cx="296" cy="428" r="6" fill="#22C55E" />
        </symbol>

        <symbol id="logoSm" viewBox="0 0 512 512">
          <g fill="none" stroke="#E5E7EB" strokeLinecap="round">
            <line x1="88" y1="116" x2="252" y2="268" strokeWidth="14" />
            <line x1="408" y1="76" x2="252" y2="268" strokeWidth="14" />
            <line x1="252" y1="268" x2="296" y2="428" strokeWidth="14" />
          </g>
          <circle cx="88" cy="116" r="32" fill="#7C3AED" />
          <circle cx="408" cy="76" r="28" fill="#14F1D9" />
          <g transform="translate(252 268) rotate(45)"><rect x="-44" y="-44" width="88" height="88" rx="6" fill="#0B0D12" stroke="#E5E7EB" strokeWidth="20" /></g>
          <circle cx="296" cy="428" r="26" fill="#22C55E" />
        </symbol>

        {/* Step diagrams */}
        <symbol id="step1" viewBox="0 0 200 100">
          <g fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#64748B">
            <text x="6" y="22">addr_01</text>
            <text x="6" y="42">addr_02</text>
            <text x="6" y="62">addr_03</text>
            <text x="6" y="82">addr_04</text>
          </g>
          <g stroke="#E5E7EB" strokeWidth="1.5" fill="none">
            <line x1="60" y1="18" x2="100" y2="40" />
            <line x1="60" y1="38" x2="100" y2="40" />
            <line x1="60" y1="58" x2="100" y2="68" />
            <line x1="60" y1="78" x2="100" y2="68" />
            <line x1="100" y1="40" x2="160" y2="54" />
            <line x1="100" y1="68" x2="160" y2="54" />
          </g>
          <circle cx="100" cy="40" r="4" fill="#7C3AED" />
          <circle cx="100" cy="68" r="4" fill="#14F1D9" />
          <circle cx="160" cy="54" r="6" fill="#E5E7EB" />
        </symbol>
        <symbol id="step2" viewBox="0 0 200 100">
          <line x1="20" y1="80" x2="180" y2="80" stroke="#1F2430" />
          <line x1="20" y1="20" x2="20" y2="80" stroke="#1F2430" />
          <path d="M 20 80 L 60 80 L 60 60 L 100 50 L 140 35 L 180 25" stroke="#7C3AED" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <circle cx="60" cy="60" r="3" fill="#14F1D9" />
          <circle cx="100" cy="50" r="3" fill="#14F1D9" />
          <circle cx="140" cy="35" r="3" fill="#14F1D9" />
          <circle cx="180" cy="25" r="3" fill="#22C55E" />
          <text x="55" y="95" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="#64748B">cliff</text>
        </symbol>
        <symbol id="step3" viewBox="0 0 200 100">
          <g stroke="#E5E7EB" strokeWidth="1.5" strokeLinecap="round" fill="none">
            <line x1="20" y1="50" x2="80" y2="50" />
            <line x1="120" y1="50" x2="180" y2="50" />
          </g>
          <circle cx="20" cy="50" r="6" fill="none" stroke="#7C3AED" strokeWidth="2" />
          <polygon points="92,50 108,42 108,58" fill="#14F1D9" />
          <circle cx="180" cy="50" r="6" fill="#22C55E" />
          <text x="14" y="78" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="#64748B">root</text>
          <text x="160" y="78" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="#64748B">user</text>
        </symbol>
        <symbol id="step4" viewBox="0 0 200 100">
          <line x1="20" y1="50" x2="180" y2="50" stroke="#1F2430" strokeDasharray="2 3" />
          <rect x="40" y="40" width="50" height="20" rx="3" fill="none" stroke="#22C55E" strokeWidth="1.5" />
          <rect x="100" y="40" width="60" height="20" rx="3" fill="none" stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="3 3" />
          <text x="48" y="54" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#22C55E">grace 7d</text>
          <text x="106" y="54" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#7C3AED">rotate</text>
        </symbol>

        {/* Pillar glyphs */}
        <symbol id="gMerkle" viewBox="0 0 64 64">
          <g stroke="#E5E7EB" strokeWidth="1.5" fill="none" strokeLinecap="round">
            <line x1="16" y1="14" x2="32" y2="32" />
            <line x1="48" y1="14" x2="32" y2="32" />
            <line x1="32" y1="32" x2="22" y2="50" />
            <line x1="32" y1="32" x2="42" y2="50" />
          </g>
          <circle cx="16" cy="14" r="4" fill="#7C3AED" />
          <circle cx="48" cy="14" r="4" fill="#14F1D9" />
          <circle cx="32" cy="32" r="5" fill="#0B0D12" stroke="#E5E7EB" strokeWidth="2" />
          <circle cx="22" cy="50" r="3" fill="#7C3AED" opacity="0.7" />
          <circle cx="42" cy="50" r="3" fill="#14F1D9" opacity="0.7" />
        </symbol>
        <symbol id="gVesting" viewBox="0 0 64 64">
          <line x1="10" y1="50" x2="54" y2="50" stroke="#1F2430" />
          <line x1="10" y1="14" x2="10" y2="50" stroke="#1F2430" />
          <path d="M 10 50 L 18 50 L 18 42 L 28 36 L 38 28 L 54 18" stroke="#7C3AED" strokeWidth="2" fill="none" strokeLinejoin="round" />
          <circle cx="18" cy="42" r="2.5" fill="#14F1D9" />
          <circle cx="38" cy="28" r="2.5" fill="#14F1D9" />
          <circle cx="54" cy="18" r="3" fill="#22C55E" />
        </symbol>
        <symbol id="gClawback" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="20" fill="none" stroke="#1F2430" strokeWidth="1" strokeDasharray="3 3" />
          <path d="M 20 22 A 16 16 0 1 1 18 36" stroke="#7C3AED" strokeWidth="2" fill="none" strokeLinecap="round" />
          <polygon points="14,32 22,28 22,36" fill="#7C3AED" />
          <circle cx="32" cy="32" r="6" fill="#0B0D12" stroke="#E5E7EB" strokeWidth="2" />
          <circle cx="32" cy="32" r="2" fill="#22C55E" />
        </symbol>

        {/* Social icons */}
        <symbol id="iX" viewBox="0 0 16 16"><path d="M11.5 1.5h2L9 7l5 7h-4L7 9.5 3.5 14h-2l5-6L1.5 1.5h4L8 5.5z" fill="#E5E7EB" /></symbol>
        <symbol id="iGh" viewBox="0 0 16 16"><path d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8c0 2.9 1.9 5.4 4.4 6.2.3.1.4-.1.4-.3v-1.2c-1.8.4-2.2-.8-2.2-.8-.3-.7-.7-.9-.7-.9-.6-.4 0-.4 0-.4.7 0 1 .7 1 .7.6 1 1.6.7 2 .5.1-.4.2-.7.4-.9-1.4-.2-2.9-.7-2.9-3.2 0-.7.3-1.3.7-1.8-.1-.2-.3-.9.1-1.9 0 0 .6-.2 1.8.7.5-.1 1.1-.2 1.6-.2s1.1.1 1.6.2c1.2-.8 1.8-.7 1.8-.7.4 1 .1 1.7.1 1.9.4.5.7 1.1.7 1.8 0 2.5-1.5 3.1-3 3.2.2.2.4.6.4 1.2v1.8c0 .2.1.4.4.3 2.5-.8 4.4-3.3 4.4-6.2 0-3.6-2.9-6.5-6.5-6.5z" fill="#E5E7EB" /></symbol>
        <symbol id="iDc" viewBox="0 0 16 16"><path d="M13.5 3.5c-1-.5-2-.8-3.1-.9l-.1.2c1 .3 1.9.7 2.7 1.4-1.6-.8-3.5-.8-5.1-.4-.5.1-1.1.3-1.7.5C5 4 4.3 4 3.6 4.3l-.1-.2c-1 .1-2.1.4-3 .9C-.4 7.5-.8 10.4.4 13c1.1.8 2.4 1.3 3.7 1.3l.6-.8c-.7-.3-1.3-.7-1.9-1.2.2.1.3.2.4.3 2.4 1.3 5.3 1.3 7.7 0 .1 0 .3-.1.4-.3-.6.5-1.3.9-2 1.2l.5.8c1.3-.1 2.6-.5 3.7-1.3 1.4-2.9.7-5.7-.5-9.5zM5.5 11C4.7 11 4 10.3 4 9.4s.7-1.6 1.5-1.6 1.5.7 1.5 1.6S6.3 11 5.5 11zm5 0c-.8 0-1.5-.7-1.5-1.6s.7-1.6 1.5-1.6 1.5.7 1.5 1.6S11.3 11 10.5 11z" fill="#E5E7EB" /></symbol>
      </defs>
    </svg>
  );
}
