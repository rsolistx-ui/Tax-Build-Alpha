import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, Receipt, User } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ClientException = {
  clientId: string;
  clientName: string;
  totalExceptions: number;
  criticalCount: number;
  mediumCount: number;
  lowCount: number;
  missingReceipts: number;
  bankExplanations: number;
  miscIssues: number;
};

export function ExceptionHeatmap() {
  const [data, setData] = useState<ClientException[] | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    setLoading(true);
    try {
      const result = await api<{ clients: ClientException[] }>("/api/exception-heatmap");
      setData(result.clients);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const sortedClients = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => b.totalExceptions - a.totalExceptions);
  }, [data]);

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="h-8 w-32 animate-pulse rounded bg-[var(--color-muted)]" />
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 w-full animate-pulse rounded bg-[var(--color-muted)]" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4" />
          Exception Heatmap
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {sortedClients.length === 0 ? (
          <div className="p-6 text-center text-sm text-[var(--color-muted-foreground)]">
            No exceptions found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Client</th>
                  <th className="px-4 py-3 text-center font-medium">Total</th>
                  <th className="px-4 py-3 text-center font-medium">Critical</th>
                  <th className="px-4 py-3 text-center font-medium">Medium</th>
                  <th className="px-4 py-3 text-center font-medium">Low</th>
                  <th className="px-4 py-3 text-center font-medium">Breakdown</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sortedClients.map((client) => (
                  <tr key={client.clientId} className="hover:bg-[var(--color-muted)]">
                    <td className="px-4 py-3 font-medium">{client.clientName}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge className="border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">{client.totalExceptions}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className="bg-red-500 text-white hover:bg-red-600">{client.criticalCount}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className="bg-yellow-500 text-black hover:bg-yellow-600">{client.mediumCount}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className="bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]">{client.lowCount}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                          <Receipt className="h-3 w-3" />
                          {client.missingReceipts}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                          <User className="h-3 w-3" />
                          {client.bankExplanations}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                          <FileText className="h-3 w-3" />
                          {client.miscIssues}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
