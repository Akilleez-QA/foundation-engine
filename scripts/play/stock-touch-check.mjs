#!/usr/bin/env node
// Stock consumer sizing and real emulated-touch routes, not physical-device acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {ROOT} from './lib.mjs';
import {launch} from '../perf/bench-browser.mjs';
import {diagnosticReport} from './diagnostic-report.mjs';
const out=resolve(process.argv[2]??'playtest/stock-touch');mkdirSync(out,{recursive:true});
const report={revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),workingTreeDirty:!!execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim(),passed:false,cases:[],limitations:['Chromium touch emulation, not physical phone/tablet/controller acceptance.','Only primary controls in these authored routes; no complete accessibility, essential-world visibility or sustained-hardware certification.']};
const evidence=diagnosticReport(report,resolve(out,'report.json'));
const profiles=[{id:'compact',width:320,height:568},{id:'phone-portrait',width:390,height:844},{id:'phone-landscape',width:844,height:390},{id:'tablet',width:820,height:1180}];
const routes=[{template:'mechanics',scene:'lab',selector:'.scene-overlay section button',action:'Ride the platform',after:'Step off safely'},
 {template:'expedition',scene:'field',selector:'.scene-overlay section button',action:'Begin survey',after:'Stop'},
 {template:'expedition',scene:'shelter',selector:'.scene-overlay section button',action:null,after:'Begin survey'},
 {template:'learn',scene:'day-night',selector:'.scene-overlay nav button',action:null,pause:true}];
let server,browser;
try {
 for(const route of routes){
  process.env.GAME_DIR=`templates/${route.template}/game`;
  execFileSync(process.execPath,['scripts/generate.mjs'],{cwd:ROOT,env:process.env,stdio:'pipe'});
  server=await createServer({root:ROOT,logLevel:'error',server:{host:'127.0.0.1',port:0}});await server.listen();
  for(const profile of profiles){
   browser=await launch({...profile,mobile:true,strictClose:true});
   const page=browser.page;
   await page.goto(`${server.resolvedUrls.local[0]}?flags=dev.silent#scene/${route.scene}`);
   await page.locator(route.selector).first().waitFor();
   const controls=await page.locator(route.selector).evaluateAll(buttons=>buttons.filter(b=>b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden').map(b=>{
    const r=b.getBoundingClientRect(),style=getComputedStyle(b),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {label:b.textContent,font:parseFloat(style.fontSize),x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,hit:hit===b||b.contains(hit),disabled:b.disabled};
   }));
   const row={template:route.template,scene:route.scene,profile,controls,errors:[],passed:false};report.cases.push(row);
   assert.ok(controls.length,'visible controls');
   for(const control of controls){
    assert.ok(control.width>=48&&control.height>=48,`${route.template}/${route.scene}/${profile.id}: target ${control.label} below 48 CSS px`);
    assert.ok(control.font>=16,`${route.template}/${route.scene}/${profile.id}: primary text below 16 CSS px`);
    assert.ok(control.x>=0&&control.y>=0&&control.right<=profile.width&&control.bottom<=profile.height,'target outside viewport');
    assert.ok(control.hit,'target covered at center');
   }
   if(route.pause){
    const pause=page.locator('[data-command="pause"]'),before=await pause.innerText();await pause.tap();
    await page.waitForFunction(old=>document.querySelector('[data-command="pause"]')?.textContent!==old,before);
   }else{
    const action=route.action?page.getByRole('button',{name:route.action,exact:true}):page.locator(route.selector).first();
    await action.tap();await page.getByRole('button',{name:route.after,exact:true}).waitFor();
   }
   row.errors=[...browser.errors];assert.deepEqual(row.errors,[]);
   if(route.pause){
    row.lifecycle=await page.evaluate(async()=>{
     const {createControls}=await import('/src/kits/learn/ui.ts');
     const {createSlider,createQuizPanel}=await import('/src/kits/concept-explorer/ui.ts');
     const host=document.createElement('div');document.body.append(host);
     let commands=0,answers=0,changes=0;
     const controls=createControls(host);
     controls.onCommand(()=>commands++);
     const button=host.querySelector('button');button.click();
     const slider=createSlider(host,{id:'owned',label:'Owned',min:0,max:10,step:1,value:0});
     slider.onInput(()=>changes++);
     const input=host.querySelector('input');input.value='2';input.dispatchEvent(new Event('input'));
     const quiz=createQuizPanel(host,{questionOf:()=> 'Question',hintLabel:'Hint'});
     const view={prompt:'Choose',options:[{id:'a',text:'A'}],hints:[],feedback:null,state:'asking',chosen:null,index:0,count:1};
     quiz.onAnswer(()=>answers++);quiz.set(view);
     const answer=host.querySelector('[data-option]');answer.click();
     controls.destroy();slider.destroy();quiz.destroy();
     controls.destroy();slider.destroy();quiz.destroy();
     controls.onCommand(()=>commands++);slider.onInput(()=>changes++);quiz.onAnswer(()=>answers++);
     button.click();answer.click();input.value='3';input.dispatchEvent(new Event('input'));
     slider.show(true);slider.set(7);quiz.set(view);
     const result={commands,answers,changes,remaining:host.children.length,retiredValue:slider.value};
     host.remove();return result;
    });
    assert.deepEqual(row.lifecycle,{commands:1,answers:1,changes:1,remaining:0,retiredValue:2});
   }
   row.screenshot=`${route.template}-${route.scene}-${profile.id}.png`;
   await page.screenshot({path:resolve(out,row.screenshot)});row.passed=true;
   await browser.close();browser=null;
  }
  await server.close();server=null;
 }
 report.passed=true;
}catch(error){evidence.fail(error);}
finally{await evidence.close(browser,'browser');await evidence.close(server,'vite');evidence.finish();}
console.log(`Stock touch routes passed (${report.cases.length}); evidence ${out}`);
