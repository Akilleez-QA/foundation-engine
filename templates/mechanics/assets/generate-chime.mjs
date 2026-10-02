// Original CC0 chime for the sound-file demonstration, synthesised here: no recording or external audio input.
// 0.45 s, 22 050 Hz mono 16-bit PCM WAV: two soft partials (E5, B5) with a gentle attack and exponential decay,
// peak about -10 dBFS, starting and ending at silence.
import {writeFileSync,mkdirSync} from 'node:fs';
const out=new URL('../game/public/sounds/mechanics/',import.meta.url);mkdirSync(out,{recursive:true});
const rate=22050,n=Math.round(rate*.45),pcm=Buffer.alloc(n*2);
for(let i=0;i<n;i++){
 const t=i/rate,env=Math.min(1,t/.008)*Math.exp(-t*7)*Math.min(1,(n-1-i)/(rate*.01));
 const v=.3*env*(Math.sin(2*Math.PI*659.25*t)*.7+Math.sin(2*Math.PI*987.77*t)*.3);
 pcm.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),i*2);
}
const h=Buffer.alloc(44);h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);
h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);
writeFileSync(new URL('chime.wav',out),Buffer.concat([h,pcm]));
