# Phase 1 validation against the live systems

Validated on August 3, 2026 against the live Request Hub, live Launch Hub,
current Request Hub repository, and current Monday board schemas.

## Result

The contract is compatible with the intended operating model, but neither app
currently implements it in full. No existing Monday field was redefined or
changed during Phase 1.

## Current differences to resolve in Phase 2

| Contract area | Current state | Phase 2 requirement |
|---|---|---|
| Request identity | Monday item IDs exist, but there is no cross-board Request ID or Family ID | Add immutable Request ID, Family ID, and Parent Request ID fields |
| KPI family counting | Generated Procurement children appear as separate rows and increase request pressure | Count one family root and show generated children beneath it |
| Teams | Request Hub offers nine teams; live boards also contain Housekeeping | Add Housekeeping to every shared Team dropdown without removing active values |
| Outlet | The Launch Hub has nine canonical outlets | Use the exact nine-value list everywhere |
| Procurement outlet | Requested only when Team is F&B; live form offers a partial list plus `Misc.` | Ask whenever applicable, use the canonical list, and triage `Misc.` |
| Creative outlet | No structured outlet column is available to the Launch Hub request feed | Add and populate canonical Outlet |
| Print outlet | Meal-period values are stored as outlet values | Store canonical Outlet separately from meal period or print variation |
| Workstream | Request forms collect Team but not Launch Workstream | Add Workstream during launch triage |
| Owner | Several intake boards create work without an accountable owner | Assign during triage; keep requester and owner distinct |
| Priority | Missing on most categories and incomplete on Creative | Add canonical Launch Priority during launch triage |
| Date semantics | Due, needed-by, event, and live dates are treated as one general deadline | Store requested completion, live/on-property, work-back, and event dates distinctly |
| Status | Request Hub and Launch Hub use different keyword bucketing | Replace both with the contract's explicit per-board mapping |
| Permissions | Request Hub Admin/Requester and Launch Edit/View/None do not define the same visibility | Implement the four independent permission dimensions in the contract |
| Schema version | Integration writes carry no contract version | Add `schemaVersion: 1.0.0` to integration writes and stored integration metadata |
| Partial failure | Linked-child creation can fail after the root succeeds | Store sync state/error and retry idempotently |

## Live completeness baseline

The baseline is recorded so Phase 2 can prove improvement rather than merely
change form labels.

### Launch Hub request queue

- 31 open
- 15 overdue
- 5 due within seven days
- 0 blocked
- 4 awaiting review

### Procurement board

15 total records at validation time:

- 6 with canonical/recognizable outlet data
- 1 with an accountable Procurement Owner
- 1 with Need on Property
- 1 with Lead Time
- 0 with Order By
- 0 with Expected Delivery

### Creative board

15 total records at validation time:

- no structured canonical Outlet field
- 14 with Ideal Due Date
- 14 with Team
- 12 with Designer/owner
- 7 with Priority

### Other observed categories

- Uniform records have dates and teams but lack shared outlet, launch priority,
  and accountable-owner fields.
- The two currently open BEO records have structured event dates and teams but
  no accountable owner.
- Print records carry useful outlet and assignment information, but Julene meal
  periods are encoded inside Outlet and require normalization.
- Business Card state is represented by group rather than a status column; the
  contract explicitly supports that mapping.

## Contract checks performed

- JSON parses successfully.
- Every raw-status mapping resolves to one allowed normalized status.
- Team, outlet, workstream, priority, impact, sync, and normalized-status values
  are unique controlled lists.
- Current board IDs in the contract match the live Monday schemas.
- The Launch Hub pilot's Type, Workstream, Outlet, Priority, Work Status, date,
  dependency, and hierarchy concepts are represented.
- Operational-only requests remain out of the milestone timeline by rule.

