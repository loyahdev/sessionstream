import {test} from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {createStreamServer} from '../server/index.mjs';
import {tonePacket} from '../server/protocol.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(port, t) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/signal`, {origin: `http://127.0.0.1:${port}`});
  ws.messages = [];
  ws.on('message', (data, binary) => ws.messages.push(binary ? {type: 'binary', data} : JSON.parse(data)));
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  return ws;
}
async function message(ws, type) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const index = ws.messages.findIndex(m => m.type === type);
    if (index >= 0) return ws.messages.splice(index, 1)[0];
    await delay(10);
  }
  throw new Error(`Timed out waiting for ${type}`);
}
function join(ws, room, passcode) {
  ws.send(JSON.stringify({type: 'join', role: 'listener', room, passcode}));
}
function closeCode(ws) { return new Promise(resolve => ws.once('close', resolve)); }

test('protected invites authenticate before signaling or audio and preserve generation retries', async t => {
  const app = await createStreamServer({nativeSender: true, publicPort: 0, studioPort: 0, udpPort: 0, ignoreStoredURL: true});
  t.after(() => app.close());
  const local = `http://127.0.0.1:${app.studioPort}`, publicURL = `http://127.0.0.1:${app.publicPort}`;
  const status = () => fetch(`${local}/api/studio`).then(response => response.json());
  const initial = await status(), source = 723;
  const control = body => fetch(`${local}/api/control`, {method: 'POST', headers: {Origin: local, Authorization: `Bearer ${initial.token}`}, body: JSON.stringify({source, ...body})});
  const invitation = room => fetch(`${publicURL}/api/invite`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({room})});
  const generate = async (passcode, requestId = randomUUID()) => {
    assert.equal((await control({action: 'generate', requestId, passcode})).status, 200);
    return {...await status(), requestId};
  };
  assert.equal(initial.controlProtocol, 3); assert.equal(initial.passcodeRequired, false);
  const protectedInvite = await generate('mix 123 🎧');
  assert(protectedInvite.passcodeRequired); assert.equal(protectedInvite.listenerIssue, null);
  assert(!JSON.stringify(protectedInvite).includes('mix 123 🎧'));
  assert.equal(protectedInvite.listenerURL.split('#')[1], protectedInvite.room);
  const lookup = await invitation(protectedInvite.room);
  assert.equal(lookup.status, 200); assert.deepEqual(await lookup.json(), {passcodeRequired: true});
  const invalid = await invitation('0'.repeat(48));
  assert.equal(invalid.status, 403); assert.deepEqual(await invalid.json(), {error: 'Invalid invite'});
  assert.equal((await control({action: 'generate', passcode: 'x'.repeat(65)})).status, 400);
  assert.equal((await control({action: 'generate', passcode: false})).status, 400);
  assert.equal((await status()).room, protectedInvite.room);
  assert.equal((await control({action: 'generate', requestId: protectedInvite.requestId, passcode: 'changed on retry'})).status, 200);
  assert.equal((await status()).room, protectedInvite.room);
  assert.equal((await control({action: 'start'})).status, 200);
  const listener = await connect(app.publicPort, t);
  join(listener, protectedInvite.room);
  assert.deepEqual(await message(listener, 'passcode-required'), {type: 'passcode-required', invalid: false});
  join(listener, protectedInvite.room, 'wrong');
  assert.deepEqual(await message(listener, 'passcode-required'), {type: 'passcode-required', invalid: true});
  join(listener, protectedInvite.room, 'changed on retry');
  assert.equal((await message(listener, 'passcode-required')).invalid, true);
  const udp = dgram.createSocket('udp4'); t.after(() => udp.close());
  udp.send(tonePacket(1, 256, 48000, source), app.udpPort, '127.0.0.1');
  await delay(120);
  assert.deepEqual(listener.messages, [], 'An unauthenticated listener must not see status, ICE, offers, candidates or audio');
  assert.equal((await status()).listeners, 0);
  join(listener, protectedInvite.room, 'mix 123 🎧');
  const joined = await message(listener, 'joined'); assert(joined.iceServers.length);
  assert.equal((await status()).listeners, 1);
  listener.send(JSON.stringify({type: 'mode', mode: 'pcm'})); await delay(30);
  udp.send(tonePacket(2, 256, 48000, source), app.udpPort, '127.0.0.1');
  assert.equal((await message(listener, 'binary')).data.length, tonePacket(2).length);
  listener.send(JSON.stringify({type: 'listener-health', state: 'audio-blocked', text: 'Untrusted arbitrary message'}));
  await delay(30);
  assert.equal((await status()).listenerIssue, 'A listener needs to enable audio playback in their browser.');
  listener.send(JSON.stringify({type: 'listener-health', state: 'ok'})); await delay(30);
  assert.equal((await status()).listenerIssue, null);
  listener.send(JSON.stringify({type: 'listener-health', state: 'muted'})); await delay(30);
  assert.equal((await status()).listenerIssue, null);
  listener.send(JSON.stringify({type: 'listener-health', state: 'audio-stalled'})); await delay(30);
  assert((await status()).listenerIssue);
  assert.equal((await control({action: 'stop'})).status, 200); assert.equal((await status()).listenerIssue, null);
  listener.send(JSON.stringify({type: 'listener-health', state: 'audio-blocked'})); await delay(30);
  assert.equal((await status()).listenerIssue, null, 'Stopped sessions ignore stale listener errors');
  assert.equal((await control({action: 'start'})).status, 200); assert.equal((await status()).listenerIssue, null);
  const reconnection = await connect(app.publicPort, t);
  join(reconnection, protectedInvite.room);
  await message(reconnection, 'passcode-required');
  assert.equal((await status()).listeners, 1, 'Opening a fresh socket requires the passcode again');
  join(reconnection, protectedInvite.room, 'mix 123 🎧'); await message(reconnection, 'joined');
  const unauthenticated = await connect(app.publicPort, t), unauthorizedClose = closeCode(unauthenticated);
  unauthenticated.send(JSON.stringify({type: 'listener-health', state: 'audio-blocked'}));
  assert.equal(await unauthorizedClose, 4001); assert.equal((await status()).listenerIssue, null);
  const listenerClosed = closeCode(listener), reconnectionClosed = closeCode(reconnection);
  const replacement = await generate('new passcode');
  assert.notEqual(replacement.room, protectedInvite.room);
  assert.equal(await listenerClosed, 4003); assert.equal(await reconnectionClosed, 4003);
  assert.equal((await invitation(protectedInvite.room)).status, 403);
  const oldRoom = await connect(app.publicPort, t), oldClosed = closeCode(oldRoom);
  join(oldRoom, protectedInvite.room, 'mix 123 🎧'); assert.equal(await oldClosed, 4003);
  const oldCode = await connect(app.publicPort, t); join(oldCode, replacement.room, 'mix 123 🎧');
  assert.equal((await message(oldCode, 'passcode-required')).invalid, true);
  join(oldCode, replacement.room, 'new passcode'); await message(oldCode, 'joined');
  const unrestricted = await generate('');
  assert.equal(unrestricted.passcodeRequired, false);
  assert.deepEqual(await invitation(unrestricted.room).then(response => response.json()), {passcodeRequired: false});
  const openListener = await connect(app.publicPort, t); join(openListener, unrestricted.room);
  await message(openListener, 'joined'); assert.equal((await status()).passcodeRequired, false);
  const disabledInvite = await generate('temporary code');
  assert.equal(disabledInvite.passcodeRequired, true);
  const engine = await fetch(`${local}/api/engine`, {method: 'POST', headers: {Origin: local, Authorization: `Bearer ${initial.token}`}, body: JSON.stringify({action: 'detach', source})});
  assert.equal(engine.status, 200); assert.equal((await status()).passcodeRequired, false);
  assert.notEqual((await status()).room, disabledInvite.room);
  assert.equal((await invitation(disabledInvite.room)).status, 403);
});

