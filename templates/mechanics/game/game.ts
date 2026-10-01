import { locomotion } from '@kits/locomotion';
import { housing } from '@kits/housing';
import { defineGame } from '@engine';
import { control } from '@kits/control';
import { camera } from '@kits/camera';
import { frames } from '@kits/frames';
import { vehicles } from '@kits/vehicles';
import { animation } from '@kits/animation';
import { character } from '@kits/character';
import { equipment } from '@kits/equipment';
import { capabilities } from '@kits/capabilities';
import { inventory } from '@kits/inventory';
import { market } from '@kits/market';
import { combat } from '@kits/combat';
export default defineGame({ id: 'mechanics', title: 'Mechanics lab', version: '0.1.0', firstScene: 'lab',
  kits: [locomotion(), housing(), control(), camera(), frames(), animation(), vehicles(), character(), equipment(), capabilities(), inventory(), market(), combat()],
  strings: { en: {
    'lab.place': 'Place the station', 'lab.leave': 'Leave the station', 'lab.pack': 'Pack the station',
    'lab.occupied': 'Station occupied. Leave before packing it.', 'lab.vacant': 'Station empty. Pack its recoverable contents.', 'lab.packed': 'Station packed safely. Your collected probe is saved.',
    'lab.title': 'Mechanics lab', 'lab.action': 'Continue',
    'lab.ride': 'Ride the platform', 'lab.exit': 'Step off safely', 'lab.claim': 'Collect your probe', 'lab.equip': 'Equip the probe', 'lab.fire': 'Tag the moving target', 'lab.reset': 'Try the lab again',
    'lab.intro': 'Start with a short ride. Each button reveals the next experiment.',
    'lab.riding': 'You move with the platform. Walking is paused while seated.',
    'lab.exited': 'Back on your feet. Collect the probe from the lab kiosk.',
    'lab.claimed': 'One probe delivered. Equip it to unlock the experiment.',
    'lab.equipped': 'Ready. The yellow target moves while your probe sweeps across it.',
    'lab.tagged': 'Target tagged! One action, one marker, one result.',
    'lab.wait': 'Probe in flight…', 'lab.help': 'Tap the button, press E, or use gamepad A. Walk with arrows or the left stick.',
  } },
});
