import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { assertPureGraph, buildPurePackage } from './package-pure.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
test('pure package: immutable packed consumer runs without Foundation runtime or Three and preserves custody', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pure-consumer-'));
  try {
    const first = buildPurePackage(join(dir, 'artifacts'));
    const second = buildPurePackage(join(dir, 'artifacts'));
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.integrity, second.integrity);
    const consumer = join(dir, 'consumer'); mkdirSync(consumer);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'pure-consumer', version: '1.0.0', private: true, type: 'module' }));
    execFileSync('npm', ['install', '--ignore-scripts', '--offline', '--no-audit', '--no-fund', first.artifact], { cwd: consumer });
    const installed = join(consumer, 'node_modules/@foundation-engine/pure');
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.peerDependencies, undefined);
    assert.equal(manifest.scripts, undefined);
    assert.equal(JSON.parse(readFileSync(join(installed, 'metadata.json'), 'utf8')).revision, first.revision);
    assert.deepEqual(readdirSync(join(consumer, 'node_modules')).filter(name => !name.startsWith('.')), ['@foundation-engine']);
    writeFileSync(join(consumer, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      import { createInventoryLedger, prepareStockChange } from '@foundation-engine/pure/inventory';
      import * as resources from '@foundation-engine/pure/resources';
      import * as capabilities from '@foundation-engine/pure/capabilities';
      import * as equipment from '@foundation-engine/pure/equipment';
      import * as housing from '@foundation-engine/pure/housing';
      import * as authoring from '@foundation-engine/pure/authoring';
      for (const [api, factory] of [[resources,'createProduction'],[capabilities,'createCapabilities'],
        [equipment,'createEquipment'],[housing,'createStructure'],[authoring,'createAuthoredDocument']]) {
        assert.equal(typeof api[factory], 'function');
      }

      const dimensions = {containers:4,batches:4,positions:4,changes:8,properties:4};
      const stock = {version:1,containers:[{id:'bin',maxMassMg:10000,maxVolumeUl:10000,phases:['solid']}],
        batches:[{id:'ore',material:'ore',unit:'g',phase:'solid',massMg:1000,volumeUl:100,properties:{}}],positions:[]};
      const seeded = prepareStockChange(stock,{produce:[{container:'bin',batch:'ore',quantity:2}]},dimensions);
      assert.equal(seeded.ok,true); assert.equal(seeded.producedMassMg,2000);
      assert.equal(stock.positions.length,0);
      const industrial = {version:1,stock,deposits:[{id:'site',body:'body',region:'region',batch:'ore',remaining:3}],plans:[],machines:[]};
      const extracted = resources.prepareIndustryCommand(industrial,{kind:'harvest',deposit:'site',container:'bin',quantity:2},
        {stock:dimensions,deposits:4,plans:4,machines:4,maxStepTicks:10});
      assert.equal(extracted.ok,true); assert.equal(extracted.state.deposits[0].remaining,1);
      assert.equal(extracted.state.stock.positions[0].quantity,2);
      assert.equal(resources.resourceProductionSystem, undefined);
      const recipe={id:'part',version:1,pointLimit:0,slots:[{id:'ore',materials:['ore'],unit:'g',quantity:2}],attributes:[],
        output:{material:'part',unit:'count',phase:'solid',massMg:{base:1000,terms:[]},volumeUl:{base:100,terms:[]},properties:{}},
        scrap:{material:'scrap',unit:'mg',phase:'solid',massMg:1,volumeUl:1,properties:{}},workJ:100,maxPowerW:10};
      const craftingInput={stock:seeded.state,stockBounds:dimensions,bounds:{slots:1,selections:1,attributes:1,weights:1,points:0,steps:0,properties:1}};
      const trial=resources.beginCraftExperiment(recipe,[{slot:'ore',container:'bin',batch:'ore',quantity:2}],{id:'trial',pointBudget:0},craftingInput);
      const manifest=resources.lockCraftManifest(trial,{manifest:'manifest',output:'part',scrap:'scrap'},recipe,craftingInput);
      assert.deepEqual(resources.parseCraftManifest(JSON.parse(JSON.stringify(manifest)),recipe,craftingInput),manifest);
      assert.equal(manifest.plan.outputs[1].quantity,1000);

      const chain = resources.createIndustryCandidate({version:1,stock:{version:1,containers:[],batches:[],positions:[]},deposits:[],plans:[],machines:[]},
        {stock:{containers:1,batches:1,positions:1,changes:1,properties:1},deposits:1,plans:1,machines:1,maxStepTicks:1});
      const snapshot = chain.snapshot(); snapshot.deposits.push({id:'foreign'});
      assert.equal(chain.snapshot().deposits.length,0);
      const ignored = {kind:'cancel',machine:'missing',get arbitraryGraph(){throw Error('unadmitted graph');}};
      assert.deepEqual(chain.apply(ignored),{ok:false,reason:'unknown-machine'});
      chain.dispose(); assert.throws(()=>chain.snapshot(),/retired/);
      assert.equal(capabilities.capabilities, undefined);
      assert.equal(resources.createProduction({capacities:{store:1},deposits:[],recipes:[],jobs:[]}).snapshot().version, 2);
      assert.deepEqual(capabilities.createCapabilities([]).snapshot().grants, []);
      const progressionBounds = {xpTypes:1,skills:1,prerequisites:0,grants:2,learned:1};
      const progressionRules = {id:'v1',allocationLimit:2,xpTypes:[{id:'practice',maxBalance:100}],
        skills:[{id:'starter',xpType:'practice',xpCost:20,pointCost:2,requires:[],certificates:['use-tool'],schematics:['tool']}]};
      const initial = capabilities.createProgressionState(progressionRules, progressionBounds);
      const earned = capabilities.prepareProgressionChange(initial,{kind:'earn',xpType:'practice',amount:50},progressionRules,progressionBounds);
      assert.equal(earned.ok,true);
      const learned = capabilities.prepareProgressionChange(earned.state,{kind:'learn',skill:'starter'},progressionRules,progressionBounds);
      assert.equal(learned.ok,true); assert.equal(learned.state.spentAllocation,2);
      const reloaded = capabilities.parseProgressionState(JSON.parse(JSON.stringify(learned.state)),progressionRules,progressionBounds);
      assert.deepEqual(capabilities.deriveProgressionGrants(reloaded,progressionRules,progressionBounds),{certificates:['use-tool'],schematics:['tool']});
      const surrendered = capabilities.prepareProgressionChange(reloaded,{kind:'surrender',skill:'starter'},progressionRules,progressionBounds);
      assert.equal(surrendered.ok,true); assert.equal(surrendered.state.spentAllocation,0);
      assert.equal(surrendered.state.xp[0].balance,30); assert.equal(initial.xp[0].balance,0);
      assert.deepEqual(surrendered.grants,{certificates:[],schematics:[]});
      assert.equal(equipment.createEquipment([],1,{revision:0,items:[],equipped:[]}).snapshot().revision, 0);
      assert.equal(housing.createStructure({revision:0,owner:'p',grants:{},placements:[],occupants:[],packed:false}).snapshot().owner, 'p');
      const document = authoring.createAuthoredDocument({id:'d',json:'null',limits:{maxBytes:32,maxNodes:2,maxDepth:2},validate:v=>v===null});
      assert.equal(document.read().value, null); document.dispose();
      const options = { capacities: { hold: 8, store: 8 } };
      const owner = createInventoryLedger(options);
      const output = [{container:'hold',batch:{id:'batch',material:'ore',properties:{grade:0.8}},quantity:5}];
      assert.deepEqual(owner.transact('collect', [], output), {ok:true,duplicate:false});
      assert.deepEqual(owner.transact('collect', [], output), {ok:true,duplicate:true});
      assert.deepEqual(owner.transfer('haul', 'hold', 'store', 'batch', 6), {ok:false,reason:'insufficient'});
      const restored = createInventoryLedger(options, owner.snapshot());
      assert.deepEqual(restored.transact('collect', [], output), {ok:true,duplicate:true});
      assert.deepEqual(restored.transfer('haul', 'hold', 'store', 'batch', 5), {ok:true,duplicate:false});
      assert.equal(restored.quantity('hold','batch'),0);
      assert.equal(restored.quantity('store','batch'),5);
      assert.equal(owner.quantity('hold','batch'),5);
    `);
    execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumer });
    writeFileSync(join(consumer, 'consumer.ts'), `
      import { createInventoryLedger, type MaterialBatch } from '@foundation-engine/pure/inventory';
      import { createProduction, prepareIndustryCommand, createIndustryCandidate, type IndustryCandidate, type IndustrialState, type ProductionSnapshot, beginCraftExperiment, applyCraftExperiment, lockCraftManifest, parseCraftManifest, type CraftRecipe, type CraftManifest } from '@foundation-engine/pure/resources';
      import { createCapabilities, createProgressionState, parseProgressionRules, parseProgressionState,
        prepareProgressionChange, deriveProgressionGrants, type ProgressionRules, type ProgressionBounds,
        type ProgressionState, type ProgressionCandidate, type ProgressionChange, type ProgressionGrants,
        type ProgressionFailure, type ProgressionSkill } from '@foundation-engine/pure/capabilities';
      import { createEquipment } from '@foundation-engine/pure/equipment';
      import { createStructure } from '@foundation-engine/pure/housing';
      import { createAuthoredDocument } from '@foundation-engine/pure/authoring';
      const batch: MaterialBatch = {id:'b',material:'m',properties:{}};
      createInventoryLedger({capacities:{bag:2}}).transact('add',[],[{container:'bag',batch,quantity:1}]);
      const production: ProductionSnapshot = createProduction({capacities:{store:1},deposits:[],recipes:[],jobs:[]}).snapshot();
      createCapabilities([]); createEquipment([],1,{revision:0,items:[],equipped:[]});
      createStructure({revision:0,owner:'p',grants:{},placements:[],occupants:[],packed:false});
      createAuthoredDocument({id:'d',json:'null',limits:{maxBytes:32,maxNodes:2,maxDepth:2},validate:(v):v is null=>v===null});
      const bounds: ProgressionBounds = {xpTypes:1,skills:1,prerequisites:0,grants:0,learned:1};
      const skill: ProgressionSkill = {id:'s',xpType:'p',xpCost:1,pointCost:1,requires:[],certificates:[],schematics:[]};
      const rules: ProgressionRules = parseProgressionRules({id:'v1',allocationLimit:1,xpTypes:[{id:'p',maxBalance:10}],skills:[skill]},bounds);
      const state: ProgressionState = parseProgressionState(createProgressionState(rules,bounds),rules,bounds);
      const change: ProgressionChange = {kind:'earn',xpType:'p',amount:1};
      const candidate: ProgressionCandidate = prepareProgressionChange(state,change,rules,bounds);
      const grants: ProgressionGrants = deriveProgressionGrants(state,rules,bounds);
      const reason: ProgressionFailure | undefined = candidate.ok ? undefined : candidate.reason;
      void production; void grants; void reason;
      const craftingAPI: [typeof beginCraftExperiment,typeof applyCraftExperiment,typeof lockCraftManifest,typeof parseCraftManifest]=[beginCraftExperiment,applyCraftExperiment,lockCraftManifest,parseCraftManifest];
      const capturedRecipe: CraftRecipe | undefined=undefined; const capturedManifest: CraftManifest | undefined=undefined; void craftingAPI; void capturedRecipe; void capturedManifest;
      const industrial: IndustrialState = {version:1,stock:{version:1,containers:[],batches:[],positions:[]},deposits:[],plans:[],machines:[]};
      const chain: IndustryCandidate = createIndustryCandidate(industrial,{stock:{containers:1,batches:1,positions:1,changes:1,properties:1},deposits:1,plans:1,machines:1,maxStepTicks:1});
      chain.snapshot(); chain.dispose(); void prepareIndustryCommand; void production;
    `);
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'consumer.ts'], { cwd: consumer });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pure package: dependency closure rejects a renderer/runtime import even when type-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pure-boundary-'));
  try {
    mkdirSync(join(dir, 'inventory')); mkdirSync(join(dir, 'core'));
    writeFileSync(join(dir, 'inventory/pure.ts'), "export type { Runtime } from '../core/runtime.js';\n");
    writeFileSync(join(dir, 'core/runtime.ts'), 'export interface Runtime { renderer: unknown }\n');
    const program = ts.createProgram([join(dir, 'inventory/pure.ts')], { types: [], moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext });
    assert.throws(() => assertPureGraph(program, dir), /outside kit source/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pure package: external and dynamic imports cannot evade the boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pure-external-'));
  try {
    mkdirSync(join(dir, 'inventory'));
    const path = join(dir, 'inventory/pure.ts');
    for (const [source, reason] of [
      ["import 'three';", /relative native ESM/],
      ["export const load = () => import('three');", /dynamic dependencies/],
    ]) {
      writeFileSync(path, source);
      const program = ts.createProgram([path], { types: [], moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext });
      assert.throws(() => assertPureGraph(program, dir), reason);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
