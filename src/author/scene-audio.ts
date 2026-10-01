import type {CueVoice,CueVoiceOptions} from '../platform/audio/audio-output';
/** Close admission before callbacks run; one failing handle cannot strand its siblings. */
export function createSceneVoices(play:(cue:string,options:CueVoiceOptions)=>CueVoice|null){
 const voices=new Set<CueVoice>();let closed=false;
 return {
  play(cue:string,options:CueVoiceOptions={}):CueVoice|null{
   if(closed)return null;let voice:CueVoice|null=null;
   voice=play(cue,{...options,onEnded:()=>{if(voice)voices.delete(voice);options.onEnded?.();}});
   if(voice&&!voice.ended){if(closed)voice.stop();else voices.add(voice);}return voice;
  },
  dispose(){if(closed)return;closed=true;const pending=[...voices];voices.clear();const errors:unknown[]=[];for(const voice of pending)try{voice.stop();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'scene voice cleanup failed');},
 };
}
