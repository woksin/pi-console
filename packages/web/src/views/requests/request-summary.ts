import type { RequestsFilter, RequestsViewModel } from '@pi-console/viewmodels';

export const defaultRequestFilter: Required<RequestsFilter> = { state: 'all', origin: 'all', sessionId: null, query: '' };

type SummaryView = Pick<RequestsViewModel, 'filter' | 'sessions'>;

/** Chips for the filters that differ from the defaults; the selectors already show the defaults. */
export function activeFilterChips(view: SummaryView): string[] {
  const { filter } = view;
  const session = view.sessions.find(item => item.id === filter.sessionId);
  const query = filter.query.trim();
  return [
    ...filter.state === defaultRequestFilter.state ? [] : [`state ${filter.state}`],
    ...filter.origin === defaultRequestFilter.origin ? [] : [`origin ${filter.origin}`],
    ...filter.sessionId === defaultRequestFilter.sessionId ? [] : [`session ${session?.name ?? filter.sessionId ?? ''}`],
    ...query === '' ? [] : [`“${query}”`],
  ];
}
