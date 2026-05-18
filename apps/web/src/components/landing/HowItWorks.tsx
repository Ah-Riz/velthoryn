const steps = [
  {
    num: "STEP 01",
    title: "Upload recipient list",
    desc: "Import wallet addresses and token amounts from a CSV. Velthoryn compresses them into one on-chain root.",
    diagram: "step1",
  },
  {
    num: "STEP 02",
    title: "Set unlock schedule",
    desc: "Choose cliff, linear, or milestone vesting for the whole campaign or for each recipient.",
    diagram: "step2",
  },
  {
    num: "STEP 03",
    title: "Recipients claim",
    desc: "When tokens unlock, recipients connect their wallet and claim only what is already vested.",
    diagram: "step3",
  },
  {
    num: "STEP 04",
    title: "Update or cancel",
    desc: "Need to fix an allocation or revoke future tokens? Update the root, or cancel the campaign with a 7-day grace window.",
    diagram: "step4",
  },
];

export function HowItWorks() {
  return (
    <section className="lp-sect" id="how" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <h2 className="lp-sect-title lp-reveal">
          Four moves.
          <br />
          <em>From CSV to claim.</em>
        </h2>
        <p className="lp-sect-sub">
          Upload recipients, choose how tokens unlock, and let each wallet
          claim on schedule.
        </p>

        <div className="lp-steps lp-reveal-stagger">
          {steps.map((s) => (
            <div className="lp-step" key={s.diagram}>
              <span className="num">{s.num}</span>
              <h4>{s.title}</h4>
              <p>{s.desc}</p>
              <div className="diag">
                <svg viewBox="0 0 200 100">
                  <use href={`#${s.diagram}`} />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
