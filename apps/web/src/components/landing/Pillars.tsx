const pillars = [
  {
    glyph: "gMerkle",
    title: "Merkle compression",
    desc: "Distribute to 10,000 wallets with one 32-byte root. Recipients submit proofs, the program verifies on-chain. State stays small and distribution cost stays dramatically lower.",
    specs: ["32-byte root", "~4,700x cost reduction", "No per-recipient stream account"],
  },
  {
    glyph: "gVesting",
    title: "Vesting schedules",
    desc: "Cliff, linear, and milestone schedules — per recipient, per campaign. The program enforces the curve on-chain, so nobody can claim past the line.",
    specs: ["Cliff", "Linear", "Milestone"],
  },
  {
    glyph: "gClawback",
    title: "Per-recipient clawback",
    desc: "Rotate the Merkle root to remove or replace any allocation. If a campaign is cancelled, recipients keep what was already vested and get a 7-day grace window to claim before unvested funds are swept.",
    specs: ["Root rotation", "7-day grace", "Audit trail"],
  },
];

export function Pillars() {
  return (
    <section className="lp-sect" id="product">
      <div className="lp-wrap">
        <h2 className="lp-sect-title lp-reveal">
          Everything a token campaign needs.
          <br />
          <em>Nothing it doesn&apos;t.</em>
        </h2>
        <p className="lp-sect-sub">
          Merkle compression, vesting schedules, and per-recipient clawback — all composed into a single on-chain program.
        </p>

        <div className="lp-pillars lp-reveal-stagger">
          {pillars.map((p) => (
            <div className="lp-pillar" key={p.glyph}>
              <div className="glyph">
                <svg viewBox="0 0 64 64" style={{ width: 42, height: 42 }}>
                  <use href={`#${p.glyph}`} />
                </svg>
              </div>
              <h3>{p.title}</h3>
              <p>{p.desc}</p>
              <div className="specs">
                {p.specs.map((s) => (
                  <span className="spec" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
