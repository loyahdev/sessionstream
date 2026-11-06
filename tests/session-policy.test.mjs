import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionPolicy,qualities,validSessionSettings} from '../server/session-policy.mjs';
test('quality presets have distinct stereo bitrates and reject unsupported settings',()=>{
 assert.deepEqual(qualities,{studio:510000,balanced:320000,phone:96000});
 for(const q of Object.keys(qualities))for(const h of [0,1,24,168])assert(validSessionSettings(q,h));
 for(const [q,h] of [['bad',24],['studio',2],['phone',-1],['studio','24'],['__proto__',24]])assert(!validSessionSettings(q,h));
});
test('expiry belongs to invite creation, does not extend on stop/start, and no-expiry stays valid',()=>{
 let now=1000000;const p=new SessionPolicy(()=>now);p.create('balanced',1);const deadline=p.deadline;
 p.start();const started=p.startedAt;now+=10000;p.start();assert.equal(p.startedAt,started);p.stop();assert.equal(p.startedAt,0);assert.equal(p.status().streamStartedAt,started);p.start();assert.equal(p.status().streamStartedAt,started);assert.equal(p.deadline,deadline);
 now=deadline;assert(p.expired);assert.equal(p.start(),false);p.create('phone',0);now+=100000000000;assert(!p.expired);assert.equal(p.quality,'phone');assert.equal(p.deadline,0);
});
