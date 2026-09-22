import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode };
type State = { error: Error | null };

function isStaleChunk(error: Error): boolean {
  return /failed to fetch dynamically imported module|importing a module script failed|chunkloaderror/i.test(error.message);
}

/** Recover once from the normal cache/update race created by code-split PWAs. */
export class ChunkLoadRecovery extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (!isStaleChunk(error)) return;
    const reloadKey = "truepost-chunk-recovery";
    if (!sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-6">
        <section className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Workspace update ready</h1>
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">Your browser needs a fresh copy of the latest Truepost workspace. Your work remains safely stored.</p>
          <Button className="mt-5" onClick={() => window.location.reload()}>Refresh workspace</Button>
        </section>
      </main>
    );
  }
}
