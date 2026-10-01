/**
 * Worker side of `job.assets.decode-image`: fetch one image file and decode it with `createImageBitmap`
 * off the main thread; the bitmap moves to the page as a transferable. No DOM, no rendering library (STD-RUN-36).
 */
import { JobCancelledSignal, type JobModule } from '../workers/job.ts';
import { fetchImageBitmap, type DecodeImageInput } from './decode-image.ts';

const decodeImage: JobModule<DecodeImageInput, ImageBitmap> = {
  async run(input, ctx) {
    const bitmap = await fetchImageBitmap(input.url);
    if (ctx.cancelled()) {
      bitmap.close();
      throw new JobCancelledSignal();
    }
    return { output: bitmap, transfer: [bitmap] };
  },
};

export default decodeImage;
