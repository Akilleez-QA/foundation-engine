import {serviceRequests, worksiteSlots} from './fixtures.mjs';

console.log(JSON.stringify({serviceRequests: serviceRequests(), worksiteSlots: worksiteSlots()}, null, 2));
