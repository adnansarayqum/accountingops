import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface State {
  error?: Error;
}

/** Never fail silently: explain what failed and offer a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="card max-w-md w-full p-6 text-center">
          <div className="mx-auto h-10 w-10 rounded-full bg-red-50 text-red-600 flex items-center justify-center mb-3">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h1 className="text-base font-semibold text-slate-900">Something went wrong on this screen</h1>
          <p className="text-sm text-slate-600 mt-1">Your data has not been lost. Reload the page to continue.</p>
          <pre className="mt-3 text-left text-xs text-slate-500 bg-slate-50 rounded p-2 overflow-auto max-h-32">{this.state.error.message}</pre>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 inline-flex h-9 items-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700">
            Reload
          </button>
        </div>
      </div>
    );
  }
}
