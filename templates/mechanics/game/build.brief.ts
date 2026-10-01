import { defineBuild } from '@engine';
export default defineBuild({
  goal: 'Exercise local engine ownership through a guided ride, delivery and nonviolent probe experiment.',
  pitch: 'One compact lab makes frame, seat, equipment and event contracts visible.',
  genre: 'mechanics', coreLoop: ['ride the platform', 'collect and equip a probe', 'tag the moving target'],
  devices: { targets: ['desktop', 'laptop', 'tablet', 'phone'], minimum: 'phone', input: ['keyboard', 'pointer', 'touch', 'gamepad'] },
  quality: { views: [{ id: 'lab-start', scene: 'lab', mode: 'reviewed' }] },
  success: [
    { id: 'S1', check: 'rider pose follows the vehicle with independent movement disabled until validated exit', how: 'test', by: 'game/lab.test.ts' },
    { id: 'S2', check: 'repeated collection does not duplicate inventory or debit and equipment gates probe use', how: 'test', by: 'game/lab.test.ts' },
    { id: 'S3', check: 'one probe action emits one marker and commits one moving-target tag', how: 'test', by: 'game/lab.test.ts' },
    { id: 'S4', check: 'desktop and phone lab stay within measured scene budgets', how: 'gate' },
  ],
});
