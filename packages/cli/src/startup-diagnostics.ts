import { directoryDiagnostics, isProblem, type DaemonConfig, type DirectoryDiagnostic } from '@pi-console/daemon';

export interface StartupDiagnostics { lines: string[]; warnings: string[] }

/** One line per path: a control character in a configured path must not drive the terminal. */
const printable = (path: string): string =>
  // eslint-disable-next-line no-control-regex
  path.replace(/[\u0000-\u001f\u007f-\u009f]/g, character => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`);

const label = (diagnostic: DirectoryDiagnostic): string => (diagnostic.owner === 'agent-root' ? 'Agent root' : `Source ${diagnostic.owner}`);

function warningFor(path: string, state: 'missing' | 'unavailable', owners: string[]): string {
  const where = `${printable(path)} (${owners.join(', ')})`;
  return state === 'missing'
    ? `Warning: missing directory ${where}. Check --agent-root / configured source directories, or create the intended directory; ingestion retries automatically.`
    : `Warning: unavailable directory ${where}. Check that the path is a readable directory; ingestion retries automatically.`;
}

/** Resolved locations and a warning per missing or unavailable enabled path (shared paths once, with every owner). Deterministic and read-only. */
export function formatDiagnostics(diagnostics: readonly DirectoryDiagnostic[]): StartupDiagnostics {
  const lines = diagnostics.map(item => `${label(item)}: ${printable(item.path)} [${item.state}]`);
  const grouped = new Map<string, { path: string; state: 'missing' | 'unavailable'; owners: string[] }>();
  for (const { owner, path, state } of diagnostics) {
    if (!isProblem(state)) continue;
    const entry = grouped.get(`${state}\0${path}`) ?? { path, state: state as 'missing' | 'unavailable', owners: [] };
    entry.owners.push(owner === 'agent-root' ? 'agent root' : owner);
    grouped.set(`${state}\0${path}`, entry);
  }
  return { lines, warnings: [...grouped.values()].map(entry => warningFor(entry.path, entry.state, entry.owners)) };
}

/** Prints where the daemon reads from. Never reads contents and never creates a directory. */
export function printStartupDiagnostics(config: DaemonConfig, out: (line: string) => void, warn: (line: string) => void): void {
  const { lines, warnings } = formatDiagnostics(directoryDiagnostics(config));
  lines.forEach(out);
  warnings.forEach(warn);
}
