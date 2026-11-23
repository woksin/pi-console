/**
 * The only module that imports OpenTUI. Everything else draws with the primitives exported here (Screen, Panel, Row,
 * Column, Lines, Clickable) and talks to the terminal through `useKeys`, `useSize`, `useTick`, `launch` and
 * `mountHeadless`. Swapping the renderer (the Bubble Tea fallback in ADR-0003) means re-implementing this file.
 */
import { act, createElement, useEffect, type ReactElement, type ReactNode } from 'react';
import { createCliRenderer, decodePasteBytes, RGBA, stripAnsiSequences, TextAttributes, type CapturedFrame, type CliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, usePaste, useTerminalDimensions, useAnimationTick, useRenderer } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import type { KeyInput } from '../state/keys.ts';
import { palette, type Color } from './theme.ts';

const element = createElement as unknown as (type: string, props: object | null, ...children: ReactNode[]) => ReactElement;

/** One styled run of text. Colours are theme tokens; the renderer resolves them. */
export interface Part { text: string; color?: Color; background?: Color; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }
export type Line = readonly Part[];

/** Plain (NO_COLOR) hands OpenTUI the terminal's own default colours, so no colour SGR is written. */
const foreground = (token: Color | undefined): string | RGBA | undefined => (palette.plain ? RGBA.defaultForeground() : token === undefined ? undefined : palette.resolve(token));
const background = (token: Color | undefined, filled = false): string | RGBA | undefined => (palette.plain ? (filled ? RGBA.defaultBackground() : undefined) : token === undefined ? undefined : palette.resolve(token));

const attributes = (part: Part): number =>
  (part.bold || (part.color !== undefined && palette.emphasised(part.color)) ? TextAttributes.BOLD : 0) | (part.dim ? TextAttributes.DIM : 0) | (part.italic ? TextAttributes.ITALIC : 0) | (part.underline ? TextAttributes.UNDERLINE : 0) | (palette.inverted(part.background) ? TextAttributes.INVERSE : 0);

function renderLine(line: Line, key: string | number, extra: object = {}): ReactElement {
  return element('text', { key, wrapMode: 'none', fg: foreground(undefined), ...extra }, ...line.map((part, index) => element('span', {
    key: index, fg: foreground(part.color), bg: background(part.background, palette.inverted(part.background)), attributes: attributes(part),
  }, part.text)));
}

export interface BoxProps {
  grow?: number; width?: number | `${number}%`; height?: number; direction?: 'row' | 'column'; gap?: number;
  padding?: number; paddingX?: number; background?: Color; justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between'; align?: 'flex-start' | 'center' | 'flex-end';
  children?: ReactNode;
}
const layout = (props: BoxProps, direction: 'row' | 'column') => ({
  flexDirection: props.direction ?? direction, flexGrow: props.grow, flexShrink: props.grow === undefined ? 1 : undefined, width: props.width, height: props.height, gap: props.gap,
  padding: props.padding, paddingLeft: props.paddingX, paddingRight: props.paddingX, backgroundColor: background(props.background),
  justifyContent: props.justify, alignItems: props.align, minWidth: 0, minHeight: 0,
});

/** Builds an element tree from the primitives below: `h(Panel, { title }, h(Lines, { lines }))`. */
export const h = createElement;

export interface OverlayProps { left: number; top: number; width: number; height: number; children?: ReactNode }
/** A floating panel drawn above the screen (palette, help, settings). */
export const Overlay = (props: OverlayProps): ReactElement => element('box', {
  position: 'absolute', left: props.left, top: props.top, width: props.width, height: props.height, zIndex: 10, flexDirection: 'column', backgroundColor: background('raised'),
}, props.children);

export const Column = (props: BoxProps): ReactElement => element('box', layout(props, 'column'), props.children);
export const Row = (props: BoxProps): ReactElement => element('box', layout(props, 'row'), props.children);
export const Screen = (props: BoxProps): ReactElement => element('box', { ...layout(props, 'column'), width: '100%', height: '100%', backgroundColor: background('bg') }, props.children);

export interface PanelProps extends BoxProps { title?: string; right?: string; focused?: boolean; accent?: Color }
/** A rounded, titled container; the border brightens when focused. */
export const Panel = (props: PanelProps): ReactElement => element('box', {
  ...layout(props, 'column'), border: true, borderStyle: palette.plain && props.focused ? 'double' : 'rounded', borderColor: foreground(props.focused ? (props.accent ?? 'cyan') : 'border'),
  title: props.title ? ` ${props.title} ` : undefined, titleAlignment: 'left', bottomTitle: props.right ? ` ${props.right} ` : undefined, bottomTitleAlignment: 'right',
  backgroundColor: background(props.background ?? 'panel'), paddingLeft: 1, paddingRight: 1,
}, props.children);

export interface LinesProps { lines: readonly Line[]; grow?: number; onLineClick?: (index: number) => void; background?: Color; height?: number }
/** A column of single-line texts. Each line is a list of coloured parts; lines never wrap, so callers clip to width. */
export const Lines = (props: LinesProps): ReactElement => element('box', { ...layout({ grow: props.grow, height: props.height }, 'column'), overflow: 'hidden' },
  ...props.lines.map((line, index) => renderLine(line, index, {
    onMouseDown: props.onLineClick ? () => { props.onLineClick?.(index); } : undefined, height: 1,
  })));

