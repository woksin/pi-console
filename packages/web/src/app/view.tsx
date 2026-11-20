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

export function View({ route, state, now }: { route: Route } & ViewProps) {
  switch (route.view) {
    case 'overview': return <OverviewView state={state} now={now} />;
    case 'fleet': return <FleetView state={state} now={now} />;
    case 'session': return <SessionView state={state} now={now} id={route.id ?? ''} entry={route.params.entry ?? null} />;
    case 'requests': return <RequestsView state={state} now={now} />;
    case 'questions': return <QuestionsView state={state} now={now} />;
    case 'messages': return <MessagesView state={state} now={now} mode={route.params.view === 'graph' ? 'graph' : 'list'} />;
    case 'timeline': return <TimelineView state={state} now={now} />;
    case 'work': return <WorkView state={state} now={now} />;
    case 'settings': return <SettingsView state={state} now={now} />;
  }
}
