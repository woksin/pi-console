/**
 * The only module that imports OpenTUI. Everything else draws with the primitives exported here (Screen, Panel, Row,
 * Column, Lines, Clickable) and talks to the terminal through `useKeys`, `useSize`, `useTick`, `launch` and
 * `mountHeadless`. Swapping the renderer (the Bubble Tea fallback in ADR-0003) means re-implementing this file.
 */
import { createElement, type ReactElement, type ReactNode } from 'react';
import { createCliRenderer, TextAttributes, type CliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions, useAnimationTick, useRenderer } from '@opentui/react';
import { testRender } from '@opentui/react/test-utils';
import type { KeyInput } from '../state/keys.ts';
import { palette, type Color } from './theme.ts';

const element = createElement as unknown as (type: string, props: object | null, ...children: ReactNode[]) => ReactElement;

/** One styled run of text. Colours are theme tokens; the renderer resolves them. */
export interface Part { text: string; color?: Color; background?: Color; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }
export type Line = readonly Part[];

const attributes = (part: Part): number =>
  (part.bold ? TextAttributes.BOLD : 0) | (part.dim ? TextAttributes.DIM : 0) | (part.italic ? TextAttributes.ITALIC : 0) | (part.underline ? TextAttributes.UNDERLINE : 0);

function renderLine(line: Line, key: string | number, extra: object = {}): ReactElement {
  return element('text', { key, wrapMode: 'none', ...extra }, ...line.map((part, index) => element('span', {
    key: index, fg: part.color ? palette.resolve(part.color) : undefined, bg: part.background ? palette.resolve(part.background) : undefined, attributes: attributes(part),
  }, part.text)));
}

export interface BoxProps {
  grow?: number; width?: number | `${number}%`; height?: number; direction?: 'row' | 'column'; gap?: number;
  padding?: number; paddingX?: number; background?: Color; justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between'; align?: 'flex-start' | 'center' | 'flex-end';
  children?: ReactNode;
}
const layout = (props: BoxProps, direction: 'row' | 'column') => ({
  flexDirection: props.direction ?? direction, flexGrow: props.grow, flexShrink: props.grow === undefined ? 1 : undefined, width: props.width, height: props.height, gap: props.gap,
  padding: props.padding, paddingLeft: props.paddingX, paddingRight: props.paddingX, backgroundColor: props.background ? palette.resolve(props.background) : undefined,
  justifyContent: props.justify, alignItems: props.align, minWidth: 0, minHeight: 0,
});

/** Builds an element tree from the primitives below: `h(Panel, { title }, h(Lines, { lines }))`. */
export const h = createElement;

export interface OverlayProps { left: number; top: number; width: number; height: number; children?: ReactNode }
/** A floating panel drawn above the screen (palette, help, settings). */
export const Overlay = (props: OverlayProps): ReactElement => element('box', {
  position: 'absolute', left: props.left, top: props.top, width: props.width, height: props.height, zIndex: 10, flexDirection: 'column', backgroundColor: palette.resolve('raised'),
}, props.children);

export const Column = (props: BoxProps): ReactElement => element('box', layout(props, 'column'), props.children);
export const Row = (props: BoxProps): ReactElement => element('box', layout(props, 'row'), props.children);
export const Screen = (props: BoxProps): ReactElement => element('box', { ...layout(props, 'column'), width: '100%', height: '100%', backgroundColor: palette.resolve('bg') }, props.children);

export interface PanelProps extends BoxProps { title?: string; right?: string; focused?: boolean; accent?: Color }
/** A rounded, titled container; the border brightens when focused. */
export const Panel = (props: PanelProps): ReactElement => element('box', {
  ...layout(props, 'column'), border: true, borderStyle: 'rounded', borderColor: palette.resolve(props.focused ? (props.accent ?? 'cyan') : 'border'),
  title: props.title ? ` ${props.title} ` : undefined, titleAlignment: 'left', bottomTitle: props.right ? ` ${props.right} ` : undefined, bottomTitleAlignment: 'right',
  backgroundColor: palette.resolve(props.background ?? 'panel'), paddingLeft: 1, paddingRight: 1,
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

export const useKeys = (handler: (key: KeyInput) => void): void => {
  useKeyboard(event => { handler({ name: event.name, sequence: event.sequence, ctrl: event.ctrl, meta: event.meta, shift: event.shift }); });
};
export const useSize = (): { width: number; height: number } => useTerminalDimensions();
/** Calls `callback` at `fps` on the renderer's shared clock; `undefined` pauses it. */
export const useTick = (fps: number | undefined, callback: () => void): void => { useAnimationTick(fps, callback); };
export const useClipboard = (): ((text: string) => boolean) => {
  const renderer = useRenderer();
  return (text: string) => renderer.copyToClipboardOSC52(text);
};

export interface Handle { renderer: CliRenderer; destroy: () => void }

/** Starts the interactive renderer on the real terminal. */
export async function launch(node: ReactNode, options: { fps: number; onDestroy: () => void }): Promise<Handle> {
  const renderer = await createCliRenderer({
    targetFps: options.fps, maxFps: 30, useMouse: true, exitOnCtrlC: false, backgroundColor: palette.resolve('bg'), onDestroy: options.onDestroy,
  });
  createRoot(renderer).render(node);
  return { renderer, destroy: () => { renderer.destroy(); } };
}

export interface Headless {
  frame: () => string;
  /** Named keys use OpenTUI names (RETURN, ESCAPE, ARROW_DOWN, TAB, PAGE_UP); single characters are typed. */
  press: (key: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => Promise<void>;
  type: (text: string) => Promise<void>;
  click: (x: number, y: number) => Promise<void>;
  resize: (width: number, height: number) => void;
  waitFor: (text: string | ((frame: string) => boolean)) => Promise<string>;
  settle: () => Promise<void>;
  stats: () => { frames: number };
  destroy: () => void;
}

/** Mounts in OpenTUI's in-memory test renderer: the same layout engine, no terminal. */
export async function mountHeadless(node: ReactNode, size: { width: number; height: number }): Promise<Headless> {
  const ui = await testRender(node, { width: size.width, height: size.height, kittyKeyboard: false });
  const settle = async () => { await ui.flush(); };
  return {
    frame: () => ui.captureCharFrame(),
    press: async (key, modifiers) => {
      ui.mockInput.pressKey(key, modifiers);
      if (key === 'ESCAPE') await new Promise(resolve => setTimeout(resolve, 40));
      await settle();
    },
    type: async text => { await ui.mockInput.typeText(text); await settle(); },
    click: async (x, y) => { await ui.mockMouse.click(x, y); await settle(); },
    resize: (width, height) => { ui.resize(width, height); },
    waitFor: async text => ui.waitForFrame(typeof text === 'string' ? (frame => frame.includes(text)) : text, { maxPasses: 40 }),
    settle,
    stats: () => ({ frames: ui.renderer.getStats().frameCount }),
    destroy: () => { ui.renderer.destroy(); },
  };
}
