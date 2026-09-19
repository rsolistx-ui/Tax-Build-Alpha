import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Bot, Brain, Building2, Calendar, ClipboardList, Clock, FolderKanban, Headphones, LayoutDashboard, Lightbulb, LogOut, Map, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shouldShowWelcomeTour, WelcomeTour } from "@/components/welcome-tour";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import { ThemeToggle } from "@/components/theme-toggle";
import { FeatureRequestModal } from "@/components/feature-request-modal";
import { SupportConciergeModal } from "@/components/support-concierge-modal";
import { VipOnboardingModal } from "@/components/vip-onboarding-modal";
import { VoiceRuleDictationModal } from "@/components/voice-rule-dictation-modal";
import { AccountingImportModal } from "@/components/accounting-import-modal";

export function AppShell({
  firmName,
  userName,
  isOwner,
  daysLeft,
}: {
  firmName?: string;
  userName?: string;
  isOwner?: boolean;
  daysLeft?: number;
}) {
  const navigate = useNavigate();
  const [tourOpen, setTourOpen] = useState(false);
  const [featureRequestOpen, setFeatureRequestOpen] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [vipOnboardingOpen, setVipOnboardingOpen] = useState(false);
  const [accountingImportOpen, setAccountingImportOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);

  useEffect(() => {
    setTourOpen(shouldShowWelcomeTour());
    try {
      if (!localStorage.getItem("folio_vip_onboarding_shown")) {
        setVipOnboardingOpen(true);
        localStorage.setItem("folio_vip_onboarding_shown", "true");
      }
    } catch {}
  }, []);

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
                to="/projects"
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                    isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <FolderKanban className="h-3.5 w-3.5" />
                  Projects
                </span>
              </NavLink>
              <NavLink
                to="/calendar"
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                    isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  Deadlines
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
              <NavLink
                to="/agent-desk"
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                    isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                  )
                }
              >
                <span className="inline-flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5" />
                  Agent Desk
                </span>
              </NavLink>
              {isOwner ? (
                <>
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
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      cn(
                        "rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
                        isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                      )
                    }
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Brain className="h-3.5 w-3.5" />
                      AI Rules Desk
                    </span>
                  </NavLink>
                </>
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
            <button
              onClick={() => setVipOnboardingOpen(true)}
              className="hidden items-center gap-1.5 rounded-full border border-emerald-400 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 sm:inline-flex transition-colors"
              title="VIP Practice Concierge & Launchpad"
            >
              <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              VIP Concierge
            </button>
            <button
              onClick={() => setSupportModalOpen(true)}
              className="hidden items-center gap-1.5 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 sm:inline-flex transition-colors"
            >
              <Headphones className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              Reach out to Team
            </button>
            <button
              onClick={() => setFeatureRequestOpen(true)}
              className="hidden items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 sm:inline-flex transition-colors"
            >
              <Lightbulb className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              Request Feature
            </button>
            <button onClick={() => setTourOpen(true)} className="hidden items-center gap-1.5 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] sm:inline-flex"><Map className="h-3.5 w-3.5" /> Guide</button>
            {typeof daysLeft === "number" ? (
              <span
                className="hidden items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-muted-foreground)] tracking-tight sm:inline-flex"
                title={`Beta access: ${daysLeft} days remaining on server clock`}
              >
                <Clock className="h-3 w-3 text-[var(--color-muted-foreground)]" />
                {daysLeft === 1 ? "1 day left" : `${daysLeft} days left`}
              </span>
            ) : null}
            <span className="text-sm text-[var(--color-muted-foreground)]">{userName}</span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <div className="pt-3"><PwaInstallBanner /></div>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 sm:px-6 sm:py-8">
        <Outlet />
      </main>
      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)]/95 p-1 shadow-lg backdrop-blur sm:hidden" aria-label="Primary navigation">
        {[
          { to: "/", label: "Operations", icon: LayoutDashboard, end: true },
          { to: "/clients", label: "Clients", icon: Users },
          { to: "/projects", label: "Projects", icon: FolderKanban },
          { to: "/work-queue", label: "Work queue", icon: ClipboardList },
          { to: "/agent-desk", label: "Agent desk", icon: Bot },
        ].map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => cn("flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-medium text-[var(--color-muted-foreground)]", isActive && "bg-[#14201c] text-white")}><Icon className="h-4 w-4" />{label}</NavLink>)}
      </nav>
      <WelcomeTour forceOpen={tourOpen} onClose={() => setTourOpen(false)} />
      <FeatureRequestModal
        isOpen={featureRequestOpen}
        onClose={() => setFeatureRequestOpen(false)}
      />
      <SupportConciergeModal
        isOpen={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
      />
      <VipOnboardingModal
        isOpen={vipOnboardingOpen}
        onClose={() => setVipOnboardingOpen(false)}
        userName={userName}
        firmName={firmName}
        onOpenImport={() => setAccountingImportOpen(true)}
        onOpenMobileLink={() => navigate("/clients")}
        onOpenDictation={() => setVoiceModalOpen(true)}
      />
      <AccountingImportModal
        isOpen={accountingImportOpen}
        onClose={() => setAccountingImportOpen(false)}
        onSuccess={() => navigate("/clients")}
      />
      <VoiceRuleDictationModal
        isOpen={voiceModalOpen}
        onClose={() => setVoiceModalOpen(false)}
      />
    </div>
  );
}
