/** Single retry probe during an outage; healthy requests retain concurrent telemetry writes. */
export class RouterTelemetry {
  private retryAt = 0;
  private degraded = true;
  private probing = false;
  constructor(private readonly report: (error: unknown) => void, private readonly now = Date.now) {}
  async record(write: () => Promise<void>): Promise<boolean> {
    if (this.now() < this.retryAt || this.degraded && this.probing) return false;
    const probe = this.degraded;
    if (probe) this.probing = true;
    try {
      await write();
      if (probe) { this.retryAt = 0; this.degraded = false; }
      return true;
    } catch (error) {
      this.degraded = true;
      if (this.now() >= this.retryAt) { this.retryAt = this.now() + 60_000; this.report(error); }
      return false;
    } finally { if (probe) this.probing = false; }
  }
}
