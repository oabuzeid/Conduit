# PRD — Automated Mileage Incidentals

Helping hosts charge the right amount, automatically.

| | |
|---|---|
| **POC** | Aini, Othman, Gopi |
| **Status** | Draft |
| **Last updated** | May 6, 2026 |
| **Scope** | MVP — Mileage only |
| **Figma** | [Mileage collection for Hosts](https://figma.com/design/HlA98uCanTiaEDsJ0mehmu/-DEV--Mileage-collection-for-Hosts?node-id=201-13314) |

**Timeline:**

- Internal review on May 13th
- Design review on May 21st
- Eng starts on May 26th

## 1. Overview

At trip end (checkout), hosts can send guests an incidental invoice for things like theft, damage, tolls, tickets, and excess mileage. Today, the host types in the excess mileage value themselves and uploads evidence. We calculate the charge at $2/extra mile.

If the total invoice is under $100, it auto-charges the guest. If it's $100 or more, it routes to claims for review.

About 5% of US trips trigger an auto-submit mileage incidental under $100. Because the system fully trusts host-typed input, we have no protection against incorrect or inflated values.

## 2. Problems

Mileage incidentals rely entirely on host self-reporting. That creates two risks:

- **False charges from honest mistakes** — host types a wrong number that is higher than the actual excess.
- **Abuse of the under-$100 auto-charge** — a host can submit an inflated value and the guest is charged with no review.

Both erode guest trust and create downstream support and dispute load.

## 3. Opportunity

We already collect mileage data with AI from the vehicle (AI mileage collection project). We can use that data to pre-calculate excess mileage on the host's behalf — turning a self-reported number into a system-verified one.

This shifts the host from data-entry to review-and-confirm, which is faster for them and safer for guests.

## 4. Goals

- Improve the accuracy of mileage incidental invoices.
- Reduce false or inflated mileage charges to guests.
- Make it faster and easier for honest hosts to charge correctly.
- Keep the host in control — they always review and decide.

## 5. Principles

- Hosts review incidental invoices before they send them.
- Hosts decide whether or not to charge — the system never charges silently on their behalf.
- System-calculated values are the default; host can adjust if needed.
- Show the math. The host (and later, the guest) should be able to see how the number was derived (either show the number differences or show image differences).

## 6. MVP Scope

**In scope:**

- Mileage incidental only. Non-mileage incidental types (refueling, on-trip recharging, post-trip recharging, tolls, tickets) remain fully self-reported in this phase and appear alongside mileage on the existing multi-incidental review screen.
- Backend pre-calculates excess mileage from mileage collection data and the trip's mileage limit.
- The mileage rate is a fixed $2 per extra mile, applied uniformly across all trips. Hosts cannot edit the rate — they only review and optionally adjust the excess mileage value.
- If excess is detected, the host sees a pre-filled excess mileage value and pre-calculated charge in the incidental flow.
- Host can review, edit, or skip charging.
- Before the invoice is sent, the host completes a pre-send attestation confirming the charges are accurate. The submission is dispatched only after explicit confirmation.
- If the host submits and the total is under $100 → auto-charge guest (unchanged).
- If the host submits and the total is $100 or more → route to claims (unchanged).

**Out of scope (future phases):**

- Pre-calculation for non-mileage incidental types (refueling, recharging, tolls, tickets).
- Showing guests the same before/after mileage breakdown in their receipt.

## 7. User Flow

1. Trip ends. Backend reads mileage collection data and compares actual miles driven against the trip's mileage limit (e.g., 1,000-mile cap).
2. Backend emits one of three states for the mileage incidental:
   - **No excess** — actual ≤ limit. No mileage incidental surfaced. End.
   - **Ready for review** — actual > limit AND check-in/check-out odometer photo evidence is verifiable. The host sees a pre-filled mileage incidental with the excess miles and calculated charge, and the verifying photos are auto-attached.
   - **Unavailable** — actual > limit BUT odometer photo evidence is missing or unverifiable. The host sees an "Unavailable" badge with copy explaining the system cannot verify, and falls back to entering the mileage manually.
3. Mileage is one row on the existing multi-incidental review screen, alongside other incidental types. Each row carries its own state badge.
4. Host reviews the pre-filled value. They can: (a) accept and save, (b) edit the value before saving, or (c) skip charging (exit without saving).
5. When the host has finished adding charges and taps Send on the Review Invoice screen, a pre-send attestation overlay appears. The host must explicitly confirm that the charges are accurate before the invoice is dispatched.
6. On submit: total < $100 → auto-charge guest. Total ≥ $100 → route to claims.

> Auto-flagging hosts whose manual edits diverge significantly from system-calculated values?

## 8. Design Questions

Open design problems we need to answer before/during MVP build:

- **Timing** — when in the trip-end flow do we surface the pre-filled mileage incidental?
- **What to show the host** — at minimum: mileage limit, actual miles driven, excess miles, calculated charge.
- **Where to show it** — trip details page is the leading candidate.
- **Before/after comparison** — do we show "limit vs. actual" side-by-side, or just the excess number?
- **Confidence in the number** — how do we make the host trust the system-calculated value? (source label, link to mileage data, "how we calculated this" tooltip?)
- **Edit affordance** — how editable is the pre-filled value, and do edits trigger any flag for review?
- **Individual handling** — do we surface each incidental type one at a time, or bundle them in one review screen? (Note from Aini: "Do I do it individually?" — to decide.)
