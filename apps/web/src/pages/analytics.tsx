import { BarChart3, FileSpreadsheet } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Portfolio analytics must be backed by an authenticated, verified aggregate.
 * Until that source exists, this route deliberately shows an honest state rather
 * than sample numbers or unverified integration status.
 */
export default function AnalyticsPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-muted)] text-[var(--color-foreground)]">
          <BarChart3 className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Firm analytics</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">Only verified source data belongs here.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio reporting is not connected yet</CardTitle>
          <CardDescription>
            Truepost does not show sample revenue, health, or integration status as if it were live. Client-level, evidence-backed P&amp;Ls remain available from each workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/clients">
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Open client workspaces
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
