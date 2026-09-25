# Débora Observability — Cross-Repo Contract Addendum

This addendum is part of the approved implementation plan and resolves cross-repository details that must stay identical between `ConsulroriaAmamenta-o` and `OBRANAMAOCOMERCIAL`. If an older plan step conflicts with this document, this document wins.

## Sales merge ordering

The Central must merge automatic Asaas sales from Débora with manual sales stored in the Central without duplicates or gaps.

Global descending sort tuple:

```text
(createdAt DESC, sourceRank DESC, id DESC)
```

Fixed source ranks:

```text
Asaas / Débora billing = 1
Manual / Central       = 0
```

The Central cursor is opaque to the browser and encodes:

```json
{"v":1,"createdAt":"2026-09-25T12:00:00.000Z","sourceRank":1,"id":"sale-id"}
```

When the Central requests the next automatic page, it passes the decoded boundary to Débora as:

```text
mergeCreatedAt
mergeSourceRank
mergeId
```

The Débora automatic-sales query has fixed `sourceRank = 1` and applies this boundary:

```text
created_at < mergeCreatedAt
OR (
  created_at = mergeCreatedAt
  AND (
    1 < mergeSourceRank
    OR (1 = mergeSourceRank AND id < mergeId)
  )
)
```

The Central manual-sales query uses the same rule with fixed `sourceRank = 0`.

Both sources fetch `limit + 1`, the Central merges/sorts both streams by the global tuple, returns at most `limit`, and emits a new cursor from the last visible item. Tests must cover equal timestamps across both sources.

## Users and Central-owned filters

The Débora `/users` endpoint remains the canonical account stream and uses keyset pagination. The Central enriches only the remote page currently being scanned with local license/manual-sale data by normalized e-mail.

Filters that depend on Central-only data — including manual `pro_6m`, manual acquisition channel and manual payment status — must still be applied server-side without loading the full account table.

The Central implements bounded page scanning:

1. request at most the remaining page size from Débora;
2. enrich only those returned e-mails with local D1 queries;
3. apply Central-owned filters;
4. if fewer than the requested number match, continue from the returned remote cursor;
5. stop when the requested page is full, upstream is exhausted, or a hard scan budget of 500 remote users is reached;
6. return the remote cursor after the last scanned batch as the next cursor when more upstream data may exist.

Because each upstream request size is `remaining`, no unconsumed matching rows are discarded inside a batch and no buffer needs to be stored in the cursor.

`limit` remains maximum 100. This scanning strategy is bounded, server-side, and never loads the entire user table.

## Internal users helper for exact e-mail enrichment

The Débora internal users query may accept an optional exact `emails` filter containing at most 100 normalized e-mails. This is an internal optimization only and does not replace the canonical paginated account stream.

## Production vs sandbox

Central-facing production metrics and sales exclude `provider='asaas_sandbox'` by default. Sandbox is test data and must not contribute to paid-sales count, realized revenue or active-production subscription metrics.

## Failure isolation

A failure of any observability call returns an observability-specific unavailable state. It must not alter or block Central license grant, renew, status or revoke operations.
