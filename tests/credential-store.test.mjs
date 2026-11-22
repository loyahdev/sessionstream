import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CredentialStore} from '../server/credential-store.mjs';

test('credential helper runs silently by default, passes interactive intent and recovers after denial',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'ss-credential-policy-'));
 try{
  const binary=path.join(directory,'helper');
  await writeFile(binary,`#!${process.execPath}
const [action,key,mode]=process.argv.slice(2);if(key.length!==64)process.exit(2);if(mode!=='--interactive')process.exit(3);if(action==='read')process.stdout.write(JSON.stringify({refreshToken:'test-only'}));
`);
  await chmod(binary,0o700);
  const store=new CredentialStore('https://test.invalid','policy',{binary});
  await assert.rejects(store.read(),{code:'SECURE_STORAGE_AUTH_REQUIRED'});
  assert.equal(await store.read({interactive:true}),'test-only');
  await assert.rejects(store.write('test-only'),{code:'SECURE_STORAGE_AUTH_REQUIRED'});
  await store.write('test-only',{interactive:true});
  await assert.rejects(store.clear(),{code:'SECURE_STORAGE_AUTH_REQUIRED'});
  await store.clear({interactive:true});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('blocked background enrollment stops retrying and explicit reconnect preserves the existing device',async()=>{
 const {DashboardClient}=await import('../server/dashboard-client.mjs');
 const record={device:'12345678-1234-1234-1234-123456789abc',deviceCredential:'a'.repeat(64)};
 const reads=[],requests=[];let clears=0;
 const account={identity:{sub:'test'},status:()=>({phase:'signed-in'}),accessCredential:()=> 'test-only'};
 const client=new DashboardClient({account,autoTimer:false,storeFactory:()=>({read:async options=>{reads.push(options.interactive);if(!options.interactive)throw Object.assign(Error('approval'),{code:'SECURE_STORAGE_AUTH_REQUIRED'});return JSON.stringify(record);},clear:async()=>{clears++;}}),fetchImpl:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return Response.json({plan:'pro',listeners:8});}});
 try{
  await client.tick();assert.equal(client.status().reconnectRequired,true);
  assert.equal(client.blockedStatus,423);assert.deepEqual(reads,[false]);
  await client.tick();assert.deepEqual(reads,[false]);
  assert.equal((await client.reconnectAfterSignIn()).ok,true);
  assert.deepEqual(reads,[false,true]);assert.equal(clears,0);
  assert.equal(requests.length,1);assert.match(requests[0].url,/\/report$/);
  assert.equal(requests[0].body.device,record.device);
  assert.equal(client.authorizingCredentials,false);
 }finally{await client.close();}
});
