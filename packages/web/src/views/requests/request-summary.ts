import type { RequestsFilter, RequestsViewModel } from '@pi-console/viewmodels';

export const defaultRequestFilter: Required<RequestsFilter> = { state: 'all', origin: 'all', sessionId: null, query: '' };

/** One capitalised label per filter value, shared by the selectors and the chips: "All", "Possibly unseen", "Human". */
export const filterValueLabel = (value: string): string => (value === 'possibly-unseen' ? 'Possibly unseen' : value[0].toUpperCase() + value.slice(1));

type SummaryView = Pick<RequestsViewModel, 'filter' | 'sessions'>;

/** Chips for the filters that differ from the defaults; the selectors already show the defaults. */
export function activeFilterChips(view: SummaryView): string[] {
  const { filter } = view;
  const session = view.sessions.find(item => item.id === filter.sessionId);
  const query = filter.query.trim();
  return [
    ...filter.state === defaultRequestFilter.state ? [] : [`State: ${filterValueLabel(filter.state)}`],
    ...filter.origin === defaultRequestFilter.origin ? [] : [`Origin: ${filterValueLabel(filter.origin)}`],
    ...filter.sessionId === defaultRequestFilter.sessionId ? [] : [`Session: ${session?.name ?? filter.sessionId ?? ''}`],
    ...query === '' ? [] : [`“${query}”`],
  ];
}
