import { useState } from "react";
import { KeyRound, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function BetaRedeemPage() {
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-6">
      <Card className="w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-2"><ShieldCheck className="h-6 w-6 text-emerald-600" /><h1 className="text-xl font-bold">Beta Access — Enter Key</h1></div>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Your 64-bit beta token from admin. Then email, password, name to enter.</p>
        {submitted ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800"><Sparkles className="h-4 w-4 inline mr-1" /> Token accepted. Redirecting to workspace tour...</div>
            <Button className="w-full" onClick={() => window.location.href = "/clients?tour=1"}>Enter Workspace <ArrowRight className="h-4 w-4 ml-1" /></Button>
          </div>
        ) : (
          <form
            onSubmit={async (e) => { e.preventDefault(); try { await fetch("/api/beta/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, email, password, name }) }); setSubmitted(true); } catch { alert("Invalid token or server error"); } }}
            className="space-y-3"
          >
            <Input placeholder="64-bit beta token" value={token} onChange={(e) => setToken(e.target.value)} required />
            <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Input type="password" placeholder="Password (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Button type="submit" className="w-full">Enter Workspace <KeyRound className="h-4 w-4 ml-1" /></Button>
          </form>
        )}
      </Card>
    </div>
  );
}
