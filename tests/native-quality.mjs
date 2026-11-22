import assert from 'node:assert/strict';
import wrtc from '@roamhq/wrtc';
import {NativeSender} from '../server/native-sender.mjs';
import {musicSDP} from '../web/audio.mjs';
for(const channels of [1,2])for(const [quality,bitrate] of [['studio',510000],['balanced',320000],['phone',96000],['opus128',128000],['opus192',192000],['opus256',256000]]){
 const messages=[];const native=new NativeSender((_id,message)=>messages.push(message),()=>[]);const receiver=new wrtc.RTCPeerConnection({iceServers:[]});
 try{
  native.setQuality(quality,channels);native.start([]);await native.signal({type:'peer-joined',id:'quality-test'});const offer=messages.find(m=>m.type==='offer');assert(offer);assert(offer.sdp.sdp.includes('maxaveragebitrate='+bitrate));assert(offer.sdp.sdp.includes('sprop-stereo='+(channels===1?'0':'1')));
  await receiver.setRemoteDescription(offer.sdp);await receiver.setLocalDescription(musicSDP(await receiver.createAnswer(),510000));
  await native.signal({type:'answer',id:'quality-test',generation:offer.generation,sdp:receiver.localDescription});
  assert(native.peers.get('quality-test').remoteDescription.sdp.includes('maxaveragebitrate='+bitrate));
  const existing=native.peers.get('quality-test');native.pause();assert.equal(native.peers.get('quality-test'),existing);native.start(['quality-test']);await native.chain;assert.equal(native.peers.get('quality-test'),existing);
  assert.throws(()=>native.setQuality('phone'),/Stop streaming/);console.log('PASS: actual Opus offer and applied answer enforce',quality,bitrate,channels);
 }finally{receiver.close();native.close();}
}
global.gc?.();
