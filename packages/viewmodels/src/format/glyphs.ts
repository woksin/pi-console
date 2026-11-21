/** Shared transcript and event-marker glyphs. Unicode only; no icon font is required. */
export const glyphs = {
  user: '▍', assistant: '●', thinking: '◌', tool: '⚙', result: '↳', diff: '±', reset: '⟲',
  request: '◆', answer: '●', partial: '◐', question: '?', message: '›', interrupted: '╳',
} as const;

/** The same marker legend is rendered in web SVG and terminal cells. */
export const markerLegend = [
  { glyph: glyphs.request, color: 'blue', label: 'request' }, { glyph: glyphs.interrupted, color: 'pink', label: 'interrupted' },
  { glyph: glyphs.answer, color: 'green', label: 'final answer' }, { glyph: glyphs.partial, color: 'amber', label: 'partial' },
  { glyph: glyphs.reset, color: 'pink', label: 'reset' }, { glyph: glyphs.question, color: 'amber', label: 'question' },
  { glyph: glyphs.message, color: 'cyan', label: 'message' },
] as const;
