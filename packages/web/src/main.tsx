import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app.tsx';
import { StoreContext } from './app/hooks.ts';
import { TokenScreen } from './app/token-screen.tsx';
import { createApi } from './client/api.ts';
import { ConsoleStore } from './client/store.ts';
import { forgetToken, loadToken, saveToken } from './client/token.ts';
import './styles/index.css';

function Connected({ token, onRejected }: { token: string; onRejected: () => void }) {
  const store = useMemo(() => new ConsoleStore(createApi(token)), [token]);
  const connection = useSyncExternalStore(store.subscribe, () => store.getState().connection);
  useEffect(() => { store.start(); return () => { store.stop(); }; }, [store]);
  useEffect(() => { if (connection === 'unauthorized') onRejected(); }, [connection, onRejected]);
  return <StoreContext.Provider value={store}><App /></StoreContext.Provider>;
}

function Root() {
  const initial = useMemo(() => loadToken(sessionStorage, window.location.hash), []);
  const [token, setToken] = useState(initial.token);
  const [rejected, setRejected] = useState(false);
  useEffect(() => { if (initial.cleanHash !== window.location.hash) history.replaceState(null, '', `${window.location.pathname}${initial.cleanHash}`); }, [initial]);
  if (token === null) return <TokenScreen rejected={rejected} onToken={value => { saveToken(sessionStorage, value); setRejected(false); setToken(value); }} />;
  return <Connected token={token} onRejected={() => { forgetToken(sessionStorage); setRejected(true); setToken(null); }} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(<StrictMode><Root /></StrictMode>);
