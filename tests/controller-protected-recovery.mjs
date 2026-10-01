import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const expectedCode = 'protected-recovery-code';
let engine = 1, generation = 0, dropGET = false, initialRestart = false, finalRestart = false;
let starts = 0, protectedGenerations = 0, unprotectedGenerations = 0, detaches = 0;
const failures = [], requests = new Map();
const state = {native: true, controlProtocol: 3, engineProtocol: 1, token: 'engine-1', owner: null, inviteSource: null, inviteRequest: null, live: false, listeners: 0, passcodeRequired: false, listenerIssue: null, publicSiteReady: true, tunnelPhase: 'ready', listenerURL: 'https://ready.trycloudflare.com/listen#initial'};
function replaceEngine(next) {
  engine = next;
  Object.assign(state, {token: `engine-${engine}`, owner: null, inviteSource: null, inviteRequest: null, live: false, passcodeRequired: false, listenerURL: `https://ready.trycloudflare.com/listen#new-engine-${engine}`});
  dropGET = true;
}
const server = http.createServer(async (req, res) => {
  const reply = (status, body) => {res.writeHead(status, {'Content-Type': 'application/json'});res.end(JSON.stringify(body));};
  try {
    if (req.url === '/api/studio') {
      if (dropGET) {dropGET = false;return reply(503, {error: 'Temporary status read failure'});}
      return reply(200, state);
    }
    if (req.url !== '/api/control' && req.url !== '/api/engine') return reply(404, {});
    assert.equal(req.headers.authorization, `Bearer ${state.token}`);
    let body = '';for await (const chunk of req) body += chunk;
    const m = JSON.parse(body);assert.equal(m.source, 101);
    if (req.url === '/api/engine') {
      assert(['attach', 'detach'].includes(m.action));
      if (m.action === 'detach') {
        detaches++;Object.assign(state, {owner: null, inviteSource: null, inviteRequest: null, live: false, passcodeRequired: false, listenerURL: `https://ready.trycloudflare.com/listen#disabled-${detaches}`});
      }
      return reply(200, {ok: true});
    }
    if (m.action === 'generate') {
      assert.equal(typeof m.passcode, 'string');assert(m.requestId);
      const key = `${engine}:${m.requestId}`;
      if (requests.has(key)) assert.equal(m.passcode, requests.get(key), 'A generation retry changed the snapshotted passcode');
      else {
        requests.set(key, m.passcode);generation++;
        if (m.passcode) {assert.equal(m.passcode, expectedCode);protectedGenerations++;}
        else {assert.equal(protectedGenerations, 3, 'Protection was removed before the producer explicitly requested it');unprotectedGenerations++;}
        Object.assign(state, {owner: m.source, inviteSource: m.source, inviteRequest: m.requestId, passcodeRequired: !!m.passcode, live: false, listenerURL: `https://ready.trycloudflare.com/listen#generated-${generation}`});
        if (generation === 1) {dropGET = true;return reply(503, {error: 'Lost initial generation acknowledgement'});}
        if (generation === 2) dropGET = true;
      }
    } else if (m.action === 'start') {
      starts++;
      if (unprotectedGenerations === 0) {
        assert(state.inviteSource === 101 && state.passcodeRequired, 'Audio started before its protected invite was regenerated');
        assert(protectedGenerations >= engine, 'The replacement engine started without its passcode generation');
      } else {
        assert.equal(state.passcodeRequired, false);
        if (state.inviteSource === null) {state.inviteSource = 101;state.listenerURL = 'https://ready.trycloudflare.com/listen#unrestricted-recovery';}
      }
      state.owner = 101;state.live = true;
    } else if (m.action === 'stop') {state.live = false;state.owner = null;}
    else assert.equal(m.action, 'lease');
    return reply(200, {ok: true});
  } catch (error) {failures.push(error);return reply(500, {error: 'Test assertion failed'});}
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn('./build/controller-protected-recovery', [`http://127.0.0.1:${server.address().port}`], {stdio: ['ignore', 'pipe', 'pipe']});
let output = '';
child.stdout.on('data', data => {
  output += data;process.stdout.write(data);
  if (!initialRestart && output.includes('INITIAL_LIVE')) {initialRestart = true;replaceEngine(2);}
  if (!finalRestart && output.includes('UNPROTECTED_LIVE')) {finalRestart = true;replaceEngine(3);}
});
child.stderr.on('data', data => process.stderr.write(data));
const timeout = setTimeout(() => child.kill('SIGTERM'), 55000);
try {
  const result = await new Promise((resolve, reject) => {child.once('error', reject);child.once('exit', (code, signal) => resolve({code, signal}));});
  assert.equal(result.code, 0, `Native recovery probe failed ${result.code}/${result.signal}`);
  assert.deepEqual(failures, []);
  assert.equal(protectedGenerations, 3);assert.equal(unprotectedGenerations, 1);
  assert.equal(starts, 5);assert(detaches >= 2);
  assert(output.includes('PASS: engine restart retained the passcode'));
  assert(output.includes('PASS: bypass and re-enable retained the passcode'));
  assert(output.includes('PASS: explicit unprotected Generate cleared the previous session passcode'));
  console.log('PASS: protected native recovery survived engine replacement, lost responses, bypass, and explicit protection removal');
} finally {clearTimeout(timeout);if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');await new Promise(resolve => server.close(resolve));}
