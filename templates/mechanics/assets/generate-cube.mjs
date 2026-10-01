// Original CC0 orientation fixture, no external image tooling or artwork.
import {writeFileSync,mkdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const out=new URL('../../../public/models/mechanics/',import.meta.url);mkdirSync(out,{recursive:true});
const crc=b=>{let n=0xffffffff;for(const x of b){n^=x;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
const chunk=(name,bytes)=>{const type=Buffer.from(name),h=Buffer.alloc(4),tail=Buffer.alloc(4);h.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([h,type,bytes,tail]);};
const glyphs={x:['101','101','010','101','101'],y:['101','101','010','010','010'],z:['111','001','010','100','111']};
for(const [i,id]of ['px','nx','py','ny','pz','nz'].entries()){
 const pixels=Buffer.alloc(16*(16*3+1));for(let y=0;y<16;y++)for(let x=0;x<16;x++){
  const offset=y*49+1+x*3;let c=[112+i*3,160+i*2,181+i*2];
  const gx=x-8,gy=y-5;if(gx>=0&&gx<3&&gy>=0&&gy<5&&glyphs[id[1]][gy][gx]==='1')c=[245,248,250];
  if((y===7&&x>=3&&x<=5)||(id[0]==='p'&&x===4&&y>=6&&y<=8))c=[245,248,250];
  pixels.set(c,offset);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(16,0);ihdr.writeUInt32BE(16,4);ihdr[8]=8;ihdr[9]=2;
 writeFileSync(new URL(`sky-${id}.png`,out),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
}
