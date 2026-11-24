// Only enabled plugin controllers keep the managed helper alive. Listeners,
// status reads and audio packets cannot extend its lifetime.
export class EngineLifetime {
  constructor({now = Date.now, leaseMs = 5000, startupMs = 8000} = {}) {
    this.now = now;
    this.leaseMs = leaseMs;
    this.startupMs = startupMs;
    this.created = now();
    this.attached = false;
    this.clients = new Map();
    this.requests = new Map();
  }
  attach(source) { this.attached = true; this.clients.set(source, this.now()); }
  detach(source) {
    this.requests.delete(source);
    return this.clients.delete(source);
  }
  // The controller waits synchronously for control responses. Allow it to
  // wait up to its 40-second HTTP timeout without losing its lease.
  trackRequest(source, response, onFinish) {
    if (!this.clients.has(source) || response.destroyed) return;
    const request = {deadline:this.now() + 40000};
    this.requests.set(source, request);
    const clear = () => {
      if (this.requests.get(source) === request) this.requests.delete(source);
    };
    response.once('finish', () => {
      if (this.requests.get(source) === request && this.now() < request.deadline) {
        this.attach(source);
        onFinish();
      }
      clear();
    });
    response.once('close', clear);
  }
  isHandlingRequest(source) {
    const request = this.requests.get(source);
    return request !== undefined && this.now() < request.deadline;
  }
  poll() {
    const now = this.now(), expired = [];
    for (const [source, last] of this.clients) {
      if (now - last >= this.leaseMs && !this.isHandlingRequest(source)) {
        this.detach(source);
        expired.push(source);
      }
    }
    return {expired, idle:this.clients.size === 0 && (this.attached || now - this.created >= this.startupMs)};
  }
}
