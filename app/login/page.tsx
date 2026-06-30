"use client";

import { useFormState, useFormStatus } from "react-dom";
import { sendMagicLink } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="rc-btn primary" type="submit" disabled={pending} style={{ width: "100%", marginTop: 16 }}>
      {pending ? "Sending…" : "Send magic link"}
    </button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState(sendMagicLink, null);

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
