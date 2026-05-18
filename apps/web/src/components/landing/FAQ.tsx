const faqs = [
  {
    q: "What is Velthoryn?",
    a: "Velthoryn is a Solana protocol for token vesting and large-scale token distribution. It uses Merkle compression to help projects distribute tokens to thousands of recipients with much lower cost and less on-chain state.",
  },
  {
    q: "Who controls the locked tokens?",
    a: "Nobody. Tokens sit in a PDA-controlled vault — a special Solana address with no private key. No human, not even the Velthoryn team, can access the vault. Only the on-chain program can release tokens, and only when the vesting schedule allows it.",
  },
  {
    q: "What vesting schedules are supported?",
    a: "Three types: cliff, linear, and milestone-based vesting. Schedules can be configured for a campaign and tailored to recipient allocations, so projects can handle team, investor, and community distributions in one system.",
  },
  {
    q: "What happens if a campaign is cancelled?",
    a: "Vesting freezes at that instant. Recipients keep everything already vested and have a 7-day grace window to claim it. After that window, the project can sweep the remaining unvested tokens back from the vault.",
  },
  {
    q: "Is the code open source?",
    a: "Yes. The codebase is open on GitHub, and independent security audits are planned before mainnet launch.",
  },
];

export function FAQ() {
  return (
    <section className="lp-sect" id="faq" style={{ paddingTop: 0, paddingBottom: 80 }}>
      <div className="lp-wrap">
        <h2 className="lp-sect-title lp-reveal">Questions, answered.</h2>
        <p className="lp-sect-sub">
          Everything you might want to know before getting on the waitlist.
        </p>

        <div className="lp-faq-grid lp-reveal">
          {faqs.map((f, i) => (
            <details className="lp-faq-item" key={i} open={i === 0}>
              <summary>
                <span className="lp-faq-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{f.q}</span>
                <span className="lp-faq-icon" />
              </summary>
              <div className="lp-faq-body">
                <p>{f.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
