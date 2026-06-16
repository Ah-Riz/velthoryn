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
        <linearGradient id="curveFillCyan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14F1D9" stopOpacity="0.25" />
          <stop offset="1" stopColor="#14F1D9" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cancelFade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7C3AED" stopOpacity="0.6" />
          <stop offset="1" stopColor="#7C3AED" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="updateGlow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#14F1D9" stopOpacity="0.5" />
          <stop offset="1" stopColor="#22C55E" stopOpacity="0.9" />
        </linearGradient>

        {/* Glow filters */}
        <filter id="glowSm" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glowMd" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glowLine" x="-20%" y="-100%" width="140%" height="300%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>

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

        {/* Step diagrams — premium redesign */}

        {/* Step 1: Merkle Upload — 4 wallets → 2 hash nodes → 1 glowing Merkle root */}
        <symbol id="step1" viewBox="0 0 200 100">
          {/* Structural tree lines (dark base) */}
          <line x1="28" y1="18" x2="88" y2="34" stroke="#1A2640" strokeWidth="1" />
          <line x1="28" y1="37" x2="88" y2="34" stroke="#1A2640" strokeWidth="1" />
          <line x1="28" y1="63" x2="88" y2="67" stroke="#1A2640" strokeWidth="1" />
          <line x1="28" y1="82" x2="88" y2="67" stroke="#1A2640" strokeWidth="1" />
          <line x1="93" y1="34" x2="166" y2="50" stroke="#1A2640" strokeWidth="1" />
          <line x1="93" y1="67" x2="166" y2="50" stroke="#1A2640" strokeWidth="1" />

          {/* Animated flow — top pair → hash A */}
          <line x1="28" y1="18" x2="88" y2="34" stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="4 7" strokeLinecap="round" opacity="0.85">
            <animate attributeName="stroke-dashoffset" from="0" to="-11" dur="1.1s" repeatCount="indefinite" />
          </line>
          <line x1="28" y1="37" x2="88" y2="34" stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="4 7" strokeLinecap="round" opacity="0.5">
            <animate attributeName="stroke-dashoffset" from="-4" to="-15" dur="1.1s" repeatCount="indefinite" />
          </line>

          {/* Animated flow — bottom pair → hash B */}
          <line x1="28" y1="63" x2="88" y2="67" stroke="#14F1D9" strokeWidth="1.5" strokeDasharray="4 7" strokeLinecap="round" opacity="0.85">
            <animate attributeName="stroke-dashoffset" from="0" to="-11" dur="1.3s" repeatCount="indefinite" />
          </line>
          <line x1="28" y1="82" x2="88" y2="67" stroke="#14F1D9" strokeWidth="1.5" strokeDasharray="4 7" strokeLinecap="round" opacity="0.5">
            <animate attributeName="stroke-dashoffset" from="-4" to="-15" dur="1.3s" repeatCount="indefinite" />
          </line>

          {/* Animated flow — hash nodes → Merkle root */}
          <line x1="93" y1="34" x2="166" y2="50" stroke="url(#threadA)" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round">
            <animate attributeName="stroke-dashoffset" from="0" to="-9" dur="0.75s" repeatCount="indefinite" />
          </line>
          <line x1="93" y1="67" x2="166" y2="50" stroke="url(#threadA)" strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round">
            <animate attributeName="stroke-dashoffset" from="-3" to="-12" dur="0.75s" repeatCount="indefinite" />
          </line>

          {/* Wallet nodes — left column */}
          <rect x="13" y="11" width="14" height="12" rx="2.5" fill="#0B0F1C" stroke="#263352" strokeWidth="1" />
          <circle cx="17.5" cy="17" r="1.8" fill="#7C3AED" opacity="0.9" />
          <rect x="13" y="30" width="14" height="12" rx="2.5" fill="#0B0F1C" stroke="#1E2B45" strokeWidth="1" />
          <circle cx="17.5" cy="36" r="1.8" fill="#7C3AED" opacity="0.5" />
          <rect x="13" y="56" width="14" height="12" rx="2.5" fill="#0B0F1C" stroke="#1A3045" strokeWidth="1" />
          <circle cx="17.5" cy="62" r="1.8" fill="#14F1D9" opacity="0.9" />
          <rect x="13" y="75" width="14" height="12" rx="2.5" fill="#0B0F1C" stroke="#1A3045" strokeWidth="1" />
          <circle cx="17.5" cy="81" r="1.8" fill="#14F1D9" opacity="0.5" />

          {/* Hash intermediate nodes */}
          <circle cx="88" cy="34" r="6" fill="#0B0F1C" stroke="#7C3AED" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="88" cy="34" r="2.5" fill="#7C3AED" />
          <circle cx="88" cy="67" r="6" fill="#0B0F1C" stroke="#14F1D9" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="88" cy="67" r="2.5" fill="#14F1D9" />

          {/* Merkle root glow halo */}
          <circle cx="166" cy="50" r="18" fill="#14F1D9" opacity="0.04" />
          <circle cx="166" cy="50" r="12" fill="#14F1D9" opacity="0.06" />

          {/* Merkle root — glowing diamond */}
          <g transform="translate(166,50) rotate(45)" filter="url(#glowSm)">
            <rect x="-9" y="-9" width="18" height="18" rx="2.5" fill="#0B0F1C" stroke="#14F1D9" strokeWidth="2" />
          </g>
          <circle cx="166" cy="50" r="3.5" fill="#22C55E" filter="url(#glowSm)" />
          <circle cx="166" cy="50" r="1.5" fill="white" opacity="0.85" />
        </symbol>

        {/* Step 2: Vesting Schedule — cliff flat then smooth linear unlock curve */}
        <symbol id="step2" viewBox="0 0 200 100">
          {/* Subtle background grid */}
          <line x1="22" y1="28" x2="192" y2="28" stroke="#0F1828" strokeWidth="0.8" />
          <line x1="22" y1="46" x2="192" y2="46" stroke="#0F1828" strokeWidth="0.8" />
          <line x1="22" y1="64" x2="192" y2="64" stroke="#0F1828" strokeWidth="0.8" />
          <line x1="75" y1="9" x2="75" y2="86" stroke="#0F1828" strokeWidth="0.6" strokeDasharray="2 4" />

          {/* Gradient area fill under the vesting curve */}
          <path d="M 22 82 L 73 82 L 73 54 L 105 44 L 135 33 L 165 23 L 192 17 L 192 82 Z" fill="url(#curveFill)" opacity="0.55" />

          {/* Axes */}
          <line x1="22" y1="82" x2="192" y2="82" stroke="#1F2D45" strokeWidth="1" />
          <line x1="22" y1="9" x2="22" y2="82" stroke="#1F2D45" strokeWidth="1" />

          {/* Cliff flat section */}
          <line x1="22" y1="82" x2="73" y2="82" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" filter="url(#glowLine)" />

          {/* Cliff vertical step */}
          <line x1="73" y1="82" x2="73" y2="54" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" filter="url(#glowLine)" />

          {/* Linear unlock curve */}
          <path d="M 73 54 C 89 48, 118 38, 135 33 C 152 28, 172 21, 192 17" stroke="#7C3AED" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#glowLine)" />

          {/* Cliff bracket */}
          <line x1="22" y1="90" x2="73" y2="90" stroke="#2D3D5A" strokeWidth="0.8" strokeLinecap="round" />
          <line x1="22" y1="87" x2="22" y2="93" stroke="#2D3D5A" strokeWidth="0.8" />
          <line x1="73" y1="87" x2="73" y2="93" stroke="#2D3D5A" strokeWidth="0.8" />

          {/* X-axis tick marks */}
          <line x1="105" y1="82" x2="105" y2="86" stroke="#263352" strokeWidth="0.8" />
          <line x1="135" y1="82" x2="135" y2="86" stroke="#263352" strokeWidth="0.8" />
          <line x1="165" y1="82" x2="165" y2="86" stroke="#263352" strokeWidth="0.8" />
          <line x1="192" y1="82" x2="192" y2="86" stroke="#263352" strokeWidth="0.8" />

          {/* Milestone dots */}
          <circle cx="73" cy="54" r="4.5" fill="#0B0F1C" stroke="#7C3AED" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="73" cy="54" r="2" fill="#7C3AED" />
          <circle cx="105" cy="44" r="3.5" fill="#0B0F1C" stroke="#14F1D9" strokeWidth="1.5" />
          <circle cx="105" cy="44" r="1.5" fill="#14F1D9" />
          <circle cx="135" cy="33" r="3.5" fill="#0B0F1C" stroke="#14F1D9" strokeWidth="1.5" />
          <circle cx="135" cy="33" r="1.5" fill="#14F1D9" />
          <circle cx="192" cy="17" r="5" fill="#0B0F1C" stroke="#22C55E" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="192" cy="17" r="2.5" fill="#22C55E" />
          <circle cx="192" cy="17" r="1" fill="white" opacity="0.8" />
        </symbol>

        {/* Step 3: Recipients Claim — vault releases tokens along diverging paths to wallets */}
        <symbol id="step3" viewBox="0 0 200 100">
          {/* Diverging path lines (structural) */}
          <path d="M 52 50 C 80 50, 100 22, 160 22" stroke="#1A2640" strokeWidth="1" fill="none" />
          <path d="M 52 50 C 80 50, 100 50, 160 50" stroke="#1A2640" strokeWidth="1" fill="none" />
          <path d="M 52 50 C 80 50, 100 78, 160 78" stroke="#1A2640" strokeWidth="1" fill="none" />

          {/* Animated flowing dashes — top path */}
          <path d="M 52 50 C 80 50, 100 22, 160 22" stroke="#7C3AED" strokeWidth="1.5" fill="none" strokeDasharray="5 8" strokeLinecap="round" opacity="0.8">
            <animate attributeName="stroke-dashoffset" from="0" to="-13" dur="1.4s" repeatCount="indefinite" />
          </path>
          {/* Middle path */}
          <path d="M 52 50 C 80 50, 100 50, 160 50" stroke="url(#threadA)" strokeWidth="1.5" fill="none" strokeDasharray="5 7" strokeLinecap="round">
            <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1.1s" repeatCount="indefinite" />
          </path>
          {/* Bottom path */}
          <path d="M 52 50 C 80 50, 100 78, 160 78" stroke="#14F1D9" strokeWidth="1.5" fill="none" strokeDasharray="5 8" strokeLinecap="round" opacity="0.8">
            <animate attributeName="stroke-dashoffset" from="-5" to="-18" dur="1.6s" repeatCount="indefinite" />
          </path>

          {/* Vault / lock — left side */}
          <rect x="22" y="36" width="24" height="22" rx="4" fill="#0B0F1C" stroke="#7C3AED" strokeWidth="1.5" filter="url(#glowSm)" />
          <path d="M 28 36 C 28 28, 40 28, 40 36" stroke="#7C3AED" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <circle cx="34" cy="46" r="3.5" fill="#7C3AED" opacity="0.3" />
          <circle cx="34" cy="46" r="2" fill="#7C3AED" opacity="0.8" />
          <line cx="34" cy="46" x1="34" y1="47" x2="34" y2="52" stroke="#7C3AED" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />

          {/* Recipient wallet nodes — right side */}
          <rect x="160" y="15" width="16" height="13" rx="2.5" fill="#0B0F1C" stroke="#22C55E" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="164" cy="21.5" r="2" fill="#22C55E" opacity="0.7" />
          <rect x="160" y="43" width="16" height="13" rx="2.5" fill="#0B0F1C" stroke="#22C55E" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="164" cy="49.5" r="2" fill="#22C55E" opacity="0.7" />
          <rect x="160" y="71" width="16" height="13" rx="2.5" fill="#0B0F1C" stroke="#22C55E" strokeWidth="1.5" filter="url(#glowSm)" />
          <circle cx="164" cy="77.5" r="2" fill="#22C55E" opacity="0.7" />

          {/* Particle dots at path midpoints */}
          <circle cx="102" cy="34" r="2.5" fill="#14F1D9" opacity="0.9" filter="url(#glowSm)">
            <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="106" cy="50" r="2.5" fill="#22C55E" opacity="0.9" filter="url(#glowSm)">
            <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.8s" repeatCount="indefinite" begin="0.4s" />
          </circle>
          <circle cx="102" cy="66" r="2.5" fill="#7C3AED" opacity="0.9" filter="url(#glowSm)">
            <animate attributeName="opacity" values="0.9;0.3;0.9" dur="2s" repeatCount="indefinite" begin="0.8s" />
          </circle>
        </symbol>

        {/* Step 4: Update/Cancel — root evolves one branch, gracefully cancels another */}
        <symbol id="step4" viewBox="0 0 200 100">
          {/* Left input to root */}
          <line x1="22" y1="50" x2="88" y2="50" stroke="#1A2640" strokeWidth="1" />
          <line x1="22" y1="50" x2="88" y2="50" stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="4 6" strokeLinecap="round" opacity="0.6">
            <animate attributeName="stroke-dashoffset" from="0" to="-10" dur="1.2s" repeatCount="indefinite" />
          </line>

          {/* Root to update branch (top — bright, glowing) */}
          <line x1="96" y1="50" x2="172" y2="26" stroke="#1A2640" strokeWidth="1" />
          <line x1="96" y1="50" x2="172" y2="26" stroke="url(#updateGlow)" strokeWidth="2" strokeLinecap="round" filter="url(#glowLine)">
            <animate attributeName="stroke-dashoffset" from="0" to="-10" dur="0.9s" repeatCount="indefinite" />
          </line>

          {/* Root to cancel branch (bottom — dashed, fading) */}
          <line x1="96" y1="50" x2="172" y2="74" stroke="#334155" strokeWidth="1" strokeDasharray="3 5" strokeLinecap="round" opacity="0.5" />
          <line x1="96" y1="50" x2="172" y2="74" stroke="url(#cancelFade)" strokeWidth="1.5" strokeDasharray="3 6" strokeLinecap="round" opacity="0.45">
            <animate attributeName="opacity" values="0.45;0.15;0.45" dur="2.5s" repeatCount="indefinite" />
          </line>

          {/* Input node (left) */}
          <circle cx="22" cy="50" r="5" fill="#0B0F1C" stroke="#334155" strokeWidth="1.5" />
          <circle cx="22" cy="50" r="2" fill="#475569" />

          {/* Merkle root — center diamond */}
          <g transform="translate(92,50) rotate(45)" filter="url(#glowSm)">
            <rect x="-8" y="-8" width="16" height="16" rx="2" fill="#0B0F1C" stroke="#7C3AED" strokeWidth="1.5" />
          </g>
          <circle cx="92" cy="50" r="2.5" fill="#7C3AED" filter="url(#glowSm)" />

          {/* Updated node (top-right — bright, new root) */}
          <circle cx="172" cy="26" r="14" fill="#22C55E" opacity="0.04" />
          <circle cx="172" cy="26" r="9" fill="#22C55E" opacity="0.07" />
          <g transform="translate(172,26) rotate(45)" filter="url(#glowSm)">
            <rect x="-7.5" y="-7.5" width="15" height="15" rx="2" fill="#0B0F1C" stroke="#22C55E" strokeWidth="1.5" />
          </g>
          <circle cx="172" cy="26" r="3" fill="#22C55E" filter="url(#glowSm)" />
          <circle cx="172" cy="26" r="1.2" fill="white" opacity="0.85" />

          {/* Cancelled node (bottom-right — faded) */}
          <circle cx="172" cy="74" r="7" fill="#0B0F1C" stroke="#334155" strokeWidth="1" opacity="0.5" />
          {/* X mark inside cancelled node */}
          <line x1="168.5" y1="70.5" x2="175.5" y2="77.5" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
          <line x1="175.5" y1="70.5" x2="168.5" y2="77.5" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />

          {/* Fading halo on cancelled node */}
          <circle cx="172" cy="74" r="12" fill="#7C3AED" opacity="0.03">
            <animate attributeName="opacity" values="0.03;0.00;0.03" dur="2.5s" repeatCount="indefinite" />
          </circle>
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
