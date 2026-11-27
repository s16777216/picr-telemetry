import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPage } from './AgentPage.tsx';
import { parseRoute, type Route } from './model.ts';
import { RunPage } from './RunPage.tsx';
import { RunsPage } from './RunsPage.tsx';
import './styles.css';

/** Shows the page of the hash address (`#runs`, `#run-<id>`, `#agent-<id>-<span>`). */
function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#runs">
          picr <span>Telemetry</span>
        </a>
        <span className="topbar-note">review 執行紀錄</span>
      </header>
      <main className="content">
        {route.page === 'runs' && <RunsPage />}
        {route.page === 'run' && <RunPage key={route.traceId} traceId={route.traceId} />}
        {route.page === 'agent' && (
          <AgentPage key={`${route.traceId}-${route.spanId}`} traceId={route.traceId} spanId={route.spanId} />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
