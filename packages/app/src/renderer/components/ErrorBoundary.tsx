import { Component, type ReactNode } from 'react';

/**
 * Catches render-time errors so a crash shows a readable message instead of a black
 * screen (React unmounts the whole tree on an uncaught render throw). Note: this does
 * NOT catch errors thrown in event handlers — only render/lifecycle.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: unknown) { console.error('Render error:', error, info); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash__title">⚠ Something went wrong</div>
        <pre className="crash__msg">{error.message}{'\n\n'}{error.stack}</pre>
        <button className="btn btn--accent" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
