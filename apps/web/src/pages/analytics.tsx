import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Activity, DollarSign, BarChart3, PieChart, LineChart, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export default function AnalyticsDashboard() {
  const [metrics, setMetrics] = useState({ revenue: 0, cost: 0, pnl: 0, receipts: 0, bankTxns: 0 });
  const [locked, setLocked] = useState(true);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (locked) return;
    api("/api/admin/metrics")
      .then((d: any) => setMetrics({ revenue: d.revenue ?? 0, cost: d.cost ?? 0, pnl: d.pnl ?? 0, receipts: d.receipts ?? 0, bankTxns: d.syncEvents ?? 0 }))
      .catch(() => {});
  }, [locked]);

  const grossMargin = metrics.revenue ? ((metrics.revenue - metrics.cost) / metrics.revenue * 100).toFixed(1) : "0.0";

  if (locked) {
    return (
      <div className="max-w-md mx-auto mt-20 p-6 bg-[#23262e] border border-[#333] rounded-xl shadow-2xl">
        <div className="flex items-center gap-3 mb-4"><Lock className="h-6 w-6 text-amber-400" /><h2 className="text-xl font-bold text-white">Analytics Access</h2></div>
        <p className="text-xs text-[#888] mb-4">Paste the 64-character token from /beta-admin. 5 attempt limit. Verifies against /api/beta/redeem-check.</p>
        {error && <div className="text-rose-400 text-xs mb-2">{error}</div>}
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="64-char hex token" className="w-full mb-3 p-2 bg-[#1a1d23] border border-[#444] rounded text-sm font-mono text-white" />
        <button
          onClick={async () => {
            if (attempts >= 5) { setError("Blocked: too many attempts"); return; }
            if (token.length !== 64 || !/^[0-9a-fA-F]+$/.test(token)) { setError("Token must be 64 hex chars"); setAttempts((a) => a + 1); return; }
            try {
              const res = await api<{ valid: boolean }>("/api/beta/redeem-check?token=" + encodeURIComponent(token));
              if (res.valid) { setLocked(false); setError(""); } else { setError("Invalid or unknown token"); setAttempts((a) => a + 1); }
            } catch { setError("Could not verify token"); setAttempts((a) => a + 1); }
          }}
          className="w-full p-2 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium"
        >
          Unlock Analytics
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-6 bg-[#1a1d23] text-[#f0f0f0] min-h-screen">
      <header className="flex items-center gap-3 border-b border-[#333] pb-4">
        <LineChart className="h-8 w-8 text-amber-400" />
        <div><h1 className="text-3xl font-bold tracking-tight">Folio — Analytics</h1><p className="text-sm text-[#888]">Live metrics from /api/admin/metrics</p></div>
        <Badge className="ml-auto bg-amber-100 text-amber-700 border-amber-200">Live</Badge>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-[#23262e] border-[#333]"><CardContent className="p-6"><div className="text-xs text-[#888]">Revenue</div><div className="text-3xl font-bold text-emerald-300">${metrics.revenue.toLocaleString()}</div><div className="flex items-center gap-1 text-xs text-emerald-400 mt-1"><TrendingUp className="h-3 w-3" /> live</div></CardContent></Card>
        <Card className="bg-[#23262e] border-[#333]"><CardContent className="p-6"><div className="text-xs text-[#888]">Cost</div><div className="text-3xl font-bold text-rose-300">${metrics.cost.toLocaleString()}</div><div className="flex items-center gap-1 text-xs text-rose-400 mt-1"><TrendingDown className="h-3 w-3" /> live</div></CardContent></Card>
        <Card className="bg-[#23262e] border-[#333]"><CardContent className="p-6"><div className="text-xs text-[#888]">Gross Margin</div><div className="text-3xl font-bold text-amber-300">{grossMargin}%</div><div className="text-xs text-[#888] mt-1">from revenue/cost</div></CardContent></Card>
        <Card className="bg-[#23262e] border-[#333]"><CardContent className="p-6"><div className="text-xs text-[#888]">Net Profit (PNL)</div><div className="text-3xl font-bold text-emerald-300">${metrics.pnl.toLocaleString()}</div><div className="flex items-center gap-1 text-xs text-emerald-400 mt-1"><DollarSign className="h-3 w-3" /> live</div></CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-[#23262e] border-[#333]"><CardHeader><CardTitle className="text-amber-300 flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Revenue vs Cost</CardTitle></CardHeader><CardContent><div className="space-y-2 text-sm"><div className="flex justify-between"><span>Revenue</span><span className="font-mono">${metrics.revenue.toLocaleString()}</span></div><div className="w-full h-2 bg-[#333] rounded overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: "70%" }} /></div><div className="flex justify-between"><span>Cost</span><span className="font-mono">${metrics.cost.toLocaleString()}</span></div><div className="w-full h-2 bg-[#333] rounded overflow-hidden"><div className="h-full bg-rose-500" style={{ width: "40%" }} /></div></div></CardContent></Card>
        <Card className="bg-[#23262e] border-[#333]"><CardHeader><CardTitle className="text-amber-300 flex items-center gap-2"><PieChart className="h-4 w-4" /> Source Metrics</CardTitle></CardHeader><CardContent><div className="grid grid-cols-2 gap-3 text-sm"><div><div className="text-xs text-[#888]">Receipts</div><div className="text-xl font-bold">{metrics.receipts}</div></div><div><div className="text-xs text-[#888]">Sync Events</div><div className="text-xl font-bold">{metrics.bankTxns}</div></div></div></CardContent></Card>
      </div>
      <Card className="bg-[#23262e] border-[#333]"><CardHeader><CardTitle className="text-amber-300 flex items-center gap-2"><Activity className="h-4 w-4" /> Real-Time Schematics</CardTitle></CardHeader><CardContent><div className="grid sm:grid-cols-3 gap-4 text-sm"><div><div className="font-mono text-xs text-[#888]">Client Workbench</div><div className="font-bold">Active</div><span className="inline-block rounded px-1.5 py-0.5 text-xs bg-emerald-900 text-emerald-300 border border-emerald-700 mt-1">Running</span></div><div><div className="font-mono text-xs text-[#888]">DocuSign OAuth</div><div className="font-bold">via /api/docu-sign/oauth/*</div><span className="inline-block rounded px-1.5 py-0.5 text-xs bg-amber-900 text-amber-300 border border-amber-700 mt-1">Configured</span></div><div><div className="font-mono text-xs text-[#888]">Gmail</div><div className="font-bold">via /api/gmail/*</div><span className="inline-block rounded px-1.5 py-0.5 text-xs bg-emerald-900 text-emerald-300 border border-emerald-700 mt-1">Ready</span></div></div></CardContent></Card>
    </div>
  );
}
