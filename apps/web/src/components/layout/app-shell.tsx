import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, ClipboardList, LayoutDashboard, LogOut, Map, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shouldShowWelcomeTour, WelcomeTour } from "@/components/welcome-tour";

export function AppShell({
  firmName,
  userName,
  isOwner,
}: {
  firmName?: string;
  userName?: string;
  isOwner?: boolean;
}) {
  const navigate = useNavigate();
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => setTourOpen(shouldShowWelcomeTour()), []);

  async function signOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-full bg-[var(--color-background)]">
      <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-card)]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-primary)] text-xs text-white">
                F
              </span>
              Folio
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                    isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Operations
                </span>
              </NavLink>
              <NavLink
                to="/clients"
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                    isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  Clients
                </span>
              </NavLink>
              <NavLink
                to="/work-queue"
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                    isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Work Queue
                </span>
              </NavLink>
              {isOwner ? (
                <NavLink
                  to="/beta-admin"
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                      isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                    )
                  }
                >
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Beta Access
                  </span>
                </NavLink>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {firmName ? (
              <span className="hidden items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] sm:inline-flex">
                <Building2 className="h-3.5 w-3.5" />
                {firmName}
              </span>
            ) : null}
            <button onClick={() => setTourOpen(true)} className="hidden items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] sm:inline-flex"><Map className="h-3.5 w-3.5" /> Guide</button>
            <span className="text-sm text-[var(--color-muted-foreground)]">{userName}</span>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/95 p-1 shadow-lg backdrop-blur sm:hidden" aria-label="Primary navigation">
        {[
          { to: "/", label: "Operations", icon: LayoutDashboard, end: true },
          { to: "/clients", label: "Clients", icon: Users },
          { to: "/work-queue", label: "Work queue", icon: ClipboardList },
        ].map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium text-[var(--color-muted-foreground)]", isActive && "bg-[#14201c] text-white")}><Icon className="h-4 w-4" />{label}</NavLink>)}
      </nav>
      <WelcomeTour forceOpen={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  );
}
