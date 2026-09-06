import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type WorkspaceClient = { id: string; name: string };

type WorkspaceContextValue = {
  client: WorkspaceClient | null;
  setClient: (client: WorkspaceClient | null) => void;
  currentPeriod: string | null;
  setCurrentPeriod: (period: string | null) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<WorkspaceClient | null>(null);
  const [currentPeriod, setCurrentPeriod] = useState<string | null>(null);

  const value = useMemo(
    () => ({ client, setClient, currentPeriod, setCurrentPeriod }),
    [client, currentPeriod],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
