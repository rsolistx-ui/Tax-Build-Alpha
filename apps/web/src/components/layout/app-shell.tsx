import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Building2, LogOut, Users } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppShell({
  firmName,
  userName,
}: {
  firmName?: string;
  userName?: string;
}) {
  const navigate = useNavigate();

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
                  <Users className="h-3.5 w-3.5" />
                  Clients
                </span>
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {firmName ? (
              <span className="hidden items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] sm:inline-flex">
                <Building2 className="h-3.5 w-3.5" />
                {firmName}
              </span>
            ) : null}
            <span className="text-sm text-[var(--color-muted-foreground)]">{userName}</span>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
