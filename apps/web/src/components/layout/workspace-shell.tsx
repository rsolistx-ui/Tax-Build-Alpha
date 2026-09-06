import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  Home,
  Users,
  Inbox,
  FileText,
  Landmark,
  FileSpreadsheet,
  BookOpen,
  BarChart3,
  FileCheck,
  FolderOpen,
  Settings,
  LogOut,
  Building2,
  ChevronLeft,
  AlertTriangle,
  Clock,
  Tag,
  FileText as FileTextIcon,
  Lock,
  Unlock,
} from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useWorkspace } from "@/lib/workspace-context";

const NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home, href: "/" },
  { id: "clients", label: "Clients", icon: Users, href: "/clients" },
  { id: "inbox", label: "Inbox", icon: Inbox, href: "/inbox" },
  { id: "receipts", label: "Receipts", icon: FileText, href: "/receipts" },
  { id: "banking", label: "Banking", icon: Landmark, href: "/banking" },
  { id: "transactions", label: "Transactions", icon: FileSpreadsheet, href: "/transactions" },
  { id: "books", label: "Books", icon: BookOpen, href: "/books" },
  { id: "reports", label: "Reports", icon: BarChart3, href: "/reports" },
  { id: "tax", label: "Tax", icon: FileCheck, href: "/tax" },
  { id: "documents", label: "Documents", icon: FolderOpen, href: "/documents" },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings" },
];

const CLIENT_NAV_ITEMS = [
  { id: "transactions", label: "Transactions", icon: FileSpreadsheet, href: "" },
  { id: "receipts", label: "Receipts", icon: FileText, href: "receipts" },
  { id: "banking", label: "Banking", icon: Landmark, href: "banking" },
  { id: "books", label: "Books", icon: BookOpen, href: "books" },
  { id: "reports", label: "Reports", icon: BarChart3, href: "reports" },
  { id: "tax", label: "Tax", icon: FileCheck, href: "tax" },
  { id: "documents", label: "Documents", icon: FolderOpen, href: "documents" },
];

// Only routes that actually exist are wired. Future sections are shown disabled,
// never as links to nowhere.
const REAL_GLOBAL_ROUTES = new Set(["/"]);
const REAL_CLIENT_ROUTES = new Set(["", "receipts", "banking", "reports"]);

function isRealRoute(item: { href: string }, clientScope: boolean): boolean {
  return clientScope ? REAL_CLIENT_ROUTES.has(item.href) : REAL_GLOBAL_ROUTES.has(item.href);
}

function clientHref(clientId: string, href: string): string {
  return href ? `/clients/${clientId}/${href}` : `/clients/${clientId}`;
}

function isClientRoot(href: string): boolean {
  return href === "";
}

