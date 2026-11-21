// Explicit native-store check: never included in the normal unit test glob.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {CredentialStore} from '../server/credential-store.mjs';
const id=`test-${randomBytes(16).toString('hex')}`;const store=new CredentialStore('https://test.invalid',id);
try {
  assert.equal(await store.read(),null);
  await store.write('sessionstream-test-token',{interactive:true});
  const restarted=new CredentialStore('https://test.invalid',id);assert.equal(await restarted.read(),'sessionstream-test-token');
  const write=store.write('sessionstream-test-rotation'),clear=store.clear();await Promise.all([write,clear]);
  assert.equal(await store.read(),null);
  console.log('PASS: native credential write/read, rotation, and ordered sign-out cleanup');
} finally {await store.clear();}
