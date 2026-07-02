"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { sendMagicLink } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="rc-btn primary" type="submit" disabled={pending} style={{ width: "100%", marginTop: 16 }}>
      {pending ? "Sending…" : "Send magic link"}
    </button>
  );
}

export default function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction] = useFormState(sendMagicLink, null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");

  // Returning-user restore: the server can't refresh an expired access token
  // (no middleware), so a valid refresh token can still land here. The browser
  // client CAN refresh — if it finds a live session, bounce straight home.
  // This keeps the installed PWA signed in across days, not just an hour.
  useEffect(() => {
    const supabase = createSupabaseBrowser();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/");
    });
  }, []);

  // The code path exists for the installed PWA: iOS opens email links in the
  // browser, whose cookies are separate from the home-screen app's, so a
  // tapped link can never sign the PWA in. Typing the emailed 6-digit code
  // verifies directly in this context instead.
  const verifyCode = async () => {
    const token = code.trim();
    if (!email.trim() || token.length < 6 || verifying) return;
    setVerifying(true);
    setVerifyErr("");
    const supabase = createSupabaseBrowser();
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: "email",
    });
    if (error) {
      setVerifyErr(
        /expired|invalid/i.test(error.message)
          ? "That code didn't work — it may have expired. Send a fresh one and use the newest email."
          : error.message
      );
      setVerifying(false);
      return;
    }
    window.location.replace("/");
  };

  return (
    <div className="rc-login">
      <div className="rc-card-login">
        <h1 className="rc-h1">Recirculate</h1>
        <p className="rc-sub">Sign in to get your clips back in rotation.</p>
        <form action={formAction}>
          <label className="rc-label" htmlFor="email">Email</label>
          <input
            className="rc-input"
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <SubmitButton />
        </form>

        {state?.ok && (
          <>
            <label className="rc-label" htmlFor="otp" style={{ marginTop: 18 }}>
              Or enter the 6-digit code from the email
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="rc-input"
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                style={{ flex: 1, letterSpacing: "0.2em", fontFamily: "'Space Grotesk'", fontSize: 16 }}
              />
              <button
                type="button"
                className="rc-btn primary"
                onClick={verifyCode}
                disabled={verifying || code.trim().length < 6}
                style={{ flex: "0 0 auto", minWidth: 0 }}
              >
                {verifying ? "Checking…" : "Verify"}
              </button>
            </div>
            <p className="rc-note">
              On your phone&apos;s home-screen app, use the code — tapping the link opens the browser instead of the app.
            </p>
          </>
        )}

        {verifyErr && <div className="rc-msg err">{verifyErr}</div>}
        {state && <div className={"rc-msg " + (state.ok ? "ok" : "err")}>{state.message}</div>}
        {!state && initialError && <div className="rc-msg err">{initialError}</div>}
      </div>
    </div>
  );
}
