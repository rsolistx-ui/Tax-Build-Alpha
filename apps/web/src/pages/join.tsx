import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ROLE_LABELS: Record<string, string> = { preparer: "Preparer", bookkeeper: "Bookkeeper", read_only: "Read-only" };

type Preview = { firmName: string; role: string; email: string };

/** An existing account accepts a firm owner's invitation. Outside the app shell: someone removed from a firm has no access until they join. */
export function JoinFirmPage() {
  const token = useSearchParams()[0].get("token") ?? "";
  const { data: session, isPending } = authClient.useSession();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session?.user || !token) return;
    void api<Preview>("/api/firm-join/preview", { method: "POST", body: JSON.stringify({ token }) })
      .then(setPreview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "This invitation could not be opened."));
  }, [session?.user, token]);

  if (isPending) return <Centered><p className="text-sm text-[var(--color-muted-foreground)]">Loading...</p></Centered>;
  if (!session?.user) return <Navigate to={`/login?next=${encodeURIComponent(`/join?token=${token}`)}`} replace />;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/firm-join/accept", { method: "POST", body: JSON.stringify({ token }) });
      // A full load so access, role and firm are read fresh.
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join the firm.");
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Card>
        <CardHeader>
          <CardTitle>Join a firm</CardTitle>
          <CardDescription>Signed in as {session.user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!token ? <p className="text-sm">This link is missing its invitation code. Ask the firm owner for a new link.</p> : null}
          {preview ? (
            <ul className="space-y-1 text-sm">
              <li><span className="text-[var(--color-muted-foreground)]">Firm:</span> {preview.firmName}</li>
              <li><span className="text-[var(--color-muted-foreground)]">Your role:</span> {ROLE_LABELS[preview.role] ?? preview.role}</li>
            </ul>
          ) : null}
          {error ? <p className="rounded-md bg-red-500/15 px-3 py-2 text-sm">{error}</p> : null}
          {preview ? (
            <Button className="w-full" disabled={busy} onClick={() => void accept()}>{busy ? "Joining..." : "Accept and join"}</Button>
          ) : null}
          <Button className="w-full" variant="outline" onClick={() => void authClient.signOut().then(() => { window.location.href = `/login?next=${encodeURIComponent(`/join?token=${token}`)}`; })}>
            Use a different account
          </Button>
        </CardContent>
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