test('passcode guessing is bounded on a socket and across reconnects', async t => {
  const app = await createStreamServer({nativeSender: true, publicPort: 0, studioPort: 0, udpPort: 0, ignoreStoredURL: true});
  t.after(() => app.close());
  const local = `http://127.0.0.1:${app.studioPort}`;
  const session = await fetch(`${local}/api/studio`).then(response => response.json());
  await fetch(`${local}/api/control`, {method: 'POST', headers: {Origin: local, Authorization: `Bearer ${session.token}`}, body: JSON.stringify({action: 'generate', source: 124, passcode: 'secret'})});
  const room = await fetch(`${local}/api/studio`).then(response => response.json()).then(status => status.room);
  for (let socketIndex = 0; socketIndex < 5; socketIndex++) {
    const ws = await connect(app.publicPort, t), closed = closeCode(ws);
    for (let attempt = 0; attempt < 6; attempt++) {
      join(ws, room, 'guess'); await message(ws, 'passcode-required');
    }
    join(ws, room, 'guess'); assert.equal(await closed, 4008);
  }
  const ws = await connect(app.publicPort, t), closed = closeCode(ws);
  join(ws, room, 'guess'); assert.equal(await closed, 4008);
  assert.deepEqual(ws.messages, []);
  assert.equal((await fetch(`${local}/api/studio`).then(response => response.json())).listeners, 0);
});

