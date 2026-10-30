import {TEST_API} from '../../core/env';
import {appFeatures} from '../../core/settings/app-features';
/**
 * DEV-only frame trace for controls-feel audits. A test script sets `globalThis.__engineTrace=[]`; every mover frame then
 * appends one record (dt, player, camera, rig, input, whether the frame was drawn). Production builds compile it away.
 */
export type TraceRecord = {
  area: string;
  t: number;
  dt: number;
  /** Player position and heading. */
  px: number;
  pz: number;
  heading: number;
  /** Camera eye, look target and field of view (fov 0 = orthographic). */
  eye: [number, number, number];
  look: [number, number, number];
  fov: number;
  mode: string;
  z: number;
  yaw: number;
  move: [number, number];
  lookIn: [number, number];
  rendered: boolean;
  route: number;
};
const dev = !!(TEST_API && appFeatures().enabled('dev.test-api'));
export function traceFrame(record: () => TraceRecord) {
  if (!dev) return;
  const buf = (globalThis as {__engineTrace?: TraceRecord[]}).__engineTrace;
  if (!buf) return;
  buf.push(record());
  if (buf.length > 20000) buf.splice(0, buf.length - 20000);
}
