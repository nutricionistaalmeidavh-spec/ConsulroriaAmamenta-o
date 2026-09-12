import { validateDomainEvent } from './domain-event.mjs';

function assertEventType(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('Domain event type must be a non-empty string');
}

export class WebEventBus {
  constructor() { this._subscribers = new Map(); }
  subscribe(eventName, handler) {
    assertEventType(eventName);
    if (typeof handler !== 'function') throw new TypeError('Domain event handler must be a function');
    let handlers = this._subscribers.get(eventName);
    if (!handlers) { handlers = new Set(); this._subscribers.set(eventName, handlers); }
    handlers.add(handler);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      const current = this._subscribers.get(eventName);
      if (!current) return false;
      const deleted = current.delete(handler);
      if (current.size === 0) this._subscribers.delete(eventName);
      return deleted;
    };
  }
  once(eventName, handler) {
    if (typeof handler !== 'function') throw new TypeError('Domain event handler must be a function');
    let unsubscribe;
    const wrapped = event => {
      unsubscribe?.();
      return handler(event);
    };
    unsubscribe = this.subscribe(eventName, wrapped);
    return unsubscribe;
  }
  _handlersFor(type) {
    return Array.from(new Set([...(this._subscribers.get(type) || []), ...(this._subscribers.get('*') || [])]));
  }
  publish(event) {
    validateDomainEvent(event);
    const handlers = this._handlersFor(event.type);
    const failures = [];
    let delivered = 0;
    for (const handler of handlers) {
      try {
        const result = handler(event);
        if (result && typeof result.then === 'function') throw new TypeError('WebEventBus subscribers must be synchronous when using publish()');
        delivered += 1;
      } catch (error) {
        failures.push({ handler: handler.name || 'anonymous', message: error instanceof Error ? error.message : String(error), error });
      }
    }
    return { eventId: event.eventId, type: event.type, subscribers: handlers.length, delivered, failures };
  }
  async publishAsync(event) {
    validateDomainEvent(event);
    const handlers = this._handlersFor(event.type);
    const failures = [];
    let delivered = 0;
    for (const handler of handlers) {
      try { await handler(event); delivered += 1; }
      catch (error) { failures.push({ handler: handler.name || 'anonymous', message: error instanceof Error ? error.message : String(error), error }); }
    }
    return { eventId: event.eventId, type: event.type, subscribers: handlers.length, delivered, failures };
  }
  clear(eventName) {
    if (eventName === undefined) return this._subscribers.clear();
    assertEventType(eventName);
    this._subscribers.delete(eventName);
  }
  subscriberCount(eventName) { assertEventType(eventName); return this._subscribers.get(eventName)?.size || 0; }
}
