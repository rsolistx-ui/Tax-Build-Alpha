import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Search,
  Scale,
  Sparkles,
  Network,
  Users,
  ListChecks,
  Building2,
  Landmark,
  LineChart,
  FileSpreadsheet,
  Mic,
  Smartphone,
  Headphones,
  Upload,
  Command,
  CornerDownLeft,
} from "lucide-react";
import { api } from "@/lib/api";

interface ClientItem {
  id: string;
  name: string;
  legal_name?: string | null;
}

interface PaletteAction {
  id: string;
  title: string;
  category: "Client Navigation" | "Tax & Audit Engines" | "Quick Actions" | "System";
  icon: any;
  shortcutHint?: string;
  run: () => void;
}

export function UniversalCommandPalette({
  isOpen,
  onClose,
  onOpenVoiceModal,
  onOpenMobileModal,
  onOpenSupportModal,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpenVoiceModal?: () => void;
  onOpenMobileModal?: () => void;
  onOpenSupportModal?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Extract current clientId if in client workspace
  const currentClientId = useMemo(() => {
    const match = location.pathname.match(/\/clients\/([^\/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);

  // Load clients
  useEffect(() => {
    if (isOpen) {
      api<{ clients: ClientItem[] }>("/api/clients")
        .then((res) => setClients(res.clients || []))
        .catch(() => {});
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const actions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [];

    // Client Navigations
    for (const c of clients) {
      list.push({
        id: `client_${c.id}`,
        title: `${c.name}${c.legal_name ? ` (${c.legal_name})` : ""}`,
        category: "Client Navigation",
        icon: Building2,
        run: () => {
          navigate(`/clients/${c.id}`);
          onClose();
        },
      });
    }

    // Contextual actions if currently inside a client workspace
    if (currentClientId) {
      list.push(
        {
          id: "goto_dif_audit",
          title: "Run pre-filing risk review",
          category: "Tax & Audit Engines",
          icon: Scale,
          shortcutHint: "Shield",
          run: () => {
            navigate(`/clients/${currentClientId}?tab=dif-audit`);
            onClose();
          },
        },
        {
          id: "goto_advisory",
          title: "Generate Executive Tax Advisory Strategy Roadmap",
          category: "Tax & Audit Engines",
          icon: Sparkles,
          shortcutHint: "Advisory",
          run: () => {
            navigate(`/clients/${currentClientId}?tab=advisory`);
            onClose();
          },
        },
        {
          id: "goto_intercompany",
          title: "Reconcile Multi-Entity Intercompany Mirror Transfers",
          category: "Tax & Audit Engines",
          icon: Network,
          shortcutHint: "Mirror",
          run: () => {
            navigate(`/clients/${currentClientId}?tab=intercompany`);
            onClose();
          },
        },
        {
          id: "goto_bank",
          title: "Open Bank Reconciliation Ledger",
          category: "Quick Actions",
          icon: Landmark,
          run: () => {
            navigate(`/clients/${currentClientId}?tab=bank`);
            onClose();
          },
        },
        {
          id: "goto_pnl",
          title: "View Canonical Operating P&L Report",
          category: "Quick Actions",
          icon: LineChart,
          run: () => {
            navigate(`/clients/${currentClientId}?tab=pnl`);
            onClose();
          },
        },
        {
          id: "goto_workpaper",
          title: "Open Tax Workpaper & Diagnostics",
          category: "Quick Actions",
          icon: FileSpreadsheet,
          run: () => {
            navigate(`/clients/${currentClientId}?tab=workpaper`);
            onClose();
          },
        },
        {
          id: "goto_upload",
          title: "Upload New Receipts & Statement Documents",
          category: "Quick Actions",
          icon: Upload,
          run: () => {
            navigate(`/clients/${currentClientId}?tab=upload`);
            onClose();
          },
        }
      );
    }

    // Global System Actions
    list.push(
      {
        id: "all_clients",
        title: "All Clients Directory",
        category: "Quick Actions",
        icon: Users,
        run: () => {
          navigate("/clients");
          onClose();
        },
      },
      {
        id: "tax_workbench",
        title: "Tax Workbench",
        category: "Quick Actions",
        icon: ListChecks,
        run: () => {
          navigate("/workbench");
          onClose();
        },
      },
      {
        id: "dictate_ai_directive",
        title: "Dictate AI Categorization Directive (Voice)",
        category: "Quick Actions",
        icon: Mic,
        shortcutHint: "Voice",
        run: () => {
          onClose();
          onOpenVoiceModal?.();
        },
      },
      {
        id: "magic_phone_link",
        title: "Launch Magic Phone Upload QR Link",
        category: "Quick Actions",
        icon: Smartphone,
        run: () => {
          onClose();
          onOpenMobileModal?.();
        },
      },
      {
        id: "support_concierge",
        title: "Connect with Phyllis VIP Concierge Support",
        category: "System",
        icon: Headphones,
        run: () => {
          onClose();
          onOpenSupportModal?.();
        },
      }
    );

    return list;
  }, [clients, currentClientId, navigate, onClose, onOpenVoiceModal, onOpenMobileModal, onOpenSupportModal]);

  // Filter actions based on search query
  const filteredActions = useMemo(() => {
    if (!query.trim()) return actions.slice(0, 20);
    const q = query.toLowerCase();
    return actions
      .filter((a) => a.title.toLowerCase().includes(q) || a.category.toLowerCase().includes(q))
      .slice(0, 25);
  }, [actions, query]);

  // Handle keyboard navigation inside the palette
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1 < filteredActions.length ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : filteredActions.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredActions[selectedIndex]) {
          filteredActions[selectedIndex].run();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredActions, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 pt-[12vh]">
      <div
        className="w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-2xl overflow-hidden flex flex-col max-h-[70vh] animate-in fade-in zoom-in-95 duration-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-muted)]/30">
          <Search className="h-4 w-4 text-[var(--color-muted-foreground)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a client, tax engine, or action command... (e.g. 'DIF', 'Advisory', 'Acme')"
            className="flex-1 bg-transparent text-sm text-[var(--color-foreground)] placeholder-[var(--color-muted-foreground)] focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted-foreground)]">
            ESC to close
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredActions.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-muted-foreground)]">
              No matching client or command found for "{query}".
            </div>
          ) : (
            filteredActions.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = action.icon;

              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.run}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-xs transition-colors ${
                    isSelected
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-medium shadow-sm"
                      : "text-[var(--color-foreground)] hover:bg-[var(--color-muted)]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`p-1.5 rounded-md ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="truncate">{action.title}</span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {action.shortcutHint && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          isSelected ? "bg-white/20 text-white" : "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"
                        }`}
                      >
                        {action.shortcutHint}
                      </span>
                    )}
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold ${
                        isSelected ? "text-[var(--color-primary-foreground)]/80" : "text-[var(--color-muted-foreground)]"
                      }`}
                    >
                      {action.category}
                    </span>
                    {isSelected && <CornerDownLeft className="h-3 w-3 text-white" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div className="border-t border-[var(--color-border)] bg-[var(--color-muted)]/40 px-4 py-2 flex items-center justify-between text-[11px] text-[var(--color-muted-foreground)]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1 py-0.2 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1 py-0.2 font-mono text-[10px]">↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1 py-0.2 font-mono text-[10px]">↵</kbd>
              Execute
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1 py-0.2 font-mono text-[10px]">ESC</kbd>
              Close
            </span>
          </div>
          <span className="font-semibold text-[var(--color-primary)] flex items-center gap-1">
            <Command className="h-3 w-3" /> Truepost Warp Speed
          </span>
        </div>
      </div>
    </div>
  );
}