test('multibyte passcodes survive separate HTTP chunks and malformed requests remain bounded', async t => {
  const app = await createStreamServer({nativeSender: true, publicPort: 0, studioPort: 0, udpPort: 0, ignoreStoredURL: true});
  t.after(() => app.close());
  const local = `http://127.0.0.1:${app.studioPort}`, session = await fetch(`${local}/api/studio`).then(response => response.json());
  const headers = {Origin: local, Authorization: `Bearer ${session.token}`};
  const body = Buffer.from(JSON.stringify({action: 'generate', source: 923, passcode: 'café 🎧'}));
  const split = body.indexOf(Buffer.from('🎧')) + 1;
  const response = await new Promise((resolve, reject) => {
    const req = http.request(`${local}/api/control`, {method: 'POST', headers}, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.once('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => req.end(body.subarray(split)), 20);
  });
  assert.equal(response, 200);
  const invite = await fetch(`${local}/api/studio`).then(response => response.json());
  const ws = await connect(app.publicPort, t); join(ws, invite.room, 'café 🎧'); await message(ws, 'joined');
  assert.equal((await fetch(`${local}/api/control`, {method: 'POST', headers, body: 'null'})).status, 400);
  assert.equal((await fetch(`${local}/api/control`, {method: 'POST', headers, body: 'x'.repeat(2049)})).status, 413);
});

test('native listener signaling uses the authenticated socket identity rather than a forged peer ID', async t => {
  const app = await createStreamServer({nativeSender: true, publicPort: 0, studioPort: 0, udpPort: 0, ignoreStoredURL: true});
  let leaseTimer;
  t.after(async () => {clearInterval(leaseTimer);await app.close();});
  const local = `http://127.0.0.1:${app.studioPort}`, session = await fetch(`${local}/api/studio`).then(response => response.json());
  const control = action => fetch(`${local}/api/control`, {method: 'POST', headers: {Origin: local, Authorization: `Bearer ${session.token}`}, body: JSON.stringify({source: 481, action})});
  assert.equal((await control('generate')).status, 200);
  const room = await fetch(`${local}/api/studio`).then(response => response.json()).then(status => status.room);
  assert.equal((await control('start')).status, 200);
  leaseTimer = setInterval(() => control('lease').catch(() => {}), 1000);
  const first = await connect(app.publicPort, t), second = await connect(app.publicPort, t);
  join(first, room); const firstJoin = await message(first, 'joined'), firstOffer = await message(first, 'offer');
  join(second, room); const secondJoin = await message(second, 'joined'); await message(second, 'offer');
  assert.notEqual(firstJoin.id, secondJoin.id);
  first.send(JSON.stringify({type: 'renegotiate', id: secondJoin.id, to: secondJoin.id, from: secondJoin.id}));
  const regenerated = await message(first, 'offer');
  assert.notEqual(regenerated.generation, firstOffer.generation);
  await delay(120);
  assert(!second.messages.some(m => m.type === 'offer'), 'A forged ID caused renegotiation on another listener');
  assert.equal((await fetch(`${local}/api/studio`).then(response => response.json())).listeners, 2);
});
