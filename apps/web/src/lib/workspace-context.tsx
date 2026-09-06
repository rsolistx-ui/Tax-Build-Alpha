import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type WorkspaceClient = { id: string; name: string };

type WorkspaceContextValue = {
  client: WorkspaceClient | null;
  setClient: (client: WorkspaceClient | null) => void;
  currentPeriod: string | null;
  setCurrentPeriod: (period: string | null) => void;
  /**
   * Changes the current period through whichever page is mounted. Pages that
   * need more than the raw state update (URL sync, reloading a period
   * summary) register their own handler via setOnPeriodChange; the shell
   * calls this instead of setCurrentPeriod directly so it never bypasses
   * that page-level logic.
   */
  onPeriodChange: (period: string) => void;
  setOnPeriodChange: (handler: ((period: string) => void) | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<WorkspaceClient | null>(null);
  const [currentPeriod, setCurrentPeriod] = useState<string | null>(null);
  const periodChangeHandlerRef = useRef<((period: string) => void) | null>(null);

  const setOnPeriodChange = useCallback((handler: ((period: string) => void) | null) => {
    periodChangeHandlerRef.current = handler;
  }, []);

  const onPeriodChange = useCallback(
    (period: string) => {
      if (periodChangeHandlerRef.current) {
        periodChangeHandlerRef.current(period);
      } else {
        setCurrentPeriod(period);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ client, setClient, currentPeriod, setCurrentPeriod, onPeriodChange, setOnPeriodChange }),
    [client, currentPeriod, onPeriodChange, setOnPeriodChange],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
