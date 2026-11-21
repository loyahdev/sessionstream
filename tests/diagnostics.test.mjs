import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRuntimeLogger,redactLog,createLineLogger} from '../server/diagnostics.mjs';

test('retained logs contain errors and redact invites and credentials, including split tunnel chunks',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'sessionstream-logs-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const log=createRuntimeLogger('engine',{directory});
  const capture=createLineLogger(line=>log('cloudflared',line));
  capture(Buffer.from('ERR connection failed https://private.trycloud'));capture(Buffer.from('flare.com/listen#secret-invite\ntoken="secret-token" pass'));capture(Buffer.from('code="two word secret"\n'));capture.end();
  log('error','Native signaling: failed to set remote description');
  const text=await readFile(path.join(directory,'engine.log'),'utf8');
  for(const secret of ['private.trycloud','secret-invite','secret-token','two word secret'])assert(!text.includes(secret),secret);
  assert(text.includes('ERR connection failed'));assert(text.includes('failed to set remote description'));
  const redacted=redactLog('Authorization: Bearer super-secret {"room":"abc123", "password":"top secret"}');
  for(const secret of ['super-secret','abc123','top secret'])assert(!redacted.includes(secret));
});
test('logs rotate with bounded storage and preserve previous engine runs',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'sessionstream-log-rotation-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const log=createRuntimeLogger('engine',{directory,maxBytes:256});
  for(let i=0;i<20;++i)log('event',`attempt ${i} ${'x'.repeat(70)}`);
  const files=await readdir(directory);assert.deepEqual(files.sort(),['engine.log','engine.log.1','engine.log.2']);
  for(const file of files)assert((await readFile(path.join(directory,file))).length<=256);
  const restarted=createRuntimeLogger('engine',{directory,maxBytes:256});restarted('event','restarted');
  assert((await readFile(path.join(directory,'engine.log'),'utf8')).includes('restarted'));
  assert.doesNotThrow(()=>createRuntimeLogger('engine',{directory:path.join(directory,'engine.log')})('error','unwritable'));
});
