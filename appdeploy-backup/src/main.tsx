import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Rene Social Hub failed to render:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '64px auto', padding: 24, color: '#1e293b' }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Rene Social Hub needs a quick fix</h1>
          <p style={{ marginTop: 12, lineHeight: 1.6 }}>The page opened, but one part of the workspace failed to load. Please refresh once in a moment. The error has been logged so it can be diagnosed.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>
  );
} else {
  document.body.innerHTML = '<main style="font-family:system-ui,sans-serif;padding:32px">Rene Social Hub could not find its page container. Please contact support.</main>';
}
