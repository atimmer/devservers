import React from "react";

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-[#090d12] p-8 text-slate-100">
        <div>
          <h1 className="text-xl font-semibold">Something went wrong.</h1>
          {import.meta.env.DEV ? (
            <pre className="mt-4 max-w-3xl whitespace-pre-wrap font-mono text-xs text-rose-200">
              {this.state.error.stack}
            </pre>
          ) : null}
        </div>
      </main>
    );
  }
}
