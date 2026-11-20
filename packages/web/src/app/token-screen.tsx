import { useState } from 'react';
import { isPlausibleToken } from '../client/token.ts';

export function TokenScreen({ rejected, onToken }: { rejected: boolean; onToken: (token: string) => void }) {
  const [value, setValue] = useState('');
  const valid = isPlausibleToken(value.trim());
  return (
    <main className="token-screen">
      <form className="dialog token" onSubmit={event => { event.preventDefault(); if (valid) onToken(value.trim()); }}>
        <div className="logo big" aria-hidden="true">π</div>
        <h1>{rejected ? 'That token was not accepted' : 'Connect to the daemon'}</h1>
        <p className="muted">{rejected ? 'The daemon rejected the token. Check that it matches the one in your data directory, then try again.' : 'Paste the access token printed by the daemon, or open the launch link it prints. The token stays in this tab only.'}</p>
        <label>Access token
          <input type="password" autoComplete="off" spellCheck={false} autoFocus value={value} onChange={event => { setValue(event.target.value); }} aria-invalid={rejected} />
        </label>
        <button type="submit" className="btn primary" disabled={!valid}>Connect</button>
        <p className="muted small">First run: start the daemon, then run <code>pi-console open</code> to get the link.</p>
      </form>
    </main>
  );
}
