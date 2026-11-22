export const qualities=Object.freeze({studio:510000,balanced:320000,phone:96000,opus128:128000,opus192:192000,opus256:256000,pcm16:0,pcm24:0,pcm32:0});
export function audioFormat(quality='balanced',channels=2){
 if(!Object.hasOwn(qualities,quality)||![1,2,6,8].includes(channels))throw Error('Unsupported audio format.');
 const pcm=quality.startsWith('pcm');if(!pcm&&channels>2)throw Error('5.1 and 7.1 require PCM.');
 return {codec:pcm?'pcm':'opus',bitrate:qualities[quality],bitDepth:pcm?Number(quality.slice(3)):16,channels};
}
export function freeAudioFormat(quality='balanced',channels=2){return quality==='balanced'&&channels===2;}

export const expiryHours=Object.freeze([1,24,168,0]);
export function validSessionSettings(quality='balanced',hours=0){return Object.hasOwn(qualities,quality)&&expiryHours.includes(hours);}
export class SessionPolicy {
 constructor(now=Date.now){this.now=now;this.channels=2;this.quality='balanced';this.hours=0;this.deadline=0;this.created=false;this.startedAt=0;this.sessionStartedAt=0;}
 create(quality='balanced',hours=0,channels=2){if(!validSessionSettings(quality,hours))throw Error('Invalid session settings.');audioFormat(quality,channels);this.channels=channels;this.quality=quality;this.hours=hours;this.deadline=hours?this.now()+hours*3600000:0;this.created=true;this.startedAt=0;this.sessionStartedAt=0;}
 get expired(){return this.created&&this.deadline>0&&this.now()>=this.deadline;}
 start(){if(this.expired)return false;if(!this.sessionStartedAt)this.sessionStartedAt=this.now();if(!this.startedAt)this.startedAt=this.now();return true;}
 stop(){this.startedAt=0;}
 end(){this.created=false;this.deadline=0;this.hours=0;this.startedAt=0;this.sessionStartedAt=0;}
 status(){return {format:audioFormat(this.quality,this.channels),quality:this.quality,expiresInHours:this.hours,expiresAt:this.deadline,inviteExpired:this.expired,streamStartedAt:this.sessionStartedAt};}
}
