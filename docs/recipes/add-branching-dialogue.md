# Recipe: add branching dialogue with variables and visit counts

The optional [`dialogue` kit](../../src/kits/dialogue/README.md) runs one conversation as a validated graph.
Variables, visit counts and conditions are optional; a definition without them behaves exactly as before.

## 1. Declare the graph

Text fields are string keys (`defineGame({ strings })`), never literal text.

```ts
// game/talk.ts
import { type DialogueDefinition } from '@kits/dialogue';

export const talk: DialogueDefinition = {
  id: 'guide-v1', start: 'hello',
  variables: { tokens: 3, trusted: false, pronoun: 'they' },
  nodes: [
    { id: 'hello', text: 'talk.hello', options: [
      { id: 'trade', text: 'talk.trade', to: 'hello',
        when: { var: 'tokens', op: 'ge', value: 2 },
        set: [{ var: 'tokens', op: 'add', value: -2 }], effects: ['give-map'] },
      { id: 'again', text: 'talk.again', to: 'hello',
        when: { all: [{ visits: 'hello', op: 'ge', value: 2 }, { not: { var: 'trusted', op: 'eq', value: true } }] },
        set: [{ var: 'trusted', op: 'set', value: true }] },
      { id: 'bye', text: 'talk.bye', to: null },
    ] },
  ],
};
```

Every node needs an authored route to an exit; the kit refuses graphs without one, and
`close()` always ends the conversation.

## 2. Run it and render the view

```ts
import { createDialogue } from '@kits/dialogue';
const d = createDialogue(talk, 'run-1');
const facts = new Set(['daytime']);           // other game state the conditions may test with { fact }
const view = d.view(facts);                   // null once closed
// Render ctx.text(view.text, { tokens: view.variables.tokens as number, pronoun: view.variables.pronoun as string })
// and one button per view.options entry. Message variables are strings or numbers, so map booleans yourself.
const result = d.choose({ ...view!, option: 'trade' }, facts);
// 'applied' (apply result.effects in your own reducer), 'stale', 'unavailable', 'closed' or 'overflow'
```

Strings can use the variables directly, for example
`"talk.hello": "{pronoun, select, she {She} he {He} other {They}} said hello. You have {tokens, plural, one {# token} other {# tokens}}."`.

## 3. Save and restore

```ts
import { defineSaveSection } from '@engine';
export const talkSave = defineSaveSection({ id: 'game.talk', initial: { json: '' } });

ctx.save(talkSave).update(s => { s.json = JSON.stringify(d.snapshot()); });
const saved = ctx.save(talkSave).get().json;
let restored = null;
try { restored = saved ? createDialogue(talk, 'run-1', JSON.parse(saved)) : null; }
catch { /* keep the saved text, tell the player, start a fresh conversation explicitly */ }
```

You may add new variables later (they start at their initial value). Removing or retyping a
variable, or renaming a node, needs a new definition `id` or an explicit migration.
