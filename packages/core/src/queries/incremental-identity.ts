import type { ReadModels } from '../projections/index.ts';
import type { LaneModel } from '../projections/lanes.ts';
import { rowOf } from './keyed-queue.ts';
import { normalizedCwd } from './session-identity.ts';

/** Reverse dependencies let lane changes invalidate old/new cwd owners without scanning the fleet. */
export class IdentityDependencies {
  readonly lanes = new Map<string, Map<string, LaneModel>>();
  readonly #laneCwds = new Map<string, string>();
  readonly #sessionCwds = new Map<string, string>();
  readonly #owners = new Map<string, Set<string>>();

  constructor(models: ReadModels) {
    for (const id of Object.keys(models.lanes.lanes)) this.#lane(models, id);
    for (const id of Object.keys(models.sessions.sessions)) this.#session(models, id);
  }

  update(models: ReadModels, sessions: ReadonlySet<string>, lanes: ReadonlySet<string>): Set<string> {
    const affected = new Set<string>();
    for (const id of sessions) this.#session(models, id);
    for (const id of lanes) {
      const old = this.#laneCwds.get(id);
      const next = this.#lane(models, id);
      for (const cwd of [old, next]) {
        for (const owner of this.#owners.get(cwd ?? '') ?? []) affected.add(owner);
      }
    }
    return affected;
  }

  #session(models: ReadModels, id: string): void {
    const old = this.#sessionCwds.get(id);
    if (old !== undefined) this.#owners.get(old)?.delete(id);
    this.#sessionCwds.delete(id);
    const row = rowOf(models.sessions.sessions, id);
    if (!row) return;
    const cwd = normalizedCwd(row.cwd);
    if (!cwd) return;
    const owners = this.#owners.get(cwd) ?? new Set();
    owners.add(id);
    this.#owners.set(cwd, owners);
    this.#sessionCwds.set(id, cwd);
  }

  #lane(models: ReadModels, id: string): string | undefined {
    const old = this.#laneCwds.get(id);
    if (old !== undefined) this.lanes.get(old)?.delete(id);
    this.#laneCwds.delete(id);
    const row = rowOf(models.lanes.lanes, id);
    if (!row) return;
    const cwd = normalizedCwd(row.cwd ?? '');
    if (!cwd) return;
    const matches = this.lanes.get(cwd) ?? new Map<string, LaneModel>();
    matches.set(id, row);
    this.lanes.set(cwd, matches);
    this.#laneCwds.set(id, cwd);
    return cwd;
  }
}
