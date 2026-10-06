import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class PlayUpErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erreur inattendue lors du rendu de l’interface.'
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[PlayUp Runtime ErrorBoundary]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white text-slate-900 flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-xl space-y-5 text-center">
            <div className="w-12 h-12 rounded-2xl bg-orange-600 text-white font-black text-xl flex items-center justify-center mx-auto">
              P
            </div>
            <div className="space-y-2">
              <h1 className="font-display text-xl font-bold text-slate-900">
                PlayUp Reseller — Interface de récupération
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                Un composant a rencontré une interruption temporaire. Vos données et votre session sont préservées.
              </p>
            </div>
            {this.state.errorMessage && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono text-slate-600 text-left break-words">
                {this.state.errorMessage}
              </div>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs rounded-xl transition-colors"
            >
              Recharger l’application PlayUp
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <PlayUpErrorBoundary>
      <App />
    </PlayUpErrorBoundary>
  );
}
