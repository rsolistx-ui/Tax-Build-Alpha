import { useState, useEffect } from "react";
import { KeyRound, ShieldAlert, ShieldCheck, Lock, Unlock, Eye, EyeOff } from "lucide-react";
import { getAdminToken, setAdminToken, api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminTokenGateProps {
  onTokenChanged?: () => void;
  className?: string;
}

export function AdminTokenGate({ onTokenChanged, className }: AdminTokenGateProps) {
  const [currentToken, setCurrentToken] = useState<string | null>(getAdminToken());
  const [inputToken, setInputToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setCurrentToken(getAdminToken());
  }, []);

  async function handleSaveToken(e: React.FormEvent) {
    e.preventDefault();
    const token = inputToken.trim();
    if (!token) {
      setError("Please enter a master admin token.");
      return;
    }

    if (token.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(token)) {
      setError("Master token must be exactly 64 hexadecimal characters.");
      return;
    }

    setVerifying(true);
    setError(null);
    setSuccess(null);

    // Temporarily save to sessionStorage so api() passes the x-admin-token header
    setAdminToken(token);

    try {
      // Test the token against the admin endpoints
      await api("/api/beta/entitlements");
      setCurrentToken(token);
      setInputToken("");
      setSuccess("Master token authenticated and active for this session.");
      if (onTokenChanged) onTokenChanged();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setAdminToken(null);
      setError(err?.message || "Invalid master token or unauthorized access.");
    } finally {
      setVerifying(false);
    }
  }

  function handleClearToken() {
    setAdminToken(null);
    setCurrentToken(null);
    setError(null);
    setSuccess(null);
    if (onTokenChanged) onTokenChanged();
  }

  const isLocked = !currentToken;

  return (
    <div className={`rounded-xl border ${isLocked ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"} p-4 transition-all ${className ?? ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isLocked ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>
            {isLocked ? <Lock className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-[var(--color-foreground)]">
                {isLocked ? "Admin Master Key Lockdown" : "Master Key Authenticated"}
              </h3>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isLocked ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"}`}>
                {isLocked ? "Key Required" : "Active Session"}
              </span>
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {isLocked
                ? "Provide your 64-character cryptographic hex master token to unlock rule injection and licensing controls."
                : `Verified with 64-character SHA-256 hex key (Ends with ...${currentToken?.slice(-6)}).`}
            </p>
          </div>
        </div>

        {currentToken ? (
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearToken}
            className="text-xs h-8 gap-1.5 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300"
          >
            <Unlock className="h-3.5 w-3.5" />
            Lock Console
          </Button>
        ) : null}
      </div>

      {isLocked ? (
        <form onSubmit={handleSaveToken} className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[280px]">
              <Input
                type={showToken ? "text" : "password"}
                placeholder="Paste 64-character hex master token..."
                value={inputToken}
                onChange={(e) => {
                  setInputToken(e.target.value);
                  setError(null);
                }}
                className="font-mono text-xs pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2.5 top-2.5 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={verifying || !inputToken.trim()}
              className="bg-[var(--color-primary)] hover:opacity-90 text-[var(--color-primary-foreground)] text-xs h-9 px-4 gap-1.5 shadow-sm"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {verifying ? "Validating Key..." : "Unlock Master Access"}
            </Button>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)] px-0.5">
            <span>Timing-attack protected via constant-time XOR comparison</span>
            <span>Length: {inputToken.trim().length} / 64</span>
          </div>

          {error ? (
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 mt-1">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </form>
      ) : null}

      {success ? (
        <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 mt-2">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span>{success}</span>
        </div>
      ) : null}
    </div>
  );
}
