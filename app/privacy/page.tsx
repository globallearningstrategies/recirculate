// Public page (no auth gate) — required by platform developer portals.
export const metadata = { title: "Privacy Policy — Recirculate", robots: { index: false } };

export default function PrivacyPage() {
  return (
    <div className="rc-login" style={{ alignItems: "flex-start", paddingTop: 48 }}>
      <div className="rc-card-login" style={{ maxWidth: 640 }}>
        <h1 className="rc-h1" style={{ fontSize: 24 }}>Privacy Policy</h1>
        <p className="rc-sub">Recirculate — last updated July 2026</p>
        <div className="rc-cap" style={{ marginTop: 16, display: "grid", gap: 12 }}>
          <p>
            Recirculate is a personal, single-user application operated by its owner to manage and
            repost the owner&apos;s own short-form videos to the owner&apos;s own social media accounts
            (YouTube, Instagram, TikTok). It is not offered as a service to the public and has no
            users other than its owner.
          </p>
          <p>
            <strong>What it stores:</strong> the owner&apos;s own video clips, captions, posting
            history, and the OAuth access tokens the owner grants for their own social accounts.
            Data is stored with Supabase (database and file storage) and the app is hosted on
            Vercel.
          </p>
          <p>
            <strong>How platform data is used:</strong> tokens obtained from YouTube, Instagram, or
            TikTok are used solely to list and publish the owner&apos;s own content at the
            owner&apos;s explicit request. No data about any other person is collected, and no data
            is sold, shared, or used for advertising or analytics.
          </p>
          <p>
            <strong>Revoking access:</strong> access can be revoked at any time from the connected
            platform&apos;s security settings (e.g. TikTok &gt; Settings &gt; Security &gt; Apps and
            websites), which immediately invalidates the stored tokens.
          </p>
          <p>
            <strong>Contact:</strong> jordansoul@gmail.com
          </p>
        </div>
      </div>
    </div>
  );
}
