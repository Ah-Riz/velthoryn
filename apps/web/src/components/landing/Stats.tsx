"use client";

import { useEffect, useRef } from "react";

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

function fmt(n: number, decimals: number, comma: boolean) {
  const fixed = n.toFixed(decimals);
  if (!comma) return fixed;
  const [int, dec] = fixed.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec ? withCommas + "." + dec : withCommas;
}

function Counter({
  target,
  prefix = "",
  decimals = 0,
  comma = false,
}: {
  target: number;
  prefix?: string;
  decimals?: number;
  comma?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const animated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !animated.current) {
            animated.current = true;
            const duration = 1800;
            const start = performance.now();
            function tick(now: number) {
              const t = Math.min(1, (now - start) / duration);
              const val = target * easeOutExpo(t);
              el!.textContent = prefix + fmt(val, decimals, comma);
              if (t < 1) requestAnimationFrame(tick);
              else el!.textContent = prefix + fmt(target, decimals, comma);
            }
            requestAnimationFrame(tick);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target, prefix, decimals, comma]);

  return (
    <span ref={ref}>
      {prefix}{fmt(target, decimals, comma)}
    </span>
  );
}

const statItems = [
  { label: "TOTAL VALUE DISTRIBUTED", target: 0, prefix: "$", decimals: 0, smallSuffix: undefined },
  { label: "ACTIVE CAMPAIGNS", target: 0, decimals: 0, comma: true, smallSuffix: undefined },
  { label: "RECIPIENTS SERVED", target: 0, decimals: 0, comma: true, smallSuffix: undefined },
  { label: "DISTRIBUTION COST SAVED", target: 0, decimals: 0, smallSuffix: "%" },
];

export function Stats() {
  return (
    <section className="lp-sect" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <div className="lp-stats-banner lp-reveal-stagger">
          {statItems.map((s) => (
            <div className="lp-stat" key={s.label}>
              <div className="l">{s.label}</div>
              <div className="v">
                <Counter
                  target={s.target}
                  prefix={s.prefix}
                  decimals={s.decimals}
                  comma={s.comma}
                />
                {s.smallSuffix && <small>{s.smallSuffix}</small>}
              </div>
              <div className="delta">— launching soon</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
