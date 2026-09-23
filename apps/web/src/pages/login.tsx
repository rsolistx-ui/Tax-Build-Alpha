import type { FormEvent } from "react";
import { BrandMark } from "@/components/brand-mark";
import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { setAdminToken, getAdminToken, apiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Monitor,
  ArrowRight,
  ShieldCheck,
  KeyRound,
  ChevronDown,
  ChevronUp,
  Lock,
  Loader2,
} from "lucide-react";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const [loginMode, setLoginMode] = useState<"password" | "fast_pass">("password");

  // Password Login State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [masterToken, setMasterToken] = useState(getAdminToken() || "");
  const [showSuperuserField, setShowSuperuserField] = useState(Boolean(getAdminToken()));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [codeStep, setCodeStep] = useState(false);
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);

  // Turnstile State
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // Fast-Pass State
  const [fastPassCode, setFastPassCode] = useState("");
  const [fastPassLoading, setFastPassLoading] = useState(false);
  const [fastPassError, setFastPassError] = useState<string | null>(null);

  // Check Turnstile configuration on mount
  useEffect(() => {
    let isMounted = true;
    async function checkTurnstile() {
      try {
        const res = await fetch(apiUrl("/api/auth/turnstile/config"));
        if (!res.ok) return;
        const data = (await res.json()) as { enabled: boolean; siteKey: string | null };
        if (isMounted && data.enabled && data.siteKey) {
          setTurnstileEnabled(true);
          loadTurnstileScript(data.siteKey);
        }
      } catch {
        // Turnstile unconfigured or offline; graceful fallback
      }
    }
    void checkTurnstile();
    return () => {
      isMounted = false;
      if (turnstileWidgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(turnstileWidgetId.current);
        } catch {
          // ignore cleanup error
        }
      }
    };
  }, []);

  function loadTurnstileScript(siteKey: string) {
    if (document.getElementById("cf-turnstile-script")) {
      renderTurnstileWidget(siteKey);
      return;
    }
    const script = document.createElement("script");
    script.id = "cf-turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      renderTurnstileWidget(siteKey);
    };
    document.head.appendChild(script);
  }

  function renderTurnstileWidget(siteKey: string) {
    const container = document.getElementById("turnstile-box");
    if (!container || !window.turnstile) return;
    try {
      if (turnstileWidgetId.current) {
        window.turnstile.remove(turnstileWidgetId.current);
      }
      turnstileWidgetId.current = window.turnstile.render("#turnstile-box", {
        sitekey: siteKey,
        theme: "auto",
        callback: (token: string) => {
          setTurnstileToken(token);
          setError(null);
        },
        "expired-callback": () => {
          setTurnstileToken(null);
        },
        "error-callback": () => {
          setTurnstileToken(null);
        },
      });
    } catch {
      // ignore re-render errors
    }
  }

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 1. Cloudflare Turnstile: the server checks this single-use token on the sign-in request.
    if (turnstileEnabled && !turnstileToken) {
      setLoading(false);
      setError("Please complete the Cloudflare security check before signing in.");
      return;
    }

    // 2. Validate Superuser 64-hex Token if provided
    const trimmedToken = masterToken.trim();
    if (trimmedToken) {
      if (trimmedToken.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmedToken)) {
        setLoading(false);
        setError("Master security token must be exactly 64 hexadecimal characters.");
        return;
      }
    }

    // 3. Authenticate User Credentials
    const { data, error: err } = await authClient.signIn.email(
      { email, password },
      turnstileToken ? { headers: { "x-captcha-response": turnstileToken } } : undefined,
    );
    setLoading(false);

    if (err) {
      // The token was spent on this attempt; a retry needs a fresh check.
      if (turnstileWidgetId.current && window.turnstile) window.turnstile.reset(turnstileWidgetId.current);
      setTurnstileToken(null);
      setError(err.message || "Sign in failed. Check your email and password.");
      return;
    }

    // Accounts with two-step sign-in finish with a code from their authenticator app.
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      if (trimmedToken) setAdminToken(trimmedToken);
      setCodeStep(true);
      return;
    }

    // A master token is an additional owner-console factor only. It cannot
    // create a browser session or recover a forgotten password by itself.
    if (trimmedToken) setAdminToken(trimmedToken);

    navigate("/");
  }

  async function onCodeSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const value = code.trim();
    const { error: err } = useBackupCode
      ? await authClient.twoFactor.verifyBackupCode({ code: value })
      : await authClient.twoFactor.verifyTotp({ code: value.replace(/\s/g, "") });
    setLoading(false);
    if (err) {
      setError(err.message || "That code did not work. Try the newest code in your app.");
      return;
    }
    navigate("/");
  }

  async function onFastPassSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fastPassCode.trim()) return;
    setFastPassLoading(true);
    setFastPassError(null);

    try {
      const res = await fetch("/api/beta/fast-pass/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: fastPassCode.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Invalid or expired Fast-Pass code.");
      }

      window.location.href = "/";
    } catch (err: any) {
      setFastPassError(err?.message || "Failed to link workstation.");
    } finally {
      setFastPassLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto mb-3 h-12 w-12" />
          <h1 className="text-2xl font-semibold tracking-tight">Truepost</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Sign in to your firm workspace
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-[var(--color-primary)]" /> Sign In
              </CardTitle>
              {/* Mode Toggle */}
              <div className="flex rounded-lg border border-[var(--color-border)] p-0.5 text-xs bg-[var(--color-muted)]">
                <button
                  type="button"
                  onClick={() => setLoginMode("password")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                    loginMode === "password"
                      ? "bg-[var(--color-card)] text-[var(--color-foreground)] shadow-xs"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  Password
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMode("fast_pass")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                    loginMode === "fast_pass"
                      ? "bg-[var(--color-card)] text-[var(--color-primary)] shadow-xs font-semibold"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  ⚡ Fast-Pass
                </button>
              </div>
            </div>
            <CardDescription className="text-xs">
              {loginMode === "password"
                ? "Enter your firm email and password. Owners may add their console token after signing in."
                : "Enter the 6-digit Fast-Pass pairing code generated on your invite or primary PC."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {codeStep ? (
              <form className="space-y-4" onSubmit={onCodeSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-code" className="text-xs font-medium">
                    {useBackupCode ? "Backup code" : "6-digit code from your authenticator app"}
                  </Label>
                  <Input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} inputMode={useBackupCode ? "text" : "numeric"} autoComplete="one-time-code" autoFocus required />
                </div>
                {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
                <Button type="submit" className="w-full" disabled={loading || !code.trim()}>{loading ? "Checking…" : "Verify"}</Button>
                <button type="button" className="w-full text-center text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]" onClick={() => { setUseBackupCode((v) => !v); setCode(""); setError(null); }}>
                  {useBackupCode ? "Use authenticator app code" : "Use a backup code instead"}
                </button>
              </form>
            ) : loginMode === "password" ? (
              <form className="space-y-4" onSubmit={onPasswordSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs font-medium">
                    Firm Email / Username
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="text-xs"
                    placeholder="name@firm.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs font-medium">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="text-xs"
                    placeholder="••••••••••••"
                  />
                </div>

                {/* Optional Superuser 64-Hex Master Token Accordion */}
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-2.5">
                  <button
                    type="button"
                    onClick={() => setShowSuperuserField(!showSuperuserField)}
                    className="flex w-full items-center justify-between text-left text-xs font-medium text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  >
                    <span className="flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      <span>Owner Console Token (64 characters)</span>
                    </span>
                    {showSuperuserField ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {showSuperuserField ? (
                    <div className="mt-2.5 space-y-1.5 border-t border-[var(--color-border)] pt-2">
                      <Label htmlFor="masterToken" className="text-[11px] text-[var(--color-muted-foreground)]">
                        64-hexadecimal token for owner-console actions
                      </Label>
                      <Input
                        id="masterToken"
                        type="text"
                        value={masterToken}
                        onChange={(e) => setMasterToken(e.target.value)}
                        placeholder="e.g. a1b2c3d4... (64 hex characters)"
                        className="font-mono text-xs tracking-wider h-8"
                      />
                      <p className="text-[10px] text-[var(--color-muted-foreground)]">
                        This is a second factor for protected owner actions; it never replaces your password.
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Cloudflare Turnstile Box */}
                {turnstileEnabled ? (
                  <div className="flex flex-col items-center justify-center pt-1 pb-1">
                    <div id="turnstile-box" className="min-h-[65px] flex items-center justify-center" />
                    <p className="text-[10px] text-[var(--color-muted-foreground)] flex items-center gap-1 mt-1">
                      <ShieldCheck className="h-3 w-3 text-[var(--color-primary)]" /> Protected by Cloudflare Turnstile bot deterrence
                    </p>
                  </div>
                ) : null}

                {error ? <p className="text-xs text-rose-600 font-medium">{error}</p> : null}

                <Button className="w-full text-xs h-9 bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] gap-1.5" type="submit" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying Credentials…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5" /> Authenticate &amp; Launch Practice
                    </>
                  )}
                </Button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={onFastPassSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="fastPass" className="text-xs flex items-center justify-between">
                    <span>6-Digit Workstation Fast-Pass Code</span>
                    <span className="text-[10px] text-[var(--color-primary)] font-normal">No password needed</span>
                  </Label>
                  <Input
                    id="fastPass"
                    placeholder="e.g. TP-8429"
                    required
                    value={fastPassCode}
                    onChange={(e) => setFastPassCode(e.target.value.toUpperCase())}
                    className="font-mono text-center tracking-widest text-base font-bold h-11 uppercase"
                  />
                  <p className="text-[11px] text-[var(--color-muted-foreground)]">
                    Generated upon invitation activation or from your active dashboard.
                  </p>
                </div>
                {fastPassError ? <p className="text-xs text-rose-600">{fastPassError}</p> : null}
                <Button
                  className="w-full text-xs h-9 bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] gap-1.5"
                  type="submit"
                  disabled={fastPassLoading || !fastPassCode.trim()}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  {fastPassLoading ? "Linking Workstation…" : "Link Workstation Instantly"}
                </Button>
              </form>
            )}

            <div className="mt-5 pt-4 border-t border-[var(--color-border)] text-center text-xs text-[var(--color-muted-foreground)] space-y-1">
              <p>Have an invitation link or token?</p>
              <Link to="/beta-redeem" className="text-[var(--color-primary)] font-semibold hover:underline inline-flex items-center gap-1">
                Activate Your Practice License <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