export const Clickable = (props: { onClick: () => void; children?: ReactNode; width?: number }): ReactElement =>
  element('box', { onMouseDown: props.onClick, flexShrink: 0, width: props.width }, props.children);
export const Text = (props: { line: Line }): ReactElement => renderLine(props.line, 0);
export const Spacer = (props: { grow?: number }): ReactElement => element('box', { flexGrow: props.grow ?? 1 });

export const useKeys = (handler: (key: KeyInput) => void, onPaste?: (text: string) => void): void => {
  useKeyboard(event => { handler({ name: event.name, sequence: event.sequence, ctrl: event.ctrl, meta: event.meta, shift: event.shift }); });
  usePaste(event => {
    const text = stripAnsiSequences(decodePasteBytes(event.bytes))
      .replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\p{Cc}/gu, '');
    onPaste?.(text);
  });
};
export const useSize = (): { width: number; height: number } => useTerminalDimensions();
/** Calls `callback` at `fps` on the renderer's shared clock; `undefined` pauses it. */
export const useTick = (fps: number | undefined, callback: () => void): void => { useAnimationTick(fps, callback); };
export const useClipboard = (): ((text: string) => boolean) => {
  const renderer = useRenderer();
  return (text: string) => renderer.copyToClipboardOSC52(text);
};

/** The title is cosmetic: a renderer that cannot write it (headless, not yet started) is left as it is. */
function setTitle(renderer: CliRenderer, title: string): void {
  try { renderer.setTerminalTitle(title); } catch { /* no terminal session to title */ }
}

/** Sets the terminal window title (OSC 2). The caller passes text already stripped of control characters (`consoleTitle`). */
export const useTerminalTitle = (title: string): void => {
  const renderer = useRenderer();
  useEffect(() => { setTitle(renderer, title); }, [renderer, title]);
};

export interface Handle { renderer: CliRenderer; destroy: () => void }

/** Starts the interactive renderer on the real terminal. */
export async function launch(node: ReactNode, options: { fps: number; onDestroy: () => void }): Promise<Handle> {
  const renderer = await createCliRenderer({
    targetFps: options.fps, maxFps: 30, useMouse: true, exitOnCtrlC: false, backgroundColor: background('bg'), onDestroy: options.onDestroy,
  });
  createRoot(renderer).render(node);
  return { renderer, destroy: () => { setTitle(renderer, ''); renderer.destroy(); } };
}

export interface Headless {
  frame: () => string;
  /** Per-cell foreground, background and attributes as the renderer drew them. */
  spans: () => CapturedFrame;
  /** Named keys use OpenTUI names (RETURN, ESCAPE, ARROW_DOWN, TAB, PAGE_UP); single characters are typed. */
  press: (key: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => Promise<void>;
  type: (text: string) => Promise<void>;
  paste: (text: string) => Promise<void>;
  click: (x: number, y: number) => Promise<void>;
  resize: (width: number, height: number) => Promise<void>;
  waitFor: (text: string | ((frame: string) => boolean)) => Promise<string>;
  settle: () => Promise<void>;
  stats: () => { frames: number };
  destroy: () => void;
}

/** Mounts in OpenTUI's in-memory test renderer: the same layout engine, no terminal. */
export async function mountHeadless(node: ReactNode, size: { width: number; height: number }): Promise<Headless> {
  const ui = await testRender(node, { width: size.width, height: size.height, kittyKeyboard: false });
  const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  /** React work is drained inside act so a key press has been rendered when the call resolves; store updates arrive outside it. */
  const inAct = async (work: () => Promise<void> | void) => {
    flags.IS_REACT_ACT_ENVIRONMENT = true;
    try { await act(async () => { await work(); }); } finally { flags.IS_REACT_ACT_ENVIRONMENT = false; }
  };
  const settle = async () => {
    await inAct(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    // act can commit another render when it exits; wait after React has drained its work.
    await ui.waitForVisualIdle();
  };
  return {
    frame: () => ui.captureCharFrame(),
    spans: () => ui.captureSpans(),
    press: async (key, modifiers) => {
      await inAct(async () => { ui.mockInput.pressKey(key, modifiers); if (key === 'ESCAPE') await new Promise(resolve => setTimeout(resolve, 40)); });
      await settle();
    },
    type: async text => { await inAct(async () => { await ui.mockInput.typeText(text); }); await settle(); },
    paste: async text => { await inAct(async () => { await ui.mockInput.pasteBracketedText(text); }); await settle(); },
    click: async (x, y) => { await inAct(async () => { await ui.mockMouse.click(x, y); }); await settle(); },
    resize: async (width, height) => { await inAct(() => { ui.resize(width, height); }); await settle(); },
    waitFor: async text => ui.waitForFrame(typeof text === 'string' ? (frame => frame.includes(text)) : text, { maxPasses: 40 }),
    settle,
    stats: () => ({ frames: ui.renderer.getStats().frameCount }),
    destroy: () => { ui.renderer.destroy(); },
  };
}
