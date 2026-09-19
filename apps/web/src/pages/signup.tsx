import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { parseInvitationFragment } from "@/lib/beta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignupPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The invitation token is a one-time secret: it travels in the URL
  // fragment (never sent to the server in a normal request) rather than the
  // query string, is copied into component state immediately, and the
  // fragment is then stripped from browser history so it never lingers in
  // history, referrer headers, or server access logs.
  useEffect(() => {
    if (!window.location.hash) return;
    const { token: fragmentToken, email: fragmentEmail } = parseInvitationFragment(window.location.hash);
    if (fragmentToken) setToken(fragmentToken);
    if (fragmentEmail) setEmail(fragmentEmail);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/beta/redeem", {
        method: "POST",
        body: JSON.stringify({ token, name, email, password }),
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not activate this invitation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-sm font-bold text-white shadow-md ring-1 ring-emerald-500/40">
            T
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Activate your beta invitation</h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            Truepost is invitation-only during the beta. Enter the one-time invitation link details below.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Activate invitation</CardTitle>
            <CardDescription>Your firm workspace is created automatically once activated.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="token">Invitation token</Label>
                <Input id="token" required value={token} onChange={(e) => setToken(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Invited email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? "Activating…" : "Activate beta access"}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-[var(--color-muted-foreground)]">
              Already activated?{" "}
              <Link className="font-medium text-[var(--color-foreground)] underline-offset-4 hover:underline" to="/login">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
