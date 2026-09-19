import type { FormEvent } from "react";
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Monitor, ArrowRight } from "lucide-react";

export function LoginPage() {
  const navigate = useNavigate();
  const [loginMode, setLoginMode] = useState<"password" | "fast_pass">("password");

  // Password Login State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fast-Pass State
  const [fastPassCode, setFastPassCode] = useState("");
  const [fastPassLoading, setFastPassLoading] = useState(false);
  const [fastPassError, setFastPassError] = useState<string | null>(null);

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (err) {
      setError(err.message || "Sign in failed");
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

      // Fast-Pass accepted, session established
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
          <img src="/icons/icon-192.png" alt="Truepost" className="mx-auto mb-3 h-12 w-12 rounded-xl shadow-md ring-1 ring-white/10 object-cover" />
          <h1 className="text-2xl font-semibold tracking-tight">Truepost · Practice OS</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Sign in to your verified firm workspace
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Sign In</CardTitle>
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
                ? "Enter your firm email and master password."
                : "Enter the 6-digit Fast-Pass pairing code generated on your invite or primary PC."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {loginMode === "password" ? (
              <form className="space-y-4" onSubmit={onPasswordSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-xs">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password" className="text-xs">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="text-xs"
                  />
                </div>
                {error ? <p className="text-xs text-rose-600">{error}</p> : null}
                <Button className="w-full text-xs h-9" type="submit" disabled={loading}>
                  {loading ? "Signing in…" : "Sign in to Practice"}
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
