/** The outer screen frame consumes two columns before a session is laid out. */
export const terminalContentWidth = (width: number): number => width - 2;
export const sessionSideWidth = (contentWidth: number): number => contentWidth >= 110 ? 40 : 0;
