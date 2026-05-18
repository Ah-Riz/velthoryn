import Image from "next/image";

const partners = [
  { name: "Solana", src: "/assets/partners/solana.png", boxed: false },
  { name: "Superteam Indonesia", src: "/assets/partners/superteam.png", boxed: true },
  { name: "Mancer", src: "/assets/partners/mancer.png", boxed: false },
];

function PartnerItem({ name, src, boxed, hidden }: { name: string; src: string; boxed: boolean; hidden?: boolean }) {
  return (
    <a
      className={`lp-partner-item${boxed ? " boxed" : ""}`}
      href="#"
      aria-label={hidden ? undefined : name}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
    >
      <Image src={src} alt={hidden ? "" : name} width={boxed ? 56 : 120} height={56} />
    </a>
  );
}

export function Partners() {
  const visible = [...partners, ...partners];
  const duplicate = [...partners, ...partners];

  return (
    <div className="lp-ticker">
      <div className="lp-partners-label">BUILT WITH</div>
      <div className="lp-partners-track">
        {visible.map((p, i) => (
          <PartnerItem key={`v-${i}`} {...p} />
        ))}
        {duplicate.map((p, i) => (
          <PartnerItem key={`d-${i}`} {...p} hidden />
        ))}
      </div>
    </div>
  );
}
