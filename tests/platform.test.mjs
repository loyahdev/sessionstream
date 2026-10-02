import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeStateDirectory, executableName} from '../server/platform.mjs';

test('Windows runtime uses executable extensions and writable per-user state',()=>{
  assert.equal(executableName('cloudflared','win32'),'cloudflared.exe');
  assert.equal(runtimeStateDirectory({platform:'win32',env:{LOCALAPPDATA:'C:\\Users\\Producer\\AppData\\Local'},home:'C:\\Users\\Producer'}),'C:\\Users\\Producer\\AppData\\Local\\SessionStream\\Cache');
  assert.equal(runtimeStateDirectory({platform:'win32',env:{},home:'C:\\Users\\Producer'}),'C:\\Users\\Producer\\AppData\\Local\\SessionStream\\Cache');
});

test('macOS paths and explicit state overrides are retained',()=>{
  assert.equal(executableName('cloudflared','darwin'),'cloudflared');
  assert.equal(runtimeStateDirectory({platform:'darwin',env:{},home:'/Users/Producer'}),'/Users/Producer/Library/Caches/SessionStream');
  assert.equal(runtimeStateDirectory({platform:'win32',env:{SESSIONSTREAM_STATE_DIR:'D:\\SessionStream test'},home:'C:\\Users\\Producer'}),'D:\\SessionStream test');
});
