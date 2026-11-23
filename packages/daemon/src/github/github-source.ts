import type { EventLog } from '@pi-console/contract';
import { lookupTarget } from '@pi-console/adapters';
import type { ReadModels } from '@pi-console/core';
import { FileStateStore } from './github-state.ts';
import { GithubClosureWorker, githubSourceId, type GithubDeps, type QuestionMeta } from './github-worker.ts';

export interface GithubConfig { dataDir: string; githubRepositories: readonly string[]; sources: Record<string, boolean> }

/** On only when switched on explicitly and at least one repository is allowlisted; no default or remote client can change either. */
export const githubActive = (config: Pick<GithubConfig, 'sources' | 'githubRepositories'>): boolean =>
  config.sources[githubSourceId] && config.githubRepositories.length > 0;

/** Question metadata for the worker: references to the projected rows only; nothing is copied or parsed until the worker looks at it. */
export function* questionMetadata(models: ReadModels): Generator<QuestionMeta> {
  for (const question of Object.values(models.questions.questions)) yield { id: question.id, revision: question.revision, status: question.status, links: question.links };
}

export interface GithubSourceOptions { log: EventLog; models: () => ReadModels; config: GithubConfig; deps?: Partial<GithubDeps> }

export function githubWorker({ log, models, config, deps }: GithubSourceOptions): GithubClosureWorker {
  return new GithubClosureWorker({
    log, questions: () => questionMetadata(models()), repositories: config.githubRepositories, store: new FileStateStore(config.dataDir),
    lookup: (target, signal) => lookupTarget(target, { signal }), ...deps,
  });
}
