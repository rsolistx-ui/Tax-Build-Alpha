import { useState, useEffect, type FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  KeyRound,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Download,
  Copy,
  Check,
  Monitor,
  Smartphone,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function BetaRedeemPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fast-Pass Station Code State
  const [fastPassCode, setFastPassCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    const urlToken = searchParams.get("token");
    const urlEmail = searchParams.get("email");
    if (urlToken) setToken(urlToken);
    if (urlEmail) setEmail(urlEmail);
  }, [searchParams]);

  async function handleRedeem(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/beta/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          email: email.trim().toLowerCase(),
          password,
          name: name.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Activation failed. Please check your invitation key.");
      }

      setSubmitted(true);

      // Automatically generate a 6-character Fast-Pass code for frictionless workstation pairing
      try {
        const fpRes = await fetch("/api/beta/fast-pass/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        if (fpRes.ok) {
          const fpData = await fpRes.json();
          if (fpData.code) setFastPassCode(fpData.code);
        }
      } catch {
        /* ignore */
      }
    } catch (err: any) {
      setError(err?.message || "An error occurred during activation.");
    } finally {
      setSubmitting(false);
    }
  }

  const isVerifiedLink = Boolean(searchParams.get("token") && searchParams.get("email"));

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-base font-bold text-white shadow-lg ring-1 ring-emerald-500/40">
            T
          </div>
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--color-foreground)]">
              Truepost · Practice OS
            </h1>
            <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
              Private Invitation
            </Badge>
          </div>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Verified double-entry bookkeeping, deterministic compliance, and tax workpapers.
          </p>
        </div>

        {submitted ? (
          /* Workstation Onboarding Hub */
          <Card className="border-[var(--color-primary)]/30 bg-[var(--color-card)] shadow-xl overflow-hidden">
            <div className="bg-[var(--color-primary)] px-6 py-4 text-[var(--color-primary-foreground)]">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Sparkles className="h-4 w-4" />
                <span>Practice Workspace Activated</span>
              </div>
              <p className="text-xs text-[var(--color-primary-foreground)]/80 mt-0.5">
                Welcome, {name || "Practitioner"}. Your firm workspace is ready.
              </p>
            </div>

            <CardContent className="p-6 space-y-5">
              {/* Option 1: Fast-Pass Workstation Code */}
              {fastPassCode && (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="flex items-center gap-1.5 text-[var(--color-foreground)]">
                      <Monitor className="h-4 w-4 text-[var(--color-primary)]" />
                      Workstation Fast-Pass Code
                    </span>
                    <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
                      Valid for 60 Mins
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-sm font-mono font-bold tracking-widest text-emerald-600 dark:text-emerald-400">
                    <span className="text-base">{fastPassCode}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => {
                        navigator.clipboard.writeText(fastPassCode);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                    >
                      {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
                    Installing Truepost on your desktop PC or second monitor? Skip passwords! Simply enter this 6-digit Fast-Pass Code on the login screen to link your workstation in 2 seconds.
                  </p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2.5">
                <Button
                  className="w-full bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] font-medium text-xs h-10 gap-2 shadow-sm"
                  onClick={() => navigate("/clients?tour=1")}
                >
                  Enter Web Workspace Now <ArrowRight className="h-4 w-4" />
                </Button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button asChild variant="outline" className="text-xs h-9 gap-1.5 justify-center border-[var(--color-border)]">
                    <a href="/download/Truepost_0.1.0_x64-setup.exe" download>
                      <Download className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                      Download Desktop App
                    </a>
                  </Button>

                  <Button
                    variant="outline"
                    className="text-xs h-9 gap-1.5 justify-center border-[var(--color-border)]"
                    onClick={() => {
                      const mobilePairingUrl = `${window.location.origin}/portal?fast_pass=${fastPassCode || ""}`;
                      navigator.clipboard.writeText(mobilePairingUrl);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                  >
                    <Smartphone className="h-3.5 w-3.5 text-blue-500" />
                    {copiedLink ? "Mobile Link Copied!" : "Copy Mobile Scanner Link"}
                  </Button>
                </div>
              </div>

              <div className="rounded-lg bg-[var(--color-muted)]/50 p-3 text-[11px] text-[var(--color-muted-foreground)] leading-relaxed">
                <strong>Zero Configuration Needed:</strong> All firm data lives securely in your isolated cloud ledger. Receipts captured on your mobile phone or uploaded in desktop sync in real time.
              </div>
            </CardContent>
          </Card>
        ) : (
          /* VIP Invitation Activation Card */
          <Card className="border-[var(--color-border)] shadow-lg">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[var(--color-primary)]" />
                  {isVerifiedLink ? "Verified Practice Invitation" : "Enter Invitation Token"}
                </CardTitle>
                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
                  Encrypted Ledger
                </Badge>
              </div>
              <CardDescription className="text-xs">
                {isVerifiedLink
                  ? "Your cryptographic invitation key is verified. Complete your profile to activate your firm workspace."
                  : "Please enter the cryptographic invitation key issued by your firm administrator."}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleRedeem} className="space-y-4">
                {error && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-700 dark:text-rose-400">
                    {error}
                  </div>
                )}

                {!isVerifiedLink && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--color-foreground)]">
                      64-Hex Invitation Key
                    </label>
                    <Input
                      placeholder="Paste your 64-hex invitation token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      className="font-mono text-xs"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    Practitioner Email
                  </label>
                  <Input
                    type="email"
                    placeholder="e.g. phyllis@firm.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    readOnly={isVerifiedLink}
                    className={`text-xs ${isVerifiedLink ? "bg-[var(--color-muted)] cursor-not-allowed font-mono text-[11px]" : ""}`}
                  />
                  {isVerifiedLink && (
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Locked to verified invitation recipient
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    Practitioner / Firm Name
                  </label>
                  <Input
                    placeholder="e.g. Phyllis Vance, CPA"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--color-foreground)]">
                    Create Master Password
                  </label>
                  <Input
                    type="password"
                    placeholder="Minimum 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="text-xs"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={submitting || !email.trim() || !password || !name.trim() || !token.trim()}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 font-medium text-xs h-10 gap-2 shadow-sm"
                >
                  <KeyRound className="h-4 w-4" />
                  {submitting ? "Provisioning Ledger & Firm OS..." : "Activate Practice Workspace"}
                </Button>

                <p className="text-[11px] text-center text-[var(--color-muted-foreground)] pt-1">
                  Protected under Treasury Circular 230 and IRC § 7216 non-disclosure standards.
                </p>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
