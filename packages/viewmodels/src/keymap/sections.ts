export const sections = [
  { id: 'overview', key: '1', label: 'Overview', hint: 'What needs you now' },
  { id: 'fleet', key: '2', label: 'Fleet', hint: 'Sessions and lanes' },
  { id: 'requests', key: '3', label: 'Requests', hint: 'Requests and answers' },
  { id: 'questions', key: '4', label: 'Questions', hint: 'Decisions waiting for you' },
  { id: 'messages', key: '5', label: 'Messages', hint: 'AI-to-AI messages and graph' },
  { id: 'timeline', key: '6', label: 'Timeline', hint: 'Swimlanes of all sessions' },
  { id: 'work', key: '7', label: 'Work', hint: 'Jobs, phases and CI' },
  { id: 'direct', key: '8', label: 'Direct', hint: 'Direct work queue (from M4)' },
  { id: 'activity', key: '9', label: 'Activity', hint: 'Audit log' },
] as const;

export type SectionId = typeof sections[number]['id'];

/** Sections with content in M1; the rest render a purposeful placeholder. */
export const availableSections: readonly SectionId[] = ['overview', 'fleet', 'requests', 'questions', 'messages', 'timeline', 'work', 'activity'];

export const isSection = (value: string): value is SectionId => sections.some(section => section.id === value);
