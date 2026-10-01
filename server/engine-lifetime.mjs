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
  }
  attach(source) { this.attached = true; this.clients.set(source, this.now()); }
  detach(source) { return this.clients.delete(source); }
  poll() {
    const now = this.now(), expired = [];
    for (const [source, last] of this.clients) {
      if (now - last >= this.leaseMs) { this.clients.delete(source); expired.push(source); }
    }
    return {expired, idle:this.clients.size === 0 && (this.attached || now - this.created >= this.startupMs)};
  }
}
