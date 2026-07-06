"use client";

import React, { useState } from "react";

// Fan email capture on the public /listen pages → Brevo list. When a lead
// magnet is configured, the pitch names the reward.
export default function SubscribeForm({ magnetTitle }: { magnetTitle?: string | null }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  const [download, setDownload] = useState<{ url: string; title: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "busy") return;
    setState("busy");
    setErr("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name2: "" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body?.error || "Something went wrong — try again.");
        setState("idle");
      } else {
        if (body?.download) setDownload({ url: body.download, title: body.downloadTitle || "your free track" });
        setState("done");
      }
    } catch {
      setErr("Something went wrong — try again.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <div style={{ marginTop: 22 }}>
        <p className="rc-sub" style={{ fontSize: 13.5 }}>
          You&apos;re on the list — new music lands in your inbox first. 🎉
        </p>
        {download && (
          <a
            href={download.url}
            download
            style={{
              display: "inline-block",
              marginTop: 10,
              padding: "12px 18px",
              borderRadius: 12,
              background: "linear-gradient(135deg,var(--acc-a),var(--acc-b))",
              color: "#15101B",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            ⬇ Download {download.title}
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 22 }}>
      <p className="rc-sub" style={{ fontSize: 12.5, marginBottom: 8 }}>
        {magnetTitle ? <>Get <b>{magnetTitle}</b> — free for the mailing list</> : "Get new music first"}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        {/* honeypot — hidden from humans, irresistible to bots */}
        <input
          type="text"
          name="name2"
          tabIndex={-1}
          autoComplete="off"
          style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
          aria-hidden="true"
        />
        <input
          className="rc-input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={state === "busy"}
          style={{
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 700,
            fontSize: 13.5,
            cursor: "pointer",
            background: "linear-gradient(135deg,var(--acc-a),var(--acc-b))",
            color: "#15101B",
            fontFamily: "inherit",
          }}
        >
          {state === "busy" ? "…" : "Join"}
        </button>
      </div>
      {err && (
        <p className="rc-sub" style={{ color: "#FFC9D2", fontSize: 12, marginTop: 6 }}>{err}</p>
      )}
    </form>
  );
}
