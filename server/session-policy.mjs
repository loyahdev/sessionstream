export const qualities=Object.freeze({studio:510000,balanced:320000,phone:96000});
export const expiryHours=Object.freeze([1,24,168,0]);
export function validSessionSettings(quality='balanced',hours=0){return Object.hasOwn(qualities,quality)&&expiryHours.includes(hours);}
export class SessionPolicy {
 constructor(now=Date.now){this.now=now;this.quality='balanced';this.hours=0;this.deadline=0;this.created=false;this.startedAt=0;this.sessionStartedAt=0;}
 create(quality='balanced',hours=0){if(!validSessionSettings(quality,hours))throw Error('Invalid session settings.');this.quality=quality;this.hours=hours;this.deadline=hours?this.now()+hours*3600000:0;this.created=true;this.startedAt=0;this.sessionStartedAt=0;}
 get expired(){return this.created&&this.deadline>0&&this.now()>=this.deadline;}
 start(){if(this.expired)return false;if(!this.sessionStartedAt)this.sessionStartedAt=this.now();if(!this.startedAt)this.startedAt=this.now();return true;}
 stop(){this.startedAt=0;}
 end(){this.created=false;this.deadline=0;this.hours=0;this.startedAt=0;this.sessionStartedAt=0;}
 status(){return {quality:this.quality,expiresInHours:this.hours,expiresAt:this.deadline,inviteExpired:this.expired,streamStartedAt:this.sessionStartedAt};}
}
