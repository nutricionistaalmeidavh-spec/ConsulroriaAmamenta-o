export class BroadcastChannelBridge {
  constructor({ bus, channelName = 'artisys-domain-events', BroadcastChannelImpl = globalThis.BroadcastChannel } = {}) {
    if (!bus || typeof bus.subscribe !== 'function' || typeof bus.publishAsync !== 'function') throw new TypeError('BroadcastChannelBridge requires an event bus');
    if (typeof BroadcastChannelImpl !== 'function') throw new TypeError('BroadcastChannel is not available');
    this.bus = bus;
    this.channelName = channelName;
    this.BroadcastChannelImpl = BroadcastChannelImpl;
    this.channel = null;
    this.unsubscribe = null;
    this.receiving = 0;
  }

  start() {
    if (this.channel) return this;
    this.channel = new this.BroadcastChannelImpl(this.channelName);
    this.channel.onmessage = async ({ data }) => {
      this.receiving += 1;
      try { await this.bus.publishAsync(data); }
      finally { this.receiving -= 1; }
    };
    this.unsubscribe = this.bus.subscribe('*', event => {
      if (this.receiving === 0) this.channel?.postMessage(event);
    });
    return this;
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close?.();
      this.channel = null;
    }
  }
}
