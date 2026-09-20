import type { FormEvent } from "react";
import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { setAdminToken, getAdminToken } from "@/lib/api";
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
        const res = await fetch("/api/auth/turnstile/config");
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

    // 1. Turnstile Bot Challenge Verification
    if (turnstileEnabled) {
      if (!turnstileToken) {
        setLoading(false);
        setError("Please complete the Cloudflare security verification before signing in.");
        return;
      }
      try {
        const verifyRes = await fetch("/api/auth/turnstile/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: turnstileToken }),
        });
        const verifyData = (await verifyRes.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };
        if (!verifyRes.ok || !verifyData.success) {
          setLoading(false);
          setError(verifyData.error || "Cloudflare security verification failed. Please try again.");
          if (turnstileWidgetId.current && window.turnstile) {
            window.turnstile.reset(turnstileWidgetId.current);
          }
          setTurnstileToken(null);
          return;
        }
      } catch (err: any) {
        setLoading(false);
        setError(err?.message || "Failed to reach security verification service.");
        return;
      }
    }

    // 2. Validate Superuser 64-hex Token if provided
    const trimmedToken = masterToken.trim();
    if (trimmedToken) {
      if (trimmedToken.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmedToken)) {
        setLoading(false);
        setError("Master security token must be exactly 64 hexadecimal characters.");
        return;
      }
      // Save master token into session storage
      setAdminToken(trimmedToken);
    }

    // 3. Authenticate User Credentials
    const { error: err } = await authClient.signIn.email({ email, password });
    setLoading(false);

    if (err) {
      // If BetterAuth credentials failed, but a valid 64-hex master token is entered,
      // allow fallback to the admin workspace via constant-time token
      if (trimmedToken.length === 64) {
        navigate("/");
        return;
      }
      setError(err.message || "Sign in failed. Check your email and password.");
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
          <img
            src="/icons/icon-192.png"
            alt="Truepost"
            className="mx-auto mb-3 h-12 w-12 rounded-xl shadow-md ring-1 ring-white/10 object-cover"
          />
          <h1 className="text-2xl font-semibold tracking-tight">Truepost · Practice OS</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Sign in to your verified firm workspace
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-emerald-600" /> Sign In
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
                      ? "bg-[var(--color-card)] text-emerald-600 dark:text-emerald-400 shadow-xs font-semibold"
                      : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                  }`}
                >
                  ⚡ Fast-Pass
                </button>
              </div>
            </div>
            <CardDescription className="text-xs">
              {loginMode === "password"
                ? "Enter your firm email, password, and optional master token."
                : "Enter the 6-digit Fast-Pass pairing code generated on your invite or primary PC."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {loginMode === "password" ? (
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
                      <KeyRound className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Master Security Token (64-Char Superadmin)</span>
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
                        64-Hexadecimal Token (Indefinite Superadmin Access)
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
                        Bypasses license expiry and unlocks backend engineering directives.
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Cloudflare Turnstile Box */}
                {turnstileEnabled ? (
                  <div className="flex flex-col items-center justify-center pt-1 pb-1">
                    <div id="turnstile-box" className="min-h-[65px] flex items-center justify-center" />
                    <p className="text-[10px] text-[var(--color-muted-foreground)] flex items-center gap-1 mt-1">
                      <ShieldCheck className="h-3 w-3 text-emerald-600" /> Protected by Cloudflare Turnstile bot deterrence
                    </p>
                  </div>
                ) : null}

                {error ? <p className="text-xs text-rose-600 font-medium">{error}</p> : null}

                <Button className="w-full text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" type="submit" disabled={loading}>
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
                    <span className="text-[10px] text-emerald-600 font-normal">No password needed</span>
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
                  className="w-full text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
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
              <Link to="/redeem" className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline inline-flex items-center gap-1">
                Activate Your Practice License <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
