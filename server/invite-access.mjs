import {createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

export function validPasscode(value) {
  return value === undefined || (typeof value === 'string' && [...value].length <= 64);
}

// A fresh keyed digest belongs only to this invite. Neither the key, digest,
// nor the original passcode leaves this process or persists on disk.
export class InviteAccess {
  constructor() { this.clear(); }
  clear() { this.key = null; this.digest = null; }
  set(passcode = '') {
    if (!validPasscode(passcode)) throw new TypeError('Passcode must be at most 64 characters.');
    if (!passcode) return this.clear();
    this.key = randomBytes(32);
    this.digest = createHmac('sha256', this.key).update(passcode).digest();
  }
  get required() { return this.digest !== null; }
  accepts(passcode) {
    if (!this.required) return true;
    if (typeof passcode !== 'string' || !validPasscode(passcode)) return false;
    const candidate = createHmac('sha256', this.key).update(passcode).digest();
    return timingSafeEqual(candidate, this.digest);
  }
}

export class JoinAttempts {
  constructor({limit = 6, windowMs = 10000, now = Date.now} = {}) {
    this.limit = limit; this.windowMs = windowMs; this.now = now; this.times = [];
  }
  allow() {
    const now = this.now();
    this.times = this.times.filter(time => now - time < this.windowMs);
    if (this.times.length >= this.limit) return false;
    this.times.push(now); return true;
  }
}
