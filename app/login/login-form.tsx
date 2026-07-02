"use client";

import { useEffect } from "react";
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

export default function LoginForm() {
  const [state, formAction] = useFormState(sendMagicLink, null);

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
            required
          />
          <SubmitButton />
        </form>
        {state && (
          <div className={"rc-msg " + (state.ok ? "ok" : "err")}>{state.message}</div>
        )}
      </div>
    </div>
  );
}
