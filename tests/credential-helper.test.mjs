import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lstat,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {preserveCredentialHelper} from '../server/credential-store.mjs';

test('updating the bundled executable preserves the first private credential helper', {skip:process.platform==='win32'}, async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'sessionstream-credential-helper-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bundled=path.join(root,'bundled'),privateDir=path.join(root,'Keychain');
  await writeFile(bundled,'original credential helper');
  const [one,two]=await Promise.all([preserveCredentialHelper(bundled,privateDir),preserveCredentialHelper(bundled,privateDir)]);
  assert.equal(one,two);
  assert.equal((await lstat(one)).mode&0o777,0o700);
  await writeFile(bundled,'helper from the update');
  assert.equal(await preserveCredentialHelper(bundled,privateDir),one);
  assert.equal(await readFile(one,'utf8'),'original credential helper');
  await rm(one);await symlink(bundled,one);
  await assert.rejects(preserveCredentialHelper(bundled,privateDir),/Invalid credential helper/);
});
