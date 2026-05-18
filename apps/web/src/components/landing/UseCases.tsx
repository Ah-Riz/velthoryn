const cases = [
  {
    color: "violet",
    tag: "TEAMS",
    title: "Token vesting for your team",
    desc: "Give founders and employees their tokens over time. If someone leaves early, you can adjust future allocations before they fully vest.",
    example: "4 years of monthly vesting after a 1-year cliff.",
  },
  {
    color: "teal",
    tag: "INVESTORS",
    title: "Investor unlocks on schedule",
    desc: "Give each investor the release schedule you agreed on. They claim on their own - no manual tracking, no spreadsheets.",
    example: "2 years of monthly vesting after a 3-month cliff.",
  },
  {
    color: "green",
    tag: "COMMUNITY",
    title: "Community distributions at scale",
    desc: "Send tokens to thousands of supporters in one campaign. If something needs to be corrected, you have a 7-day grace window to fix it.",
    example: "Launch today, correct allocations within 7 days.",
  },
];

export function UseCases() {
  return (
    <section className="lp-sect" style={{ paddingTop: 0 }}>
      <div className="lp-wrap">
        <h2 className="lp-sect-title lp-reveal">Who uses Velthoryn.</h2>
        <p className="lp-sect-sub">
          If you need to distribute tokens to real people, on a real schedule,
          this is for you.
        </p>

        <div className="lp-uc lp-reveal-stagger">
          {cases.map((c) => (
            <div className={`lp-uc-card ${c.color}`} key={c.tag}>
              <span className="tag">{c.tag}</span>
              <h4>{c.title}</h4>
              <p>{c.desc}</p>
              <div className="ex">
                <b>Example:</b> {c.example}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
