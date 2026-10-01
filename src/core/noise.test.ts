import test from 'node:test';
import assert from 'node:assert/strict';
import {sineHash2,valueNoise2,fbm2,gridHash2,gridValueNoise2} from './noise';

test('noise samples match the reference values they were written from, bit for bit',()=>{
 // Values evaluated with the original private functions before the migration.
 assert.equal(sineHash2(3,-4),0.86018457076716);
 assert.equal(valueNoise2(1.25,-7.5),0.8108037194505187);
 assert.equal(fbm2(0.37,2.91),0.15962341359118404);
 assert.equal(gridHash2(12.3,-45.6,7),0.9028318012133241);
 assert.equal(gridValueNoise2(33.3,-12.1,11,13),0.27353010889092294);
});
test('hashes lie in [0, 1), value noise interpolates the lattice and fbm is centred',()=>{
 let sum=0,n=0;
 for(let x=-20;x<20;x+=.37)for(let z=-20;z<20;z+=.41){
  for(const h of [sineHash2(x,z),gridHash2(x,z,3)])assert.ok(h>=0&&h<1);
  for(const v of [valueNoise2(x,z),gridValueNoise2(x,z,5,1)])assert.ok(v>=0&&v<=1);
  sum+=fbm2(x,z);n++;
 }
 assert.equal(valueNoise2(4,-9),sineHash2(4,-9));
 assert.equal(gridValueNoise2(55,-22,11,2),gridHash2(5,-2,2));
 assert.ok(Math.abs(sum/n)<.1,`fbm mean ${sum/n}`);
 assert.equal(fbm2(1.7,-3.2,{octaves:0}),0);
});
