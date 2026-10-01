const descriptions = {
  'audio-blocked': 'A listener needs to enable audio playback in their browser.',
  'connection-failed': 'A listener lost their audio connection and is reconnecting.',
  'audio-stalled': 'Audio stopped reaching a listener. Check their connection.'
};

export class ListenerHealth {
  constructor({ttlMs = 10000, now = Date.now} = {}) {
    this.ttlMs = ttlMs; this.now = now; this.states = new Map();
  }
  report(id, state) {
    if (state !== 'ok' && !Object.hasOwn(descriptions, state)) return false;
    if (state === 'ok') this.remove(id);
    else this.states.set(id, {state, at: this.now()});
    return true;
  }
  remove(id) { this.states.delete(id); }
  clear() { this.states.clear(); }
  issue(live) {
    if (!live) return null;
    const now = this.now();
    for (const [id, report] of this.states) if (now - report.at >= this.ttlMs) this.remove(id);
    // Stable server-authored wording prevents remote clients injecting text
    // into the native plugin. Multiple listeners still need only one notice.
    for (const state of Object.keys(descriptions)) {
      if ([...this.states.values()].some(report => report.state === state)) return descriptions[state];
    }
    return null;
  }
}
