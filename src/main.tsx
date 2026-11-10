import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeSettings } from "./providers/credentials";
import { initializeAppearance } from "./appearance";
import "./style.css";
initializeAppearance();
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="empty">
        <h1>The workspace could not open</h1>
        <p>
          Your local data has not been deleted. Reload to try again; avoid
          clearing browser data before backing up your meetings.
        </p>
        <button onClick={() => location.reload()}>Reload workspace</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <main className="empty" role="status">
    <h1>Opening your workspace…</h1>
    <p>Loading settings saved on this device.</p>
  </main>,
);
void initializeSettings().then(() =>
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  ),
);
