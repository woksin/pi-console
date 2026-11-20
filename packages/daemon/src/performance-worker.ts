// Child process used only by the synthetic performance integration specs. Keeping fixture generation and the cold
// run out of the measured process avoids counting their transient allocations as warm idle daemon memory.
import { loadConfig } from './config.ts';
import { startDaemon } from './daemon.ts';

const [agentRoot, dataDir] = process.argv.slice(2);
if (!agentRoot || !dataDir || !process.send) throw new Error('Performance worker requires roots and an IPC channel');
const daemon = await startDaemon(loadConfig(dataDir, {
  port: 0, agentRoot, orchRoot: `${agentRoot}/orch`, sessionRoots: [`${agentRoot}/sessions`], pollMs: 1_000, sourcePollMs: 250,
}));
process.send({ port: daemon.port, startupMs: daemon.startupMs });
process.once('message', () => {
  void daemon.close().then(() => { process.disconnect?.(); });
});
