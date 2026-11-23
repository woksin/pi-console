import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type { Spawn } from './gh-process.ts';

export interface FakeBehaviour {
  stdout?: string; stderr?: string; code?: number | null; error?: boolean;
  /** Never exits on SIGTERM; with `unkillable` not on SIGKILL either. */
  ignoreTerm?: boolean; unkillable?: boolean; hang?: boolean;
}
export interface Call { command: string; args: readonly string[]; options: unknown; signals: string[] }

const survives = (script: FakeBehaviour, signal: NodeJS.Signals): boolean => script.unkillable === true || (script.ignoreTerm === true && signal === 'SIGTERM');

function play(script: FakeBehaviour, child: EventEmitter, stdout: PassThrough, stderr: PassThrough): void {
  if (script.error) { child.emit('error', new Error('ENOENT')); return; }
  if (script.stdout) stdout.write(script.stdout);
  if (script.stderr) stderr.write(script.stderr);
  const stays = [script.hang, script.ignoreTerm, script.unkillable].some(Boolean);
  if (!stays) child.emit('close', script.code ?? 0);
}

/** A scripted `gh`: no process is ever started. */
export function fakeSpawn(behaviour: FakeBehaviour | ((call: Call) => FakeBehaviour)): { spawn: Spawn; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: Spawn = (command, args, options) => {
    const call: Call = { command, args, options, signals: [] };
    calls.push(call);
    const script = typeof behaviour === 'function' ? behaviour(call) : behaviour;
    const child = new EventEmitter() as unknown as ChildProcess & EventEmitter;
    const stdout = new PassThrough(), stderr = new PassThrough();
    Object.assign(child, { stdout, stderr, kill: (signal: NodeJS.Signals) => {
      call.signals.push(signal);
      if (survives(script, signal)) return true;
      setImmediate(() => child.emit('close', null));
      return true;
    } });
    setImmediate(() => { play(script, child, stdout, stderr); });
    return child;
  };
  return { spawn, calls };
}
