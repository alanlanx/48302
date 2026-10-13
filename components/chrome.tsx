import Link from "next/link";

export function Lights() {
  return (
    <div className="bulbs" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} />
      ))}
    </div>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <div className="seal" aria-hidden="true">
        建中
      </div>
      <div>
        <p className="eyebrow">臺北市立建國高級中學 · 第48屆高三2班</p>
        {compact ? (
          <Link href="/" style={{ textDecoration: "none" }}>
            <h1 className="wordmark" style={{ fontSize: "2.6rem" }}>
              48302
            </h1>
          </Link>
        ) : (
          <h1 className="wordmark">48302</h1>
        )}
        <p className="tagline">要運動歐同學會問答</p>
      </div>
    </div>
  );
}
