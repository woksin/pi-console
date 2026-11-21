// The hero: the web Overview with the TUI laid over it, composed as an HTML page in Chromium (no image editor needed).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rig } from '../../packages/web/e2e/harness.ts';
import { wanted, type Work } from './capture.ts';
import { captureWeb } from './web.ts';
import { captureTui } from './tui.ts';

const canvas = { width: 1600, height: 900 };
const dataUri = (file: string): string => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

const palettes = {
  dark: { bg: 'radial-gradient(1200px 700px at 78% 20%, #17304f 0%, #0b1424 55%, #070d18 100%)', title: '#f3f7fb', sub: '#9fb3c8', accent: '#66d9ef', shadow: 'rgba(0,0,0,.55)', frame: 'rgba(255,255,255,.10)' },
  light: { bg: 'radial-gradient(1200px 700px at 78% 20%, #ffffff 0%, #eef3f8 55%, #e1e9f2 100%)', title: '#0f1c2e', sub: '#4a5f75', accent: '#0b7f97', shadow: 'rgba(20,40,70,.28)', frame: 'rgba(15,28,46,.14)' },
} as const;

function page(theme: keyof typeof palettes, web: string, tui: string): string {
  const p = palettes[theme];
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;width:${String(canvas.width)}px;height:${String(canvas.height)}px;position:relative;overflow:hidden;background:${p.bg};font-family:-apple-system,'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif}
    h1{position:absolute;left:72px;top:48px;margin:0;font-size:64px;letter-spacing:-1.5px;color:${p.title}}
    h1 span{color:${p.accent}} p{position:absolute;left:74px;top:132px;margin:0;font-size:26px;color:${p.sub}}
    img{position:absolute;display:block;border-radius:14px;box-shadow:0 30px 70px ${p.shadow},0 0 0 1px ${p.frame}}
    .web{left:72px;top:200px;width:1090px} .tui{left:800px;top:372px;width:730px}
  </style><h1><span>π</span> pi-console</h1><p>One keyboard-first console for every pi session, lane and question.</p>
  <img class="web" src="${web}"><img class="tui" src="${tui}">`;
}

export async function captureHero(rig: Rig, work: Work): Promise<void> {
  const themes = ([['dark', 'web-overview'], ['light', 'web-overview-light']] as const).filter(([theme]) => wanted(work, `hero-${theme}`));
  if (themes.length === 0) return;
  // A partial run starts clean too: capture the inputs instead of relying on a previous full run.
  if (work.only !== undefined) {
    for (const [, webId] of themes) await captureWeb(rig, { ...work, only: webId });
    await captureTui(rig, { ...work, only: 'tui-overview' });
  }
  const context = await rig.browser.newContext({ viewport: canvas, deviceScaleFactor: 1.5 });
  try {
    const view = await context.newPage();
    for (const [theme, webId] of themes) {
      await view.setContent(page(theme, dataUri(join(work.dir, `${webId}.png`)), dataUri(join(work.dir, 'tui-overview.png'))));
      writeFileSync(join(work.dir, `hero-${theme}.png`), await view.screenshot());
      console.log(`  captured hero-${theme}`);
    }
  } finally { await context.close(); }
}
