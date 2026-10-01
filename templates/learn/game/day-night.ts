// The lesson as a scene. Its body (the learn runtime and the sim below) loads only when the lesson opens.
import { lessonScene } from '@kits/learn';
import lesson from './lesson';

export default lessonScene({ lesson, title: 'Day and night', sim: () => import('./day-night.body.mts') });
