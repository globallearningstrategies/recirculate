// Public page (no auth gate) — required by platform developer portals.
export const metadata = { title: "Terms of Service — Recirculate", robots: { index: false } };

export default function TermsPage() {
  return (
    <div className="rc-login" style={{ alignItems: "flex-start", paddingTop: 48 }}>
      <div className="rc-card-login" style={{ maxWidth: 640 }}>
        <h1 className="rc-h1" style={{ fontSize: 24 }}>Terms of Service</h1>
        <p className="rc-sub">Recirculate — last updated July 2026</p>
        <div className="rc-cap" style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <p>
            Recirculate is personal software operated by its owner for the owner&apos;s exclusive
            use: managing a private library of the owner&apos;s own short-form videos and reposting
            them to the owner&apos;s own social media accounts. It is not offered to, and may not be
            used by, anyone other than its owner.
          </p>
          <p>
            All content handled by the app belongs to the owner. Publishing actions are initiated
            by the owner and are subject to the terms of the destination platform (YouTube,
            Instagram, or TikTok).
          </p>
          <p>
            The software is provided as-is, without warranty of any kind. Access may be changed or
            discontinued at any time.
          </p>
          <p>
            <strong>Contact:</strong> jordansoul@gmail.com
          </p>
        </div>
      </div>
    </div>
  );
}
