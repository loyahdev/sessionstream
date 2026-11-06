import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LinkClient} from '../server/link-client.mjs';
const signedAccount={identity:{sub:'user-test'},status:()=>({phase:'signed-in'})};
const auth={credential:()=> 'a'.repeat(64),clear:async()=>{}};
test('a delayed ownership lookup cannot overwrite a newly saved name',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);
 const client=new LinkClient(signedAccount,auth,{request:async(_url,options)=>options.method==='GET'?pending:Response.json({name:'new-studio'})});
 client.status(); // Starts the ownership lookup before the user saves.
 await client.action('claim','new-studio');assert.equal(client.name,'new-studio');
 release(Response.json({name:'old-studio'}));await new Promise(resolve=>setImmediate(resolve));assert.equal(client.name,'new-studio');
});
test('failed rename retains the current saved name and reports the conflict',async()=>{
 const client=new LinkClient(signedAccount,auth,{request:async(_url,options)=>options.method==='GET'?Response.json({name:'my-studio'}):Response.json({error:'Already claimed'},{status:409})});
 await client.refresh();client.mode='custom';
 await client.action('claim','taken-studio');assert.equal(client.name,'my-studio');assert.equal(client.error,'Already claimed');
});
test('signed-out state keeps random sending available and cannot select the saved custom link',async()=>{
 let requests=0;const client=new LinkClient({status:()=>({phase:'signed-out'})},{credential:()=>null},{request:async()=>{requests++;throw Error();}});
 client.mode='custom';assert.equal(client.status().mode,'random');assert.equal(client.selection(),null);
 await client.action('mode','custom');assert.match(client.error,/Sign in/);assert.equal(requests,0);
});

test('fresh helpers default to random codes despite a legacy custom preference, without releasing the saved name',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'sessionstream-link-default-'));const preferences=path.join(dir,'link-preferences.json');let deletes=0;
 try{
  await writeFile(preferences,JSON.stringify({mode:'custom'}));
  const request=async(_url,options)=>{if(options.method==='DELETE')deletes++;return Response.json({name:'my-studio'});};
  const first=new LinkClient(signedAccount,auth,{preferences,request});await first.refresh();
  assert.equal(first.status().mode,'random');assert.equal(first.name,'my-studio');assert.equal(first.selection(),null);
  await first.action('mode','custom');assert.equal(first.selection().name,'my-studio');
  const second=new LinkClient(signedAccount,auth,{preferences,request});await second.refresh();assert.equal(second.status().mode,'random');assert.equal(second.name,'my-studio');assert.equal(deletes,0);
  assert.equal(JSON.parse(await readFile(preferences,'utf8')).mode,'custom');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('changing accounts resets custom mode so the next account starts with a random code',async()=>{
 const account={identity:{sub:'first-user'},status:()=>({phase:account.identity?'signed-in':'signed-out'})};
 const client=new LinkClient(account,auth,{request:async()=>Response.json({name:'my-studio'})});await client.refresh();await client.action('mode','custom');assert.equal(client.status().mode,'custom');
 account.identity=null;assert.equal(client.status().mode,'random');account.identity={sub:'second-user'};assert.equal(client.status().mode,'random');
});
