import type { ConsoleState } from '../state/state.ts';
import { FleetView } from '../views/fleet.tsx';
import { MessagesView } from '../views/messages.tsx';
import { OverviewView } from '../views/overview.tsx';
import { QuestionsView } from '../views/questions.tsx';
import { RequestsView } from '../views/requests.tsx';
import { SessionView } from '../views/session.tsx';
import { SettingsView } from '../views/settings.tsx';
import { TimelineView } from '../views/timeline.tsx';
import { WorkView } from '../views/work.tsx';
import type { Route } from './routes.ts';

export interface ViewProps { state: ConsoleState; now: number }

type Render = (props: ViewProps, route: Route) => React.ReactNode;

const renderers: Record<Route['view'], Render> = {
  overview: props => <OverviewView {...props} />,
  fleet: props => <FleetView {...props} />,
  session: (props, route) => <SessionView {...props} id={route.id ?? ''} entry={route.params.entry ?? null} />,
  requests: props => <RequestsView {...props} />,
  questions: props => <QuestionsView {...props} />,
  messages: (props, route) => <MessagesView {...props} mode={route.params.view === 'graph' ? 'graph' : 'list'} />,
  timeline: props => <TimelineView {...props} />,
  work: props => <WorkView {...props} />,
  settings: props => <SettingsView {...props} />,
};

export function View({ route, state, now }: { route: Route } & ViewProps) {
  return renderers[route.view]({ state, now }, route);
}
