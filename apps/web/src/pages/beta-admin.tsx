import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Brain, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { buildInvitationLink } from "@/lib/beta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminTokenGate } from "@/components/admin-token-gate";

type Invitation = {
  id: string;
  email: string;
  status: "pending" | "redeemed" | "revoked" | "expired";
  issued_at: string;
  expires_at: string;
  redeemed_at: string | null;
  beta_days: number;
};

type Entitlement = {
  user_id: string;
  status: "active" | "expired" | "revoked";
  starts_at: string;
  expires_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  email: string | null;
  name: string | null;
};

type AccessEvent = {
  id: string;
  action: string;
  actor_user_id: string | null;
  affected_user_id: string | null;
  affected_email: string | null;
  reason: string | null;
  created_at: string;
};

function fmt(value: string | null): string {
  if (!value) return "\u2014";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function BetaAdminPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [events, setEvents] = useState<AccessEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [betaDays, setBetaDays] = useState(30);
  const [createdLink, setCreatedLink] = useState<{ email: string; token: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [inv, ent, aud] = await Promise.all([
        api<{ invitations: Invitation[] }>("/api/beta/invitations"),
        api<{ entitlements: Entitlement[] }>("/api/beta/entitlements"),
        api<{ events: AccessEvent[] }>("/api/beta/audit"),
      ]);
      setInvitations(inv.invitations);
      setEntitlements(ent.entitlements);
      setEvents(aud.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load beta access data");
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createInvite(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const data = await api<{ invitation: { email: string; token: string } }>("/api/beta/invitations", {
        method: "POST",
        body: JSON.stringify({ email, betaDays }),
      });
      setCreatedLink({ email: data.invitation.email, token: data.invitation.token });
      setEmail("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invitation");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(userId: string) {
    setBusyUserId(userId);
    try {
      await api(`/api/beta/entitlements/${userId}/revoke`, { method: "POST", body: JSON.stringify({}) });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke access");
    } finally {
      setBusyUserId(null);
    }
  }

  async function reactivate(userId: string) {
    setBusyUserId(userId);
    try {
      await api(`/api/beta/entitlements/${userId}/reactivate`, { method: "POST", body: JSON.stringify({ betaDays: 30 }) });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reactivate access");
    } finally {
      setBusyUserId(null);
    }
  }

  async function revokeInvitation(invitationId: string) {
    setRevokingInviteId(invitationId);
    try {
      await api(`/api/beta/invitations/${invitationId}/revoke`, { method: "POST", body: JSON.stringify({}) });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke invitation");
    } finally {
      setRevokingInviteId(null);
    }
  }

  async function extend(userId: string) {
    setBusyUserId(userId);
    try {
      await api(`/api/beta/entitlements/${userId}/extend`, { method: "POST", body: JSON.stringify({ additionalDays: 30 }) });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extend access");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-5 w-5" /> Beta Access & Licensing
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Owner & Power User controls. Invite testers, set beta duration, and revoke access immediately.
          </p>
        </div>
        <Link to="/admin">
          <Button variant="outline" size="sm" className="gap-2 text-xs border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
            <Brain className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>AI Rules & Markdown Injector</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      <AdminTokenGate onTokenChanged={loadAll} />

      {error ? <p className="text-sm text-[var(--color-destructive)]">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Create invitation</CardTitle>
          <CardDescription>Copy the one-time link and deliver it to the tester yourself.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={createInvite}>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-days">Beta days</Label>
              <Input
                id="invite-days"
                type="number"
                min={1}
                max={365}
                value={betaDays}
                onChange={(e) => setBetaDays(Number(e.target.value) || 30)}
                className="w-24"
              />
            </div>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create invitation"}
            </Button>
          </form>
          {createdLink ? (
            <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-3 text-sm">
              <p className="font-medium">Invitation created for {createdLink.email}</p>
              <p className="mt-1 break-all text-xs text-[var(--color-muted-foreground)]">
                Link: {buildInvitationLink(window.location.origin, createdLink.token, createdLink.email)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                This token is shown once. It is not recoverable after you leave this page.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>Pending and redeemed invitations.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Issued</th>
                  <th className="py-2 pr-3">Expires</th>
                  <th className="py-2 pr-3">Redeemed</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-3">{inv.email}</td>
                    <td className="py-2 pr-3 capitalize">{inv.status}</td>
                    <td className="py-2 pr-3">{fmt(inv.issued_at)}</td>
                    <td className="py-2 pr-3">{fmt(inv.expires_at)}</td>
                    <td className="py-2 pr-3">{fmt(inv.redeemed_at)}</td>
                    <td className="py-2">
                      {inv.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={revokingInviteId === inv.id}
                          onClick={() => void revokeInvitation(inv.id)}
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {invitations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-sm text-[var(--color-muted-foreground)]">
                      No invitations yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Beta users</CardTitle>
          <CardDescription>Active, expired, and revoked entitlements.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Expires</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entitlements.map((ent) => (
                  <tr key={ent.user_id} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="py-2 pr-3">{ent.email || ent.name || ent.user_id}</td>
                    <td className="py-2 pr-3 capitalize">{ent.status}</td>
                    <td className="py-2 pr-3">{fmt(ent.expires_at)}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        {ent.status === "active" ? (
                          <Button size="sm" variant="destructive" disabled={busyUserId === ent.user_id} onClick={() => void revoke(ent.user_id)}>
                            Revoke
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" disabled={busyUserId === ent.user_id} onClick={() => void reactivate(ent.user_id)}>
                            Reactivate
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={busyUserId === ent.user_id} onClick={() => void extend(ent.user_id)}>
                          +30 days
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {entitlements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-sm text-[var(--color-muted-foreground)]">
                      No beta users yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access audit history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">{event.action.replace(/_/g, " ")}</span>
                <span className="text-[var(--color-muted-foreground)]">{event.affected_email || event.affected_user_id || ""}</span>
                <span className="text-[var(--color-muted-foreground)]">{fmt(event.created_at)}</span>
              </div>
            ))}
            {events.length === 0 ? <p className="text-sm text-[var(--color-muted-foreground)]">No access events yet.</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
