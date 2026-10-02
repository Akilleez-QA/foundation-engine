// Original CC0 sky cube for the mechanics template, no external image tooling or artwork.
// Six 64×64 faces: one seamless soft vertical gradient (lighter towards +Y, darker towards −Y) that stays smooth when a phone
// magnifies it, with a small, low-contrast orientation glyph (X/Y/Z, a dash, and a plus mark on positive faces) so
// face order and orientation can still be checked. 64 px keeps the whole cube near 0.1 MiB of texture.
import {writeFileSync,mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
export const SIZE=64;
const out=new URL('../game/public/models/mechanics/',import.meta.url);mkdirSync(out,{recursive:true});
const crc=b=>{let n=0xffffffff;for(const x of b){n^=x;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
const chunk=(name,bytes)=>{const type=Buffer.from(name),h=Buffer.alloc(4),tail=Buffer.alloc(4);h.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([h,type,bytes,tail]);};
const glyphs={x:['101','101','010','101','101'],y:['101','101','010','010','010'],z:['111','001','010','100','111']};
const top=[196,222,236],horizon=[150,192,212],bottom=[104,140,158];
const mix=(a,b,t)=>a.map((v,k)=>Math.round(v+(b[k]-v)*t));
/** The sky colour at height v (0 top of the face … 1 bottom) for face `id`. */
function sky(id,v){
  if(id==='py')return top;
  if(id==='ny')return bottom;   // flat caps match the side faces' first and last rows: no seams
  return v<0.5?mix(top,horizon,v*2):mix(horizon,bottom,(v-0.5)*2);
}
const S=3,GX=SIZE-16,GY=6;   // glyph cell size and origin (top right): small, so magnification blur stays out of the way
for(const id of ['px','nx','py','ny','pz','nz']){
 const pixels=Buffer.alloc(SIZE*(SIZE*3+1));
 for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
  const offset=y*(SIZE*3+1)+1+x*3;let c=sky(id,y/(SIZE-1));
  const gx=Math.floor((x-GX)/S),gy=Math.floor((y-GY)/S);
  const mark=(gx>=0&&gx<3&&gy>=0&&gy<5&&glyphs[id[1]][gy][gx]==='1')
    ||(y>=GY+6&&y<GY+9&&x>=GX-13&&x<GX-4)||(id[0]==='p'&&x>=GX-10&&x<GX-7&&y>=GY+3&&y<GY+12);
  if(mark)c=mix(c,[245,248,250],0.55);
  pixels.set(c,offset);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(SIZE,0);ihdr.writeUInt32BE(SIZE,4);ihdr[8]=8;ihdr[9]=2;
 writeFileSync(new URL(`sky-${id}.png`,out),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
