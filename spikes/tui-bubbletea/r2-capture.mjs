// Run from repository root, after npm/build.mjs. VHS uses a genuine PTY.
import { startDaemon } from '../mock-daemon/server.ts';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
const dir='.ai-work/tasks/m0r2-bubbletea/output';
const media='docs/spikes/media/r2-bubbletea';
mkdirSync(dir,{recursive:true});
const daemon=await startDaemon({port:0,speed:3,dataDirectory:`${dir}/capture-daemon`});
const bin=process.env.PI_BUBBLETEA_BIN || `${dir}/npm/darwin-arm64/bin/pi-console`;
function run(tape){return new Promise((resolve,reject)=>{const child=spawn('vhs',[tape],{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`vhs exited ${code}`)))});}
function base(cols,rows,output){return `Output ${output}\nSet Shell bash\nSet Width ${Math.ceil(cols*9.2+40)}\nSet Height ${Math.ceil(rows*18.4+40)}\nSet FontFamily "Menlo"\nSet FontSize 14\nSet LineHeight 1.15\nSet Padding 16\nSet Framerate 10\nSet TypingSpeed 0\nSet Theme { "name": "Pi", "background": "#11100f", "foreground": "#f1ebe2", "black": "#11100f", "red": "#ef806f", "green": "#a8c78a", "yellow": "#dfa66b", "blue": "#7fc9ce", "magenta": "#b7a0db", "cyan": "#7fc9ce", "white": "#f1ebe2", "brightBlack": "#8e857a", "brightRed": "#ef806f", "brightGreen": "#a8c78a", "brightYellow": "#dfa66b", "brightBlue": "#7fc9ce", "brightMagenta": "#b7a0db", "brightCyan": "#7fc9ce", "brightWhite": "#ffffff" }\nHide\nType "stty cols ${cols} rows ${rows}; exec ${bin} --url http://127.0.0.1:${daemon.port} --token-file ${dir}/capture-daemon/token --screen graph --colors truecolor"\nEnter\nSleep 500ms\nShow\n`;}
try{
 for(const [cols,rows]of [[120,36],[200,50]]){
  const tape=`${dir}/capture-${cols}.tape`;let body=base(cols,rows,cols===120?`${media}-motion.gif`:`${dir}/capture-200.gif`);
  body+=`Sleep 2s\nScreenshot ${media}-graph-${cols}x${rows}.png\nSleep 500ms\nType "t"\nSleep 2s\nScreenshot ${media}-timeline-${cols}x${rows}.png\nSleep 500ms\nType "i"\nType "Verify the checkpoint before handoff."\nEnter\nType "Keep the retry budget bounded."\nCtrl+S\nSleep 1s\nScreenshot ${media}-composer-${cols}x${rows}.png\nSleep 500ms\nEscape\nEnter\nType "f"\nType "[ "\nType "[ "\nSleep 1s\nScreenshot ${media}-transcript-${cols}x${rows}.png\nSleep 1s\n`;
  writeFileSync(tape,body);await run(tape);
 }
 const narrow=`${dir}/capture-90.tape`;writeFileSync(narrow,base(90,30,`${dir}/narrow.gif`)+`Escape\nEnter\nType "f[ [ "\nSleep 1s\nScreenshot ${media}-stacked-90x30.png\nSleep 500ms\n`);await run(narrow);
 if(statSync(`${media}-motion.gif`).size>8*1024*1024)throw new Error('GIF exceeds 8 MiB');
}finally{await daemon.close();}
