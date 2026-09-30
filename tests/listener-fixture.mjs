// Isolated browser-test source: never takes ownership of a user's DAW stream.
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';
import dgram from 'node:dgram';
import {performance} from 'node:perf_hooks';
const app=await createStreamServer({nativeSender:true,publicPort:9877,studioPort:9878,udpPort:0,ignoreStoredURL:true});
const local=`http://127.0.0.1:${app.studioPort}`;
const session=await fetch(local+'/api/studio').then(r=>r.json());
const control=action=>fetch(local+'/api/control',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${session.token}`},body:JSON.stringify({action,source:12345})});
await control('start');
const udp=dgram.createSocket('udp4');let sequence=0;const start=performance.now();
const audioTimer=setInterval(()=>{const target=Math.floor((performance.now()-start)*48/256);while(sequence<target)udp.send(tonePacket(sequence++),app.udpPort,'127.0.0.1');},5);
const leaseTimer=setInterval(()=>control('lease').catch(()=>{}),1000);
console.log('Isolated listener fixture ready: http://127.0.0.1:9877/listen');
async function stop(){clearInterval(audioTimer);clearInterval(leaseTimer);udp.close();await app.close();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
