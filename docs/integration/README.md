# Request-to-Launch Integration Contract v1

This is the Phase 1 contract for making Request Hub and Launch Hub operate as
one system while Monday remains the source of truth.

## Operating model

- **Request Hub captures demand.**
- **Monday manages execution.**
- **Launch Hub shows launch impact.**
- A request is never promoted to a milestone automatically.
- A launch-related request is triaged, linked to an existing milestone, and
  represented by a task beneath that milestone.

The machine-readable source is `request-launch-contract.v1.json`. Application
code, Monday columns, automations, migrations, and tests should reference that
contract rather than define competing labels or status mappings.

## Canonical record

Every request item must receive two IDs:

- `requestId` identifies one Monday item.
- `requestFamilyId` groups the originating request and every generated
  Creative, Procurement, Print, Social, or milestone-task child.

Generated children also receive `parentRequestId`. Request-volume KPIs count
one family root per `requestFamilyId`; they do not count generated children as
new incoming demand.

## Shared fields

| Field | Meaning | Creation requirement |
|---|---|---|
| Request ID | Immutable ID for one request item | Required |
| Request Family ID | Immutable ID shared by related records | Required |
| Source category, board and item | Origin of the record | Required |
| Requester | Person who asked for the work | Required |
| Team | Requesting operational team | Required |
| Outlet | Guest-facing brand/location | Required when applicable; required before launch promotion |
| Workstream | Launch-plan discipline | Required before launch promotion |
| Owner | Person accountable for delivery | Required before launch promotion |
| Launch priority | Launch-specific urgency | Required before launch promotion |
| Launch impact | Unreviewed, operational only, or launch related | Required |
| Requested completion | When the executing team should finish | Required |
| Live/on-property date | When the result must be usable | Required before launch promotion |
| Work-back date | Latest safe action date | Calculated when lead time exists |
| Raw and normalized status | Board stage plus cross-app state | Required |
| Sync state | Pending, synced, partial, or error | Required |

## Date rules

The apps must stop treating every date as interchangeable.

- **Requested completion date:** when the requester wants the work finished.
- **Live/on-property date:** when the deliverable must be installed, live,
  delivered, or ready for guests and operators.
- **Work-back date:** live/on-property date minus lead time.
- **Event date:** when an event happens; it is not automatically the production
  deadline.

If two dates genuinely match, both fields are still stored explicitly. The
integration never silently copies one date into another.

## Triage rules

New requests start as `unreviewed` unless the system has an explicit rule that
marks them operational only. An editor chooses:

1. `operational_only` — stays in the Requests queue and never appears on the
   milestone timeline.
2. `launch_related` — requires outlet, workstream, owner, launch priority,
   live/on-property date, and an existing milestone. The system then links or
   creates a task beneath that milestone.

Procurement is considered risk-ready only when it has outlet, owner,
live/on-property date, lead time, and work-back date.

## Canonical taxonomies

### Teams

Sales; Front Office; Rooms; F&B; Pool & Beach; Engineering; Housekeeping;
Marketing; Ownership; Brand.

Housekeeping is included because it already exists on live request boards and
active records. Removing it from the shared list would make those requests
unclassifiable.

### Outlets

Campaigns; The Sunny; Julene; Citrus Shack; Lovebirds; Sandbar; Newport Room;
Pool / Beach; Rooms / E-commerce.

`Julene (breakfast)` and `Julene (bar)` normalize to `Julene`; meal period is a
separate Print detail. `Misc.` is not silently mapped and must be triaged.

### Workstreams

Partnerships; Programming & Activations; Content Creation / Organic Social;
PR; Paid Social / Media; Digital; Influencers; Campaign; Brand; Misc
Procurement.

### Normalized status

`new`, `planned`, `in_progress`, `waiting`, `blocked`, `complete`, and
`cancelled`.

Each board keeps its raw workflow label. The contract maps that label to one
normalized state so Request Hub and Launch Hub calculate the same KPIs.

## Permissions

Permissions are separate capabilities, not a single overloaded role:

- `requestVisibility`: `own` or `all`
- `launchAccess`: `none`, `view`, or `edit`
- `canTriageRequests`
- `canManageIntegration`

Launch View does not automatically reveal all request details. Triage requires
all-request visibility, Launch Edit, and the explicit triage capability.

## Phase 2 implementation gates

Phase 2 should not be considered complete until:

- both apps carry `schemaVersion: 1.0.0` on integration writes;
- new requests receive Request and Family IDs;
- the exact canonical dropdown values are available on every relevant board;
- raw and normalized statuses are both preserved;
- date fields follow the semantics above;
- launch-related records cannot be linked without the required triage fields;
- generated children are idempotent and excluded from top-level request KPIs;
- server-side validation rejects unknown canonical values.

