import {test} from 'node:test';import assert from 'node:assert/strict';
import {createStreamServer} from '../server/index.mjs';
test('native sender start/stop requires local capability and isolates plugin instances',async t=>{
  const app=await createStreamServer({nativeSender:true,publicPort:0,studioPort:0,udpPort:0,ignoreStoredURL:true});t.after(()=>app.close());
  const local=`http://127.0.0.1:${app.studioPort}`,publicURL=`http://127.0.0.1:${app.publicPort}`;
  const initial=await fetch(local+'/api/studio').then(r=>r.json());assert(initial.native);assert(!initial.live);
  const control=(action,source=101,headers={})=>fetch(local+'/api/control',{method:'POST',headers:{Origin:local,Authorization:`Bearer ${initial.token}`,...headers},body:JSON.stringify({action,source})});
  assert.equal((await control('start',101,{Authorization:'Bearer invalid'})).status,403);
  assert.equal((await fetch(publicURL+'/api/control',{method:'POST'})).status,403);
  assert.equal((await control('generate')).status,200);const invite=await fetch(local+'/api/studio').then(r=>r.json());assert.notEqual(invite.room,initial.room);assert(!invite.live);
  assert.equal((await control('start')).status,200);assert((await fetch(local+'/api/studio').then(r=>r.json())).live);
  assert.equal((await control('start',102)).status,409);assert.equal((await control('stop',102)).status,409);
  assert.equal((await control('stop')).status,200);assert(!(await fetch(local+'/api/studio').then(r=>r.json())).live);
  assert.equal((await control('start')).status,200);assert.equal((await fetch(local+'/api/studio').then(r=>r.json())).room,invite.room,'Stop/start must preserve the invite');
});
