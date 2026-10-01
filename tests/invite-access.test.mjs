import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InviteAccess, JoinAttempts, validPasscode} from '../server/invite-access.mjs';
import {ListenerHealth} from '../server/listener-health.mjs';
import {needsLegacyUpgrade} from '../server/retire-legacy.mjs';

test('invite passcodes remain memory-only keyed digests and rotate with the invite', () => {
  const access = new InviteAccess();
  assert(!access.required); assert(access.accepts(undefined));
  access.set('Studio 🎧 123');
  assert(access.required); assert(access.accepts('Studio 🎧 123'));
  assert(!access.accepts(undefined)); assert(!access.accepts('Studio 🎧 124'));
  assert(!access.accepts({toString: () => 'Studio 🎧 123'}));
  const firstKey = Buffer.from(access.key), firstDigest = Buffer.from(access.digest);
  access.set('Studio 🎧 123');
  assert.notDeepEqual(access.key, firstKey); assert.notDeepEqual(access.digest, firstDigest);
  assert(!Object.values(access).includes('Studio 🎧 123'));
  access.set('different'); assert(!access.accepts('Studio 🎧 123'));
  access.clear(); assert(!access.required); assert(access.accepts(undefined));
  assert(validPasscode('🎧'.repeat(64))); assert(!validPasscode('🎧'.repeat(65)));
  assert(!validPasscode(null)); assert(!validPasscode(123));
});

test('passcode attempts are bounded and become available after the rate window', () => {
  let now = 100;
  const attempts = new JoinAttempts({now: () => now});
  for (let n = 0; n < 6; n++) assert(attempts.allow());
  assert(!attempts.allow()); now += 9999; assert(!attempts.allow());
  now++; assert(attempts.allow());
});

test('listener error notices use fixed wording, clear on recovery and expire', () => {
  let now = 100;
  const health = new ListenerHealth({now: () => now});
  assert.equal(health.issue(true), null);
  assert(!health.report('listener', '<script>arbitrary text</script>'));
  assert(!health.report('listener', 'muted')); assert(!health.report('listener', 'stopped'));
  assert.equal(health.issue(true), null);
  assert(health.report('listener', 'audio-stalled'));
  assert.equal(health.issue(false), null);
  assert.equal(health.issue(true), 'Audio stopped reaching a listener. Check their connection.');
  now += 9999; assert(health.issue(true)); now++; assert.equal(health.issue(true), null);
  health.report('listener', 'connection-failed'); health.report('listener', 'ok');
  assert.equal(health.issue(true), null);
  health.report('listener', 'audio-blocked'); health.remove('listener');
  assert.equal(health.issue(true), null);
  health.report('listener', 'audio-blocked'); health.clear();
  assert.equal(health.issue(true), null);
});

test('legacy replacement accepts old idle helpers and preserves active broadcasts', () => {
  assert(needsLegacyUpgrade({native: true, live: false}));
  assert(needsLegacyUpgrade({native: true, live: false, engineProtocol: 1, controlProtocol: 2}));
  assert(!needsLegacyUpgrade({native: true, live: true, engineProtocol: 1, controlProtocol: 2}));
  assert(!needsLegacyUpgrade({native: true, live: true}));
  assert(!needsLegacyUpgrade({native: false, live: false}));
  assert(!needsLegacyUpgrade({native: true, live: false, engineProtocol: 1, controlProtocol: 3}));
  assert(!needsLegacyUpgrade({native: true, live: false, engineProtocol: 1, controlProtocol: 4}));
});
