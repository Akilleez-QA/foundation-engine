import {frames} from '@kits/frames';
import { defineGame } from '@engine';
import { objectives } from '@kits/objectives';
import { inventory } from '@kits/inventory';
import { dialogue } from '@kits/dialogue';
import { navigation } from '@kits/navigation';
import { audioMixer } from '@kits/audio-mixer';
import { capabilities } from '@kits/capabilities';
import { equipment } from '@kits/equipment';
import { space } from '@kits/space';
import { resources } from '@kits/resources';
import { terrain } from '@kits/terrain';
export default defineGame({ id: 'expedition', title: 'Field expedition', version: '0.1.0', firstScene: 'field',
  kits: [frames(), resources(), terrain(), objectives(), inventory(), dialogue(), navigation(), audioMixer(), capabilities(), equipment(), space()],
  strings: { en: {
    'expedition.shelter.enter':'Enter shelter','expedition.shelter.back':'Return to field','expedition.shelter.ready':'Shelter ready. Your contact surface loaded before this scene became active.',
    'expedition.welcome': 'Visit three field stations. Your guide finds a route; each station counts only when you arrive.',
    'expedition.begin': 'Begin survey', 'expedition.assisted': 'Guided pace', 'expedition.next': 'Visit next station', 'expedition.stop': 'Stop',
    'expedition.continue': 'Continue to station', 'expedition.planning': 'Finding a route…', 'expedition.walking': 'Walking to station {n}',
    'expedition.progress': 'Stations {n}/3', 'expedition.done': 'Survey complete · badge earned',
    'expedition.stopped': 'Stopped. Your collected stations are kept.', 'expedition.idle': 'Ready for your next discovery.',
    'expedition.resource.ready': 'Badge earned! Survey the ground to find material for a plate.',
    'expedition.resource.scanning': 'Reading the field in small steps…',
    'expedition.resource.surveyed': 'Deposit found. Collect a sample from its finite reserve.',
    'expedition.resource.extracting': 'Collecting material · ore {ore}',
    'expedition.resource.harvested': 'Ore {ore}. Two units make one plate; its properties depend on the material.',
    'expedition.resource.crafting': 'Making one plate · ore {ore}',
    'expedition.resource.complete': 'Plate made! Ore {ore} · plates {plates}. Material and progress stay together.',
    'expedition.resource.action.ready': 'Survey material', 'expedition.resource.action.surveyed': 'Collect material',
    'expedition.resource.action.harvested': 'Make a plate', 'expedition.resource.action.complete': 'Plate complete',
    'expedition.instructions': 'Enter / A to continue · Esc / B to stop',
  } },
});
