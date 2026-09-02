"use client";

import { useState, type FormEvent } from "react";

export type Credentials = { email: string; password: string };

export type LoginScreenProps = {
  onSubmit: (credentials: Credentials) => void | Promise<void>;
  /** Disables the form while the request is in flight. */
  busy?: boolean;
  /** Server-supplied failure text. Deliberately not made more specific by this component. */
  error?: string;
  /** Contextual message above the form — an ended session, a completed sign-out. */
  notice?: string;
  /** False when the deployment authenticates through SSO and the form should not be offered at all. */
  passwordLoginEnabled?: boolean;
  brandLines?: string[];
};

/**
 * The sign-in screen, and the only thing an unauthenticated visitor can reach.
 *
 * There is no role selector: which portal a person lands in is a property of their account, not a choice
 * made at the door. Signing in as a requester opens the request workspace; signing in as an approver opens
 * the review queue. Offering the role as an input would make the most important access decision in the
 * application into something the client asserts.
 *
 * The two panels below the form describe those portals so people know which account they need, not so they
 * can pick one.
 *
 * ```tsx
 * <LoginScreen onSubmit={signIn} busy={busy} error={error} notice={notice} />
 * ```
 */
export function LoginScreen({
  onSubmit,
  busy = false,
  error = "",
  notice = "",
  passwordLoginEnabled = true,
  brandLines = ["WOODCRAFT", "RANGERS"],
}: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !email || !password) return;
    void onSubmit({ email: email.trim(), password });
  };

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">
          <span className="loginMark">PRF</span>
          <div>
            {brandLines.map(word => (
              <strong key={word}>{word}</strong>
            ))}
            <small>Purchase Request Hub</small>
          </div>
        </div>

        <h1>Sign in</h1>
        <p className="loginLead">Use your Woodcraft Rangers account to create, review, and track purchase requests.</p>

        {notice && (
          <p className="loginNotice" role="status">
            {notice}
          </p>
        )}

        {passwordLoginEnabled ? (
          <form onSubmit={submit} noValidate>
            {/* aria-live so a screen reader announces a failed attempt without the focus moving. */}
            {error && (
              <p className="loginError" role="alert">
                {error}
              </p>
            )}
            <label>
              <span>Work email</span>
              <input
                type="email"
                name="email"
                autoComplete="username"
                autoFocus
                required
                disabled={busy}
                value={email}
                onChange={event => setEmail(event.target.value)}
                placeholder="you@woodcraftrangers.org"
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                disabled={busy}
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" className="loginSubmit" disabled={busy || !email || !password}>
              {busy ? "Signing in…" : "Sign in →"}
            </button>
          </form>
        ) : (
          <p className="loginSso">
            This deployment signs in through your organisation&rsquo;s single sign-on. Open the Hub from your
            staff portal and you will arrive already authenticated.
          </p>
        )}

        <div className="loginPortals">
          <div>
            <small>REQUESTER</small>
            <strong>Create and track requests</strong>
            <span>Start a PRF, save drafts, sign and submit, and follow your own requests through approval.</span>
          </div>
          <div>
            <small>APPROVER / FINANCE</small>
            <strong>Review, approve, and report</strong>
            <span>Work the review queue, approve or send back with a comment, and export the register.</span>
          </div>
        </div>

        <p className="loginFoot">
          Sessions end after an hour of inactivity. Purchase records are confidential — sign out when you are
          finished on a shared computer.
        </p>
      </section>
    </main>
  );
}
