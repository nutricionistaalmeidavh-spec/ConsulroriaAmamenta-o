function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Domain event ${field} must be a non-empty string`);
}

export function validateDomainEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new TypeError('Domain event must be an object');
  assertNonEmptyString(event.eventId, 'eventId');
  assertNonEmptyString(event.type, 'type');
  assertNonEmptyString(event.aggregate, 'aggregate');
  if (event.aggregateId === undefined || event.aggregateId === null || event.aggregateId === '') throw new TypeError('Domain event aggregateId is required');
  assertNonEmptyString(event.occurredAt, 'occurredAt');
  assertNonEmptyString(event.source, 'source');
  if (!event.actor || typeof event.actor !== 'object' || Array.isArray(event.actor)) throw new TypeError('Domain event actor must be an object');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new TypeError('Domain event payload must be an object');
  if (event.mutationId !== undefined && event.mutationId !== null) assertNonEmptyString(event.mutationId, 'mutationId');
  return event;
}

export function createDomainEvent(input = {}) {
  const event = {
    eventId: input.eventId,
    type: input.type,
    aggregate: input.aggregate,
    aggregateId: input.aggregateId,
    occurredAt: input.occurredAt || new Date().toISOString(),
    source: input.source || 'web-app',
    actor: input.actor || {},
    payload: input.payload || {}
  };
  if (input.mutationId !== undefined && input.mutationId !== null) event.mutationId = input.mutationId;
  return validateDomainEvent(event);
}
