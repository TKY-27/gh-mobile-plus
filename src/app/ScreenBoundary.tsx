import { Component, type ReactNode } from "react";
import { useT } from "@/i18n/index.tsx";
import { ErrorState } from "@/ui/ErrorState.tsx";
import { Page } from "./Page.tsx";

const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof TypeError && CHUNK_LOAD_ERROR.test(error.message);
}

function ScreenCrash(props: { error: unknown; onRetry: () => void }) {
  const t = useT();
  return (
    <Page title={t("app.screenError")}>
      <ErrorState error={props.error} onRetry={props.onRetry} fullScreen />
    </Page>
  );
}

type BoundaryState = { failed: false } | { failed: true; error: unknown };

export class ScreenBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { failed: true, error };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <ScreenCrash
        error={this.state.error}
        onRetry={() => {
          // Reload clears cached import failures.
          if (isChunkLoadError(this.state.failed && this.state.error)) window.location.reload();
          else this.setState({ failed: false });
        }}
      />
    );
  }
}
