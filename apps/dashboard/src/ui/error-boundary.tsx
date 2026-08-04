import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Override the default fallback; receives the error and a retry callback. */
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The dashboard's only error boundary — turns an uncaught render exception
 * from a blank route into a recoverable message. Class component because
 * React still requires it for boundaries.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // biome-ignore lint/suspicious/noConsole: error boundaries must surface caught errors for diagnosis
    console.error("ErrorBoundary caught a render error", error, info);
  }

  retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.retry);
      }
      return <ErrorFallback error={this.state.error} retry={this.retry} />;
    }
    return this.props.children;
  }
}

export const ErrorFallback = ({ error, retry }: { error: Error; retry: () => void }) => (
  <Empty role="alert" data-testid="error-boundary-fallback" className="flex-1 py-16">
    <EmptyHeader>
      <EmptyTitle>Something went wrong</EmptyTitle>
      <EmptyDescription>
        {error.message || "An unexpected error occurred while rendering this view."}
      </EmptyDescription>
    </EmptyHeader>
    <EmptyContent className="flex-row justify-center">
      <Button variant="secondary" size="sm" onClick={retry}>
        Try again
      </Button>
      <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </EmptyContent>
  </Empty>
);
