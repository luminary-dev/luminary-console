# 1. Outstanding-balance semantics

Date: 2026-08-26

## Status

Accepted. Implements the fix for LC-003 (`docs/audit/FINDINGS.md`).

## Context

`summarizeMoney` in `lib/money.ts` is the one place the console decides how
much money a client owes. Its result is read on the dashboard, on the client
page, in `BillingCard`, in the CSV export, in the daily digest, in the
assistant's context block, and in the handover pack the client is sent at the
end of a project.

The original arithmetic compared two aggregates:

```
invoiced    = sum of parsable totals of PUBLISHED invoices
paid        = sum of EVERY recorded payment
outstanding = max(0, invoiced - paid)
```

The two sides were not symmetrical, and the clamp hid the difference:

1. A `Payment` may carry an `invoiceSlug`, but the field is optional. An
   untagged payment counted toward `paid` and so reduced the balance of
   invoices it had nothing to do with.
2. A payment tagged to an invoice that was still a draft (recorded before the
   invoice was published, which is the normal order of events when money
   arrives early) also counted toward `paid`, while its invoice contributed
   nothing to `invoiced`.
3. A payment against an invoice whose stored total did not parse counted
   toward `paid`, while the invoice was excluded from `invoiced` by design.
4. `Math.max(0, ...)` clamped the result, so overpayment was indistinguishable
   from an exactly settled account.

The result: the dashboard and the client page could say "settled" while an
invoice was genuinely unpaid, and could never say that too much had been paid.
`lib/handover.ts` had already met the same asymmetry from the other side and
reconciled it with an explicit "Other payments received" line; the dashboard
and `BillingCard` had not.

This is money the owner reads daily, so the change moves numbers already on
screen. That is the point of writing it down.

## Decision

Outstanding is computed **per invoice, from the payments attributed to that
invoice**, and then summed:

```
for each PUBLISHED invoice b:
    total  = parsed grand total of b, or null
    paid_b = sum of payments whose invoiceSlug === b.slug
    owed_b = total === null ? 0 : max(0, total - paid_b)
    over_b = total === null ? 0 : max(0, paid_b - total)

outstanding  = sum of owed_b
overpaid     = sum of over_b
attributed   = sum of paid_b            (published invoices, parsable or not)
paid         = sum of ALL payments      (unchanged)
unattributed = max(0, paid - attributed)
```

Three consequences of that definition are deliberate:

- **A payment settles only the invoice it names.** Untagged payments, and
  payments naming a draft or deleted invoice, land in `unattributed`. They are
  displayed, never netted off the balance.
- **Overpayment is a number, not a clamp.** `overpaid` is reported separately;
  `outstanding` still never goes negative, because a credit on one invoice is
  not a payment against another.
- **Unreadable totals stay out of the arithmetic** (as before) but their
  payments still count as attributed, so they never inflate `unattributed`.

The `MoneySummary` type is extended additively. `invoiced`, `paid`,
`outstanding` and `unparsable` keep their names and their types; `attributed`,
`unattributed`, `overpaid` and `invoices` (per-invoice attribution) are new.
Every existing consumer keeps compiling and reading the fields it read before.
`paid` in particular keeps its old "every recorded payment" meaning, because
`lib/handover.ts` derives its "Other payments received" line from it.

`BillingCard` now states all four quantities: what is invoiced and published,
what has been received, how much of that is assigned to a published invoice,
what is unassigned, and what is overpaid.

## Consequences

- **Balances go up for some clients.** Any client with an untagged payment, or
  a payment recorded against an invoice that is still a draft, will show an
  outstanding balance where it previously showed "settled". That balance is the
  correct one. The unassigned amount is shown directly under it with the action
  that clears it: record the payment against the invoice it settles, or publish
  that invoice.
- **The dashboard's "outstanding clients" count and total, the CSV export's
  Outstanding column, and the digest's figures move with it.** They all read
  the same function, which is why the fix is in one place.
- **Overpayment is now visible** on the billing card. It was previously
  invisible in every surface.
- Per-invoice numbers (`money.invoices`) are available to callers that want to
  show attribution without recomputing it; `invoiceStatus` keeps its own,
  unchanged, per-invoice view for due and overdue detection.
- The remaining known gap is unchanged by this decision: `Payment.invoiceSlug`
  is optional, so operators can still record money without saying what it
  settles. This ADR makes that choice visible rather than silently absorbing
  it. Making the field required is a separate change with a data migration.
