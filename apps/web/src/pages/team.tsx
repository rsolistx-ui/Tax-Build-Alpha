import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/formatters";

type Role = "owner" | "preparer" | "bookkeeper" | "read_only";
type Member = { userId: string; role: Role; name: string | null; email: string | null; joinedAt: string; isMe: boolean };
type Invitation = { id: string; email: string; role: Role; expiresAt: string };
type Team = { myRole: Role; assignableRoles: Role[]; members: Member[]; invitations: Invitation[] };

const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  preparer: "Preparer",
  bookkeeper: "Bookkeeper",
  read_only: "Read-only",
};

const ROLE_SUMMARY: Record<Role, string> = {
  owner: "Everything, including billing, staff and deleting clients",
  preparer: "All client and tax work, including tax sign-off",
  bookkeeper: "Receipts, bank, documents and requests; no tax sign-off",
  read_only: "Sees everything, changes nothing",
};

const selectClass = "h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 text-sm";

export function TeamPage() {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("preparer");
  const [newLink, setNewLink] = useState<{ email: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      setTeam(await api<Team>("/api/firm/staff"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the team.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  function invite(e: React.FormEvent) {
    e.preventDefault();
    void run(async () => {
      const res = await api<{ invitation: { email: string; token: string } }>("/api/firm/staff/invitations", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const link = `${window.location.origin}/beta-redeem?token=${res.invitation.token}&email=${encodeURIComponent(res.invitation.email)}`;
      setNewLink({ email: res.invitation.email, link });
      setCopied(false);
      setEmail("");
    });
  }

  async function copyLink() {
    if (!newLink) return;
    await navigator.clipboard.writeText(newLink.link);
    setCopied(true);
  }

  if (!team) {
    return <p className="text-sm text-[var(--color-muted-foreground)]">{error ?? "Loading team..."}</p>;
  }

  const isOwner = team.myRole === "owner";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {team.members.length} member{team.members.length === 1 ? "" : "s"} · no seat limit · your role: {ROLE_LABELS[team.myRole]}
        </p>
      </div>
      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-[var(--color-border)]">
            {team.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <p className="font-medium">{m.name ?? m.email ?? m.userId}{m.isMe ? " (you)" : ""}</p>
                  <p className="text-xs text-[var(--color-muted-foreground)]">{m.email} · joined {formatDate(m.joinedAt)}</p>
                </div>
                {isOwner && m.role !== "owner" ? (
                  <div className="flex items-center gap-2">
                    <select
                      className={selectClass}
                      value={m.role}
                      disabled={busy}
                      aria-label={`Role for ${m.name ?? m.email}`}
                      onChange={(e) => void run(() => api(`/api/firm/staff/${m.userId}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }))}
                    >
                      {team.assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove ${m.name ?? m.email} from the firm? They are signed out immediately.`)) {
                          void run(() => api(`/api/firm/staff/${m.userId}`, { method: "DELETE" }));
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Badge>{ROLE_LABELS[m.role]}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Invite staff</CardTitle>
            <CardDescription>Creates a sign-up link for one email address, valid 14 days. Send it to them yourself.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                aria-label="Staff email"
                className="h-9 min-w-[16rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm"
              />
              <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
                {team.assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <Button type="submit" disabled={busy || !email.trim()}>Create invite link</Button>
            </form>
            {newLink ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-border)] p-2 text-sm">
                <span className="min-w-0 flex-1 break-all">Link for {newLink.email}: {newLink.link}</span>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copyLink()}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
            ) : null}
            <ul className="space-y-1 text-xs text-[var(--color-muted-foreground)]">
              {(Object.keys(ROLE_SUMMARY) as Role[]).map((r) => <li key={r}><span className="font-medium text-[var(--color-foreground)]">{ROLE_LABELS[r]}:</span> {ROLE_SUMMARY[r]}</li>)}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {isOwner && team.invitations.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--color-border)]">
              {team.invitations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{i.email} · {ROLE_LABELS[i.role]} · expires {formatDate(i.expiresAt)}</span>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => api(`/api/firm/staff/invitations/${i.id}/revoke`, { method: "POST" }))}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