export function WorkspaceShell({
  firmName,
  userName,
}: {
  firmName?: string;
  userName?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { client, currentPeriod, onPeriodChange } = useWorkspace();

  async function signOut() {
    await authClient.signOut();
    navigate("/login");
  }

  const isClientRoute = location.pathname.startsWith("/clients/");

  return (
    <div className="min-h-full bg-[var(--color-background)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-card)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-card)]/80">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle navigation"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </Button>

            <Link
              to={isClientRoute ? "/" : "/"}
              className="flex items-center gap-2 font-semibold tracking-tight text-[var(--color-foreground)] hover:opacity-80"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-primary)] text-xs text-white">
                F
              </span>
              Folio
            </Link>

            <nav className="hidden md:flex items-center gap-1 overflow-x-auto pb-1 pr-4">
              {NAV_ITEMS.map((item) =>
                isRealRoute(item, false) ? (
                  <NavLink
                    key={item.id}
                    to={item.href}
                    end={item.id === "home"}
                    className={({ isActive }) =>
                      cn(
                        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors",
                        isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)]",
                      )
                    }
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </NavLink>
                ) : (
                  <span
                    key={item.id}
                    aria-disabled="true"
                    title="Not part of this milestone"
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm opacity-40 cursor-not-allowed"
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                ),
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <Input
                placeholder="Search ships in a later milestone"
                disabled
                className="w-64 h-8 text-sm bg-[var(--color-background)] border-[var(--color-border)]"
              />
            </div>

            {client && (
              <div className="hidden lg:flex items-center gap-3 border-l border-[var(--color-border)] pl-3">
                <div className="flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)]">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="font-medium text-[var(--color-foreground)]">{client.name}</span>
                </div>

                <Select value={currentPeriod || ""} onValueChange={onPeriodChange}>
                  <SelectTrigger className="w-[140px] h-8 text-xs">
                    <SelectValue placeholder="Period" />
                  </SelectTrigger>
                  <SelectContent>
                    {generatePeriodOptions().map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="hidden sm:flex items-center gap-2">
              {firmName ? (
                <span className="text-xs text-[var(--color-muted-foreground)]">{firmName}</span>
              ) : null}
              <span className="text-sm text-[var(--color-muted-foreground)]">{userName}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="User menu">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={signOut} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 transform border-r border-[var(--color-border)] bg-[var(--color-card)] transition-transform duration-200 ease-in-out lg:relative lg:translate-x-0 lg:z-auto",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <nav className="flex h-full flex-col p-4" aria-label="Main navigation">
            <div className="flex flex-col gap-1">
              {isClientRoute && client
                ? CLIENT_NAV_ITEMS.map((item) =>
                    isRealRoute(item, true) ? (
                      <NavLink
                        key={item.id}
                        to={clientHref(client.id, item.href)}
                        end={isClientRoot(item.href)}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors",
                            isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)] font-medium",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        {item.label}
                      </NavLink>
                    ) : (
                      <span
                        key={item.id}
                        aria-disabled="true"
                        title="Not part of this milestone"
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm opacity-40 cursor-not-allowed"
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        {item.label}
                      </span>
                    ),
                  )
                : NAV_ITEMS.map((item) =>
                    isRealRoute(item, false) ? (
                      <NavLink
                        key={item.id}
                        to={item.href}
                        end={item.id === "home"}
                        className={({ isActive }) =>
                          cn(
                            "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors",
                            isActive && "bg-[var(--color-muted)] text-[var(--color-foreground)] font-medium",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        {item.label}
                      </NavLink>
                    ) : (
                      <span
                        key={item.id}
                        aria-disabled="true"
                        title="Not part of this milestone"
                        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm opacity-40 cursor-not-allowed"
                      >
                        <item.icon className="h-4 w-4 flex-shrink-0" />
                        {item.label}
                      </span>
                    ),
                  )}
            </div>

            <div className="mt-auto pt-4 border-t border-[var(--color-border)]">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-start gap-2">
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={signOut} className="text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </nav>
        </aside>

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <main className="flex-1 min-w-0 mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:max-w-full lg:mx-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function generatePeriodOptions(): string[] {
  const now = new Date();
  const options: string[] = [];
  for (let i = 0; i < 24; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    options.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return options;
}

export function ClientWorkspaceHeader({
  client,
  currentPeriod,
  onPeriodChange,
  statusSummary,
  periodState,
  onClosePeriod,
  onReopenPeriod,
}: {
  client: { id: string; name: string };
  currentPeriod?: string;
  onPeriodChange?: (period: string) => void;
  statusSummary?: {
    openExceptions: number;
    pendingReceipts: number;
    uncategorized: number;
    reviewItems: number;
    needsReview: number;
  };
  periodState?: { state: "open" | "closed"; canClose: boolean } | null;
  onClosePeriod?: () => void;
  onReopenPeriod?: () => void;
}) {
  return (
    <div className="mb-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All clients
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Evidence-first bookkeeping · canonical ledger · auditable periods
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={currentPeriod || ""} onValueChange={onPeriodChange || (() => {})}>
            <SelectTrigger className="w-[160px] h-9 text-sm">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {generatePeriodOptions().map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusSummary && (
            <div className="flex items-center gap-2 text-xs">
              {statusSummary.openExceptions > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {statusSummary.openExceptions} exceptions
                </Badge>
              )}
              {statusSummary.pendingReceipts > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {statusSummary.pendingReceipts} pending
                </Badge>
              )}
              {statusSummary.uncategorized > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-2.5 w-2.5" />
                  {statusSummary.uncategorized} uncategorized
                </Badge>
              )}
              {statusSummary.reviewItems > 0 && (
                <Badge variant="default" className="gap-1">
                  <FileTextIcon className="h-2.5 w-2.5" />
                  {statusSummary.reviewItems} in review
                </Badge>
              )}
              {statusSummary.needsReview > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {statusSummary.needsReview} need review
                </Badge>
              )}
            </div>
          )}
          {periodState && (
            <div className="flex items-center gap-2">
              {periodState.state === "closed" ? (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="h-2.5 w-2.5" />
                  Period closed
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <Unlock className="h-2.5 w-2.5" />
                  Period open
                </Badge>
              )}
              {periodState.state === "open" ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!periodState.canClose}
                  title={periodState.canClose ? undefined : "Resolve open items below before closing"}
                  onClick={onClosePeriod}
                >
                  Close period
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={onReopenPeriod}>
                  Reopen period
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-1" aria-label="Client workspace sections">
        {CLIENT_NAV_ITEMS.map((item) =>
          isRealRoute(item, true) ? (
            <NavLink
              key={item.id}
              to={clientHref(client.id, item.href)}
              end={isClientRoot(item.href)}
              className={({ isActive }) =>
                cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors",
                  isActive && "bg-[var(--color-muted)] font-medium text-[var(--color-foreground)]",
                )
              }
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </NavLink>
          ) : (
            <span
              key={item.id}
              aria-disabled="true"
              title="Not part of this milestone"
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm opacity-40 cursor-not-allowed"
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.label}
            </span>
          ),
        )}
      </nav>
    </div>
  );
}

