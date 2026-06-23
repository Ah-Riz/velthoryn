import Image from "next/image";

const partners = [
  { name: "Solana", src: "/assets/partners/solana.png", boxed: false, width: 130, height: 56 },
  { name: "Superteam Indonesia", src: "/assets/partners/superteam.png", boxed: true, width: 56, height: 56 },
  { name: "Mancer", src: "/assets/partners/mancer.png", boxed: false, width: 202, height: 56 },
];

function PartnerItem({
  name,
  src,
  boxed,
  width,
  height,
  hidden,
}: {
  name: string;
  src: string;
  boxed: boolean;
  width: number;
  height: number;
  hidden?: boolean;
}) {
  return (
    <div
      className={`lp-partner-item${boxed ? " boxed" : ""}`}
      aria-label={hidden ? undefined : name}
      aria-hidden={hidden || undefined}
    >
      <Image
        src={src}
        alt={hidden ? "" : name}
        width={width}
        height={height}
      />
    </div>
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
