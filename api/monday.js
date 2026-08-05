// api/monday.js
// Single serverless token-proxy for the Request Hub.
// The Monday API token lives ONLY here (server-side env var MONDAY_API_TOKEN)
// and is never exposed to the browser. The front end calls this function;
// this function calls Monday.
//
// Supported actions (POST JSON { action, ... } or GET ?action=...):
//   - create-routed-request  { category, fields }
//   - dashboard-counts
//   - recent-submissions     { limit? }
//   - list-board-items       { category, search?, status?, cursor?, limit? }

import crypto from 'node:crypto';
import CONTRACT from '../lib/integration-contract.cjs';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_VERSION = '2024-10';
const ACCOUNT_SLUG = 'hbcapital'; // used to build item deep-links
const SCHEMA_VERSION = CONTRACT.schemaVersion;
const SHARED_AUTH_SESSION_URL = CONTRACT.urls.launch + '/api/auth/session';

const CANONICAL = {
  teams: ['Sales', 'Front Office', 'Rooms', 'F&B', 'Pool & Beach', 'Engineering', 'Housekeeping', 'Marketing', 'Ownership', 'Brand', 'Guest Services'],
  ...CONTRACT.canonical,
  launchImpacts: ['unreviewed', 'operational_only', 'launch_related'],
};

// Shared Phase 2 integration columns. Operational fields stay on their native
// board; these columns give Request Hub and Launch Hub a stable cross-board
// identity and one place to read launch-triage and sync state.
const INTEGRATION_COLUMNS = {
  procurement: { requestId: 'text_mm5wntm5', familyId: 'text_mm5w38ba', parentId: 'text_mm5wtk63', metadata: 'long_text_mm5wq9ad', sync: 'color_mm5w7jyt', impact: 'color_mm5w26kz', workstream: 'dropdown_mm5w387t', priority: 'dropdown_mm5wy493', outlet: 'dropdown_mm5rm01q', liveDate: 'date_mm5rp6zz' },
  uniform: { requestId: 'text_mm5wbqvp', familyId: 'text_mm5wx47v', parentId: 'text_mm5wc30d', metadata: 'long_text_mm5wc32c', sync: 'color_mm5wpba9', impact: 'color_mm5wc10g', workstream: 'dropdown_mm5w73fh', priority: 'dropdown_mm5warg5', outlet: 'dropdown_mm5w45ch', liveDate: 'date_mm5wbgg7' },
  creative: { requestId: 'text_mm5wqsp4', familyId: 'text_mm5wfmqh', parentId: 'text_mm5wmdz5', metadata: 'long_text_mm5wp47w', sync: 'color_mm5w49ps', impact: 'color_mm5wbn6p', workstream: 'dropdown_mm5w7tfp', priority: 'dropdown_mm5wepat', outlet: 'dropdown_mm5ww1g9', liveDate: 'date_mm5w7dnp' },
  print: { requestId: 'text_mm5wt9p', familyId: 'text_mm5w7tar', parentId: 'text_mm5wx3fr', metadata: 'long_text_mm5w4dp2', sync: 'color_mm5w8yyk', impact: 'color_mm5whzzn', workstream: 'dropdown_mm5wj7fx', priority: 'dropdown_mm5wa0zf', outlet: 'dropdown_mm5w922e', liveDate: 'date_mm5w30md' },
  beo: { requestId: 'text_mm5wfkf9', familyId: 'text_mm5wdmv3', parentId: 'text_mm5w9y9t', metadata: 'long_text_mm5wzmnn', sync: 'color_mm5wpwz8', impact: 'color_mm5wsh2r', workstream: 'dropdown_mm5wrh1k', priority: 'dropdown_mm5wdebr', outlet: 'dropdown_mm5wky56', requestedDate: 'date_mm5w4zkh', liveDate: 'date_mm58gm0p' },
  general: { requestId: 'text_mm5wn6sp', familyId: 'text_mm5wsfss', parentId: 'text_mm5wb7q0', metadata: 'long_text_mm5we3k5', sync: 'color_mm5wdpyy', impact: 'color_mm5wyv4t', workstream: 'dropdown_mm5wp336', priority: 'dropdown_mm5w4h88', outlet: 'dropdown_mm5wghtf', liveDate: 'date_mm5w8rdq' },
  business_card: { requestId: 'text_mm5w38ws', familyId: 'text_mm5wm72t', parentId: 'text_mm5w2797', metadata: 'long_text_mm5wtpet', sync: 'color_mm5wwpwt', impact: 'color_mm5wdwwa', workstream: 'dropdown_mm5wbd8f', priority: 'dropdown_mm5wspg8', outlet: 'dropdown_mm5wktj5', liveDate: 'date_mm5wghs9', team: 'dropdown_mm5wjexh', requestedDate: 'date_mm5wv528' },
  social: { requestId: 'text_mm5w82sv', familyId: 'text_mm5wqjed', parentId: 'text_mm5wza5g', metadata: 'long_text_mm5w1sxt', sync: 'color_mm5wryye' },
};
Object.assign(INTEGRATION_COLUMNS, CONTRACT.integrationColumns);

// ---------------------------------------------------------------------------
// Board routing + column map. This is the authoritative config for writes.
// category -> board id, group (optional), default status, and per-field column
// definitions. `kind` tells the proxy how to format the Monday column value.
// ---------------------------------------------------------------------------
const BOARDS = {
  procurement: {
    label: 'Procurement',
    boardId: 18415967514,
    group: null,
    statusColumn: 'color_mm3ym1pj',
    defaultStatus: 'New Request',
    emailColumn: 'email_mm57tjxr',      // requester-email column, used to scope requesters to their own items
    emailFieldKey: 'requesterEmail',
    dateColumn: 'date_mm3yn5hj',        // due date — powers Overdue / Due This Week
    teamColumn: 'dropdown_mm57gkn3',    // Team — powers "open by team" chart
    fileColumn: 'file_mm3ygsy5',        // supporting documents land in Monday's Attachments / Files area
    tableColumns: ['color_mm3ym1pj', 'dropdown_mm57gkn3', 'email_mm57tjxr', 'dropdown_mm5rm01q', 'numeric_mm3yee8z', 'numeric_mm5r88qe', 'dropdown_mm5yhppt', 'date_mm3yn5hj'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'department', column: 'text_mm3ytbvq', kind: 'text' },
      { key: 'itemDescription', column: 'text_mm3y2353', kind: 'text' },
      { key: 'quantity', column: 'numeric_mm3yee8z', kind: 'numbers' },
      { key: 'vendor', column: 'text_mm3yng56', kind: 'text' },
      { key: 'budget', column: 'text_mm3ypbsb', kind: 'text' },               // Legacy/backward-compatible budget field
      { key: 'workingCostEstimate', column: 'numeric_mm5r88qe', kind: 'numbers' },
      { key: 'estimateBasis', column: 'dropdown_mm5yhppt', kind: 'dropdown' },
      { key: 'dueDate', column: 'date_mm3yn5hj', kind: 'date' },
      { key: 'requesterEmail', column: 'email_mm57tjxr', kind: 'email' },
      { key: 'ccEmail', column: 'email_mm578ffm', kind: 'email' },   // "Also Notify" — optional extra recipient
      { key: 'team', column: 'dropdown_mm57gkn3', kind: 'dropdown' },
      { key: 'outlet', column: 'dropdown_mm5rm01q', kind: 'dropdown' },
      { key: 'procurementOwnerId', column: 'multiple_person_mm5rbst0', kind: 'people' },
      { key: 'liveOrOnPropertyDate', column: 'date_mm5rp6zz', kind: 'date' },
      { key: 'notes', column: 'long_text_mm3y661f', kind: 'long_text' },
    ],
  },
  uniform: {
    label: 'Uniform',
    boardId: 18415985409,
    group: null,
    statusColumn: 'color_mm3yma9j',
    defaultStatus: 'New Request',
    emailColumn: 'email_mm57fky2',
    emailFieldKey: 'requesterEmail',
    dateColumn: 'date_mm3y77nq',
    teamColumn: 'dropdown_mm57xa91',
    tableColumns: ['color_mm3yma9j', 'dropdown_mm3y16t7', 'dropdown_mm57xa91', 'email_mm57fky2', 'numeric_mm3ygc6y', 'date_mm3y77nq'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'uniformType', column: 'dropdown_mm3y16t7', kind: 'dropdown' },
      { key: 'departmentRole', column: 'text_mm3yghj8', kind: 'text' },
      { key: 'requirements', column: 'long_text_mm3yx8ap', kind: 'long_text' },
      { key: 'sizeRequirements', column: 'long_text_mm3yghwr', kind: 'long_text' },
      { key: 'quantity', column: 'numeric_mm3ygc6y', kind: 'numbers' },
      { key: 'notes', column: 'long_text_mm3y5tph', kind: 'long_text' },
      { key: 'dueDate', column: 'date_mm3y77nq', kind: 'date' },
      { key: 'requesterEmail', column: 'email_mm57fky2', kind: 'email' },
      { key: 'ccEmail', column: 'email_mm572kjx', kind: 'email' },   // "Also Notify" — optional extra recipient
      { key: 'team', column: 'dropdown_mm57xa91', kind: 'dropdown' },
      { key: 'outlet', column: 'dropdown_mm5w45ch', kind: 'dropdown' },
      { key: 'liveOrOnPropertyDate', column: 'date_mm5wbgg7', kind: 'date' },
    ],
  },
  creative: {
    label: 'Creative',
    boardId: 18421786819, // "creative request new"
    group: null,
    statusColumn: 'color_mm57d4mj',
    defaultStatus: 'New',
    emailColumn: 'email_mm57jmf2',
    emailFieldKey: 'email',
    dateColumn: 'date_mm57j8b',
    teamColumn: 'dropdown_mm575bmp',
    fileColumn: 'file_mm57s5z7', // uploaded reference files land here
    tableColumns: ['color_mm57d4mj', 'dropdown_mm57r0h9', 'dropdown_mm575bmp', 'email_mm57jmf2', 'date_mm57j8b'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'contentType', column: 'dropdown_mm57r0h9', kind: 'dropdown' },
      { key: 'departmentOutlet', column: 'text_mm57mzz2', kind: 'text' },
      { key: 'email', column: 'email_mm57jmf2', kind: 'email' },
      { key: 'ccEmail', column: 'email_mm57x2pd', kind: 'email' },   // "Also Notify" — optional extra recipient
      { key: 'team', column: 'dropdown_mm575bmp', kind: 'dropdown' },
      { key: 'outlet', column: 'dropdown_mm5ww1g9', kind: 'dropdown' },
      { key: 'liveOrOnPropertyDate', column: 'date_mm5w7dnp', kind: 'date' },
      { key: 'idealDueDate', column: 'date_mm57j8b', kind: 'date' },
      { key: 'projectDescription', column: 'long_text_mm57wa18', kind: 'long_text' },
      { key: 'referenceLinks', column: 'long_text_mm57mky2', kind: 'long_text' },
      { key: 'intendedUsage', column: 'dropdown_mm5ww6cx', kind: 'dropdown' },
      { key: 'photographerVideographer', column: 'text_mm5wnab3', kind: 'text' },
      { key: 'estimatedBudget', column: 'numeric_mm5wrdh9', kind: 'numbers' },
    ],
  },
  print: {
    label: 'Print',
    boardId: 18421786829, // "Print Requests"
    group: null,
    statusColumn: 'color_mm57d28j',
    defaultStatus: 'New',
    emailColumn: 'email_mm57r2z6',
    emailFieldKey: 'requesterEmail',
    dateColumn: 'date_mm57f4h4',
    teamColumn: 'dropdown_mm57k4ha',
    tableColumns: ['color_mm57d28j', 'color_mm57egma', 'dropdown_mm57k4ha', 'email_mm57r2z6', 'dropdown_mm57yjtk', 'numeric_mm57rqaq', 'date_mm57f4h4'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'printType', column: 'color_mm57egma', kind: 'status' },         // Menus / Other
      { key: 'outlets', column: 'dropdown_mm57yjtk', kind: 'dropdown' },      // multi-select
      { key: 'details', column: 'long_text_mm57nbb6', kind: 'long_text' },    // used when printType = Other
      { key: 'quantity', column: 'numeric_mm57rqaq', kind: 'numbers' },
      { key: 'requesterName', column: 'text_mm57zdjb', kind: 'text' },
      { key: 'requesterEmail', column: 'email_mm57r2z6', kind: 'email' },
      { key: 'ccEmail', column: 'email_mm579cnx', kind: 'email' },   // "Also Notify" — optional extra recipient
      { key: 'team', column: 'dropdown_mm57k4ha', kind: 'dropdown' },
      { key: 'outlet', column: 'dropdown_mm5w922e', kind: 'dropdown' },
      { key: 'liveOrOnPropertyDate', column: 'date_mm5w30md', kind: 'date' },
      { key: 'neededBy', column: 'date_mm57f4h4', kind: 'date' },
    ],
  },
  beo: {
    label: 'Banquet Event Order',
    boardId: 18395449895, // "Banquet Event Order (BEO) Request Form"
    group: 'topics',      // "Incoming responses" — same group the native form feeds
    statusColumn: 'color_mm09fjad',
    defaultStatus: null,  // board has only Working on it / Done / Stuck — leave blank = newly submitted
    emailColumn: 'email_mm58rj16',    // Requester Email (added for the Hub)
    emailFieldKey: 'requesterEmail',
    dateColumn: 'date_mm58gm0p',      // Event Date (added for the Hub) — powers Overdue / Due This Week
    teamColumn: 'dropdown_mm58q4be',  // Team (added for the Hub)
    tableColumns: ['color_mm09fjad', 'dropdown_mm58q4be', 'email_mm58rj16', 'date_mm58gm0p', 'multi_selectoxjp1hu4', 'short_textimp5o09l', 'short_textgjvu15x0'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'team', column: 'dropdown_mm58q4be', kind: 'dropdown' },
      { key: 'requesterEmail', column: 'email_mm58rj16', kind: 'email' },
      { key: 'ccEmail', column: 'email_mm58yhy4', kind: 'email' },   // "Also Notify" — optional extra recipient
      { key: 'contact', column: 'short_textldvm5txi', kind: 'text' },
      { key: 'eventName', column: 'short_textaromenrh', kind: 'text' },
      { key: 'eventDate', column: 'date_mm58gm0p', kind: 'date' },
      { key: 'requestedCompletionDate', column: 'date_mm5w4zkh', kind: 'date' },
      { key: 'outlet', column: 'dropdown_mm5wky56', kind: 'dropdown' },
      { key: 'location', column: 'short_textgjvu15x0', kind: 'text' },
      { key: 'guestCount', column: 'short_textimp5o09l', kind: 'text' },      // Guest Count is a TEXT column on this board
      { key: 'startTime', column: 'short_textz4mudep1', kind: 'text' },
      { key: 'endTime', column: 'short_text7k59v4ze', kind: 'text' },
      { key: 'typeOfEvent', column: 'multi_selectoxjp1hu4', kind: 'dropdown' },
      { key: 'serveTimes', column: 'short_text3t7qk7qs', kind: 'text' },
      { key: 'setUpStyle', column: 'short_textphthav0c', kind: 'text' },
      { key: 'menuItems', column: 'long_text98h9fovo', kind: 'long_text' },
      { key: 'beverages', column: 'long_textrefuc008', kind: 'long_text' },
      { key: 'avEquipment', column: 'long_text8anc161t', kind: 'long_text' },
      { key: 'miscServices', column: 'long_text0d1ov59a', kind: 'long_text' },
    ],
  },
  general: {
    label: 'General Request',
    boardId: 18416054434, // "Other/General Requests"
    group: 'group_mm3z5m3y', // "New Requests"
    statusColumn: 'color_mm3ztet1',
    defaultStatus: 'New Request',
    emailColumn: 'email_mm58xcf0',    // Requester Email (added for the Hub)
    emailFieldKey: 'requesterEmail',
    dateColumn: 'date_mm3z4zk3',       // existing Due Date
    teamColumn: 'dropdown_mm58xgxs',  // Team (added for the Hub)
    tableColumns: ['color_mm3ztet1', 'dropdown_mm58xgxs', 'email_mm58xcf0', 'date_mm3z4zk3'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'team', column: 'dropdown_mm58xgxs', kind: 'dropdown' },
      { key: 'requesterEmail', column: 'email_mm58xcf0', kind: 'email' },
      { key: 'ccEmail', column: 'email_mm58f1rj', kind: 'email' },   // "Also Notify" — optional extra recipient
      { key: 'details', column: 'long_text_mm3z4q79', kind: 'long_text' },  // existing Description
      { key: 'dueDate', column: 'date_mm3z4zk3', kind: 'date' },
      { key: 'outlet', column: 'dropdown_mm5wghtf', kind: 'dropdown' },
      { key: 'liveOrOnPropertyDate', column: 'date_mm5w8rdq', kind: 'date' },
    ],
  },
};

// Print per-outlet quantity mapping. On a Menus request each chosen outlet gets
// its own quantity, written to a dedicated numeric column; the Outlet(s)
// dropdown records which outlets and the Quantity column holds the grand total.
const PRINT_OUTLET_QTY_COLUMNS = {
  'Julene (breakfast)': 'numeric_mm579jzd',
  'Julene (bar)': 'numeric_mm57sh3t',
  'Citrus Shack': 'numeric_mm571v9j',
  'Lovebirds': 'numeric_mm576e7k',
  'Sandbar': 'numeric_mm57ce7a',
};
const PRINT_OUTLET_DROPDOWN = 'dropdown_mm57yjtk';
const PRINT_TOTAL_QTY = 'numeric_mm57rqaq';

// Creative → Social handoff. When a Creative request is for social media, spin
// up a linked post on the Social & Content board (18409075892) carrying the
// target post date, so scheduling sees it on the calendar right away. The two
// items are cross-linked so you can jump from the post to the finished asset.
const SOCIAL_BOARD = {
  label: 'Social & Content',
  boardId: 18409075892,
  group: 'group_mm2fkwqn',            // "Upcoming Posts"
  statusColumn: 'color_mm2f40w0',
  defaultStatus: 'Draft',             // asset not produced yet
  postDateColumn: 'date_mm2fwsds',    // "Post Date"
  brandColumn: 'dropdown_mm2f9ncb',   // canonical outlet/brand
  linkToCreativeCol: 'link_mm58rtg',  // "Linked Creative Request" on the Social board
};
const CREATIVE_SOCIAL_LINK_COL = 'link_mm58hayh'; // "Linked Social Post" on the Creative board

// Business Card is a Creative content type that routes to its own board
// (18127686590) with a distinct field set. That board tracks state via groups,
// so it has no status column. Requester email is used only for the confirmation
// email (there's no requester column to store it on).
const BUSINESS_CARD = {
  label: 'Business Card',
  boardId: 18127686590,
  group: 'topics', // "Incoming responses"
  fields: [
    { key: 'personRequesting', column: 'short_textenbeu4l1', kind: 'text' },
    { key: 'jobTitle', column: 'short_text7j3cp6ed', kind: 'text' },
    { key: 'department', column: 'short_textoy4j5uni', kind: 'text' },
    { key: 'cardEmail', column: 'email65t3k68u', kind: 'email' },   // email printed on the card
    { key: 'directPhone', column: 'phones5y6s7um', kind: 'phone' },
    { key: 'mobilePhone', column: 'phonecb45nl4h', kind: 'phone' },
    { key: 'email', column: 'email_mm58k036', kind: 'email' },   // requester's sign-in email — powers "My Requests"
    { key: 'team', column: 'dropdown_mm5wjexh', kind: 'dropdown' },
    { key: 'outlet', column: 'dropdown_mm5wktj5', kind: 'dropdown' },
    { key: 'requestedCompletionDate', column: 'date_mm5wv528', kind: 'date' },
    { key: 'liveOrOnPropertyDate', column: 'date_mm5wghs9', kind: 'date' },
  ],
};
const BC_DONE_GROUP_ID = 'group_mm383p2j';       // "Complete" group on the Business Card board
const BC_REQUESTER_EMAIL_COL = 'email_mm58k036'; // "Requested By (Email)"

// ---------------------------------------------------------------------------
// Confirmation email (best-effort). If EMAIL_WEBHOOK_URL is set, we POST the
// message to it after a request is created. Point that env var at a Microsoft
// Power Automate "When a HTTP request is received" flow whose action sends an
// Outlook email — so no Outlook credentials ever live in this code. The
// "expected completion" date is simply the date the requester entered.
// ---------------------------------------------------------------------------
const REQUESTED_DATE_FIELD = {
  procurement: 'dueDate',
  uniform: 'dueDate',
  creative: 'idealDueDate',
  print: 'neededBy',
  beo: 'requestedCompletionDate',
  general: 'dueDate',
  businesscard: 'requestedCompletionDate',
};

const EMAIL_LABELS = {
  name: 'Request', department: 'Department', itemDescription: 'Item / what’s needed',
  quantity: 'Quantity', vendor: 'Vendor', budget: 'Budget', workingCostEstimate: 'Working cost estimate',
  estimateBasis: 'Estimate basis', dueDate: 'Due date', notes: 'Notes',
  uniformType: 'Uniform type', departmentRole: 'Department / role',
  requirements: 'Specific requirements', sizeRequirements: 'Size requirements',
  contentType: 'Content type', departmentOutlet: 'Department / outlet',
  idealDueDate: 'Ideal due date', projectDescription: 'Project description',
  printType: 'Type', details: 'Details', neededBy: 'Needed by',
  requesterName: 'Requester name', requesterEmail: 'Email', email: 'Email',
  ccEmail: 'Also notify', team: 'Team', outlet: 'Outlet / area', programTitle: 'Program / initiative',
  liveOrOnPropertyDate: 'Live / on property', requestedCompletionDate: 'Requested completion',
  requiresProcurement: 'Requires procurement', procurementNotes: 'What to procure',
  procurementEstimateBasis: 'Procurement estimate basis', procurementWorkingCostEstimate: 'Procurement working cost estimate',
  intendedUsage: 'Intended usage', photographerVideographer: 'Photographer / videographer', estimatedBudget: 'Estimated budget',
  socialPostDate: 'Date to post',
  cardholderName: 'Full name (on card)', personRequesting: 'Person requesting', jobTitle: 'Job title',
  cardEmail: 'Email (on card)', directPhone: 'Direct phone', mobilePhone: 'Mobile phone',
  details: 'Details',
  contact: 'Contact', eventName: 'Event name', eventDate: 'Event date',
  location: 'Location', guestCount: 'Guest count', startTime: 'Start time', endTime: 'End time',
  typeOfEvent: 'Type of event', serveTimes: 'Serve times', setUpStyle: 'Set-up style',
  menuItems: 'Menu items', beverages: 'Beverages', avEquipment: 'AV equipment', miscServices: 'Miscellaneous services',
};

function getRequesterEmail(fields) {
  return String(fields.requesterEmail || fields.email || '').trim();
}

function prettyDate(ymd) {
  if (!ymd) return '';
  const d = new Date(ymd + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function summarizeFields(fields) {
  const rows = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '' || k === 'name' || k === 'title' || k === 'requestId' || k === 'requestFamilyId' || k === 'programItemId' || k === 'programUrl') continue;
    if (k === 'outletQuantities' && typeof v === 'object') {
      rows.push(['Menus by outlet', Object.entries(v).map(([o, q]) => `${o}: ${q}`).join(', ')]);
      continue;
    }
    let val = Array.isArray(v) ? v.join(', ') : String(v);
    if (/date/i.test(k) || k === 'neededBy') val = prettyDate(String(v));
    rows.push([EMAIL_LABELS[k] || k, val]);
  }
  return rows;
}

function buildEmailSummary(category, cfg, fields, item) {
  const expected = prettyDate(String(fields[REQUESTED_DATE_FIELD[category]] || ''));
  const rows = summarizeFields(fields);
  const subject = `We received your ${cfg.label} request: ${item.name}`;
  const requestHubUrl = CONTRACT.urls.requests + '/app?view=myrequests';
  const launchHubUrl = CONTRACT.urls.launch + '/app?view=requests&q=' + encodeURIComponent(item.name || '');

  const rowsHtml = rows.map(([l, v]) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#6d7a77;font-size:13px;vertical-align:top;white-space:nowrap">${escapeHtml(l)}</td><td style="padding:6px 0;color:#092e36;font-size:14px">${escapeHtml(v)}</td></tr>`
  ).join('');

  const expectedBlock = expected
    ? `<p style="margin:18px 0 0;font-size:14px;color:#092e36"><strong>Expected completion:</strong> ${escapeHtml(expected)}</p>`
    : `<p style="margin:18px 0 0;font-size:14px;color:#6d7a77">No target date was provided on the request.</p>`;

  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#092e36">
    <h2 style="color:#f2a81d;margin:0 0 4px">Request Hub</h2>
    <p style="font-size:14px;line-height:1.5">Thanks — we received your <strong>${escapeHtml(cfg.label)}</strong> request. Here's what came through:</p>
    <p style="font-size:15px;font-weight:700;margin:16px 0 6px">${escapeHtml(item.name)}</p>
    <table style="border-collapse:collapse">${rowsHtml}</table>
    ${expectedBlock}
    <p style="margin:22px 0 0"><a href="${requestHubUrl}" style="display:inline-block;background:#092e36;color:#fbf8f0;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:700">Track this request</a></p>
    <p style="margin:12px 0 0;font-size:12px;color:#6d7a77">Launch-related work will also appear in <a href="${launchHubUrl}" style="color:#006eb6">Launch Hub</a> after triage.</p>
    <p style="margin:22px 0 0;font-size:12px;color:#6d7a77">You'll be updated as your request progresses.</p>
  </div>`;

  const text = `Thanks — we received your ${cfg.label} request.\n\n${item.name}\n`
    + rows.map(([l, v]) => `- ${l}: ${v}`).join('\n')
    + (expected ? `\n\nExpected completion: ${expected}` : '\n\nNo target date was provided.')
    + `\n\nTrack your request: ${requestHubUrl}\nLaunch Hub: ${launchHubUrl}`;

  return { subject, html, text, expected, requestHubUrl, launchHubUrl };
}

async function maybeSendConfirmation(category, cfg, fields, item) {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (!url) return { sent: false, skipped: true };
  const to = getRequesterEmail(fields);
  if (!to) return { sent: false, error: 'no requester email on submission' };
  const cc = String(fields.ccEmail || '').trim();
  try {
    const summary = buildEmailSummary(category, cfg, fields, item);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        cc,                       // optional "Also notify" recipient; blank string when none
        subject: summary.subject,
        html: summary.html,
        text: summary.text,
        category: cfg.label,
        requestName: item.name,
        expectedCompletion: summary.expected,
        requestHubUrl: summary.requestHubUrl,
        launchHubUrl: summary.launchHubUrl,
      }),
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text() || '').slice(0, 400); } catch (e) { /* ignore */ }
      return { sent: false, error: `email webhook returned ${resp.status}${detail ? ': ' + detail : ''}` };
    }
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

// Upload reference files to an item's file column via Monday's file endpoint.
// `files` is an array of { name, type, data } where data is base64. Best-effort.
async function uploadFilesToItem(itemId, fileColumn, files) {
  const token = process.env.MONDAY_API_TOKEN;
  const results = [];
  for (const f of files) {
    if (!f || !f.data) continue;
    try {
      const buffer = Buffer.from(f.data, 'base64');
      const form = new FormData();
      form.append('query', `mutation ($file: File!) { add_file_to_column (item_id: ${itemId}, column_id: "${fileColumn}", file: $file) { id } }`);
      form.append('map', JSON.stringify({ image: 'variables.file' }));
      form.append('image', new Blob([buffer], { type: f.type || 'application/octet-stream' }), f.name || 'upload');
      const resp = await fetch(`${MONDAY_API_URL}/file`, {
        method: 'POST',
        headers: { Authorization: token, 'API-Version': MONDAY_API_VERSION },
        body: form,
      });
      const json = await resp.json();
      results.push({ name: f.name, ok: !json.errors, error: json.errors ? json.errors.map((e) => e.message).join('; ') : null });
    } catch (e) {
      results.push({ name: f && f.name, ok: false, error: e.message });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// KPI bucketing. The boards use different status vocabularies, so we normalize
// each status label into one of four dashboard buckets by keyword. Terminal-
// negative states (cancelled / rejected) are excluded from all cards.
// Adjust the keyword lists here to retune the KPI cards.
// ---------------------------------------------------------------------------
const BUCKETS = ['active', 'review', 'progress', 'completed'];

const STATUS_NORMALIZATION = {
  procurement: { 'New Request': 'new', Sourcing: 'in_progress', 'Working On Design': 'in_progress', 'Ready to Order': 'waiting', Ordered: 'in_progress', 'In Transit': 'in_progress', Delivered: 'complete' },
  uniform: { 'New Request': 'new', Sourcing: 'in_progress', Ordered: 'in_progress', 'In Transit': 'in_progress', Delivered: 'complete' },
  creative: { New: 'new', Assigned: 'planned', 'Working On It': 'in_progress', 'Pending Review': 'waiting', Stuck: 'blocked', Completed: 'complete' },
  print: { New: 'new', 'In Progress': 'in_progress', Printed: 'complete' },
  beo: { '': 'new', 'Working on it': 'in_progress', Stuck: 'blocked', Done: 'complete' },
  general: { 'New Request': 'new', 'In Progress': 'in_progress', 'In Review': 'waiting', 'On Hold': 'waiting', Completed: 'complete', Cancelled: 'cancelled' },
  business_card: { 'Incoming responses': 'new', Complete: 'complete' },
  social: { Draft: 'planned' },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestUuid(value) {
  const v = String(value || '').trim();
  return UUID_RE.test(v) ? v.toLowerCase() : crypto.randomUUID();
}

function childUuid(familyId, childType) {
  const hex = crypto.createHash('sha256').update(`${familyId}:${childType}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function assertCanonical(fields) {
  const checks = [
    ['team', CANONICAL.teams],
    ['outlet', CANONICAL.outlets],
    ['launchWorkstream', CANONICAL.workstreams],
    ['launchPriority', CANONICAL.priorities],
    ['launchImpact', CANONICAL.launchImpacts],
  ];
  for (const [key, allowed] of checks) {
    const value = fields[key];
    if (value !== undefined && value !== null && String(value).trim() && !allowed.includes(String(value).trim())) {
      throw badRequest(`Unknown ${key} value "${value}". Please refresh and choose one of the current options.`);
    }
  }
  if (fields.launchImpact === 'launch_related') {
    const required = ['outlet', 'launchWorkstream', 'launchPriority', 'liveOrOnPropertyDate', 'ownerMondayUserId', 'milestoneItemId'];
    const missing = required.filter((key) => !fields[key]);
    if (missing.length) throw badRequest(`Launch-related requests require triage fields before promotion: ${missing.join(', ')}.`);
  }
}

function validateProcurementEstimate(estimateBasis, workingCostEstimate) {
  const allowedBases = ['Approved Budget', 'Vendor Quote', 'Internal Estimate', 'Planning Allowance', 'Estimate Needed'];
  const basis = String(estimateBasis || '').trim();
  if (!allowedBases.includes(basis)) throw badRequest('Choose how the procurement cost was estimated.');
  const rawEstimate = workingCostEstimate;
  if (basis === 'Estimate Needed') {
    if (rawEstimate !== undefined && rawEstimate !== null && String(rawEstimate).trim() !== '') {
      throw badRequest('Choose an estimate basis that matches the amount entered, or clear the amount when an estimate is still needed.');
    }
    return;
  }
  if (rawEstimate === undefined || rawEstimate === null || String(rawEstimate).trim() === '') {
    throw badRequest('Enter a working cost estimate, or choose Estimate Needed.');
  }
  const estimate = Number(rawEstimate);
  if (!Number.isFinite(estimate) || estimate <= 0) throw badRequest('Working cost estimate must be a valid amount greater than $0.');
}

function validateCreationFields(category, fields) {
  const missing = [];
  if (!fields.team) missing.push('team');
  if (!getRequesterEmail(fields)) missing.push('requester email');
  if (!requestedDateFor(category, fields)) missing.push('requested completion date');
  const productionType = category === 'creative' && ['Photography', 'Videography'].includes(String(fields.contentType || ''));
  if (productionType && (!Array.isArray(fields.intendedUsage) || !fields.intendedUsage.length)) missing.push('intended usage');
  if (productionType && (fields.estimatedBudget === undefined || fields.estimatedBudget === null || String(fields.estimatedBudget).trim() === '')) missing.push('estimated budget');
  if (missing.length) throw badRequest(`Missing required integration field(s): ${missing.join(', ')}.`);
  if (Array.isArray(fields.intendedUsage)) {
    const allowed = ['Website', 'Organic Social', 'Paid Social / Advertising', 'Email', 'Print', 'PR / Press', 'On Property', 'Other'];
    const unknown = fields.intendedUsage.filter((value) => !allowed.includes(String(value)));
    if (unknown.length) throw badRequest(`Unknown intended usage "${unknown[0]}". Please refresh and choose a current option.`);
  }
  if (productionType) {
    const budget = Number(fields.estimatedBudget);
    if (!Number.isFinite(budget) || budget < 0) throw badRequest('Estimated budget must be a valid non-negative amount.');
  }
  if (category === 'procurement') {
    if (!fields.procurementOwnerId) missing.push('procurement owner');
    validateProcurementEstimate(fields.estimateBasis, fields.workingCostEstimate);
  }
  if (category === 'creative' && String(fields.requiresProcurement || '').toLowerCase() === 'yes') {
    if (!fields.procurementOwnerId) missing.push('procurement owner');
    validateProcurementEstimate(fields.procurementEstimateBasis, fields.procurementWorkingCostEstimate);
  }
  if (missing.length) throw badRequest(`Missing required integration field(s): ${missing.join(', ')}.`);
}

function statusFor(category, rawStatus) {
  const mapping = STATUS_NORMALIZATION[category] || {};
  return mapping[rawStatus] || null;
}

function requestedDateFor(category, fields) {
  const key = {
    procurement: 'dueDate', uniform: 'dueDate', creative: 'idealDueDate',
    print: 'neededBy', beo: 'requestedCompletionDate', general: 'dueDate',
    business_card: 'requestedCompletionDate', social: 'requestedCompletionDate',
  }[category];
  return key ? (fields[key] || null) : null;
}

function liveDateFor(category, fields) {
  if (category === 'beo') return fields.eventDate || null;
  if (category === 'social') return fields.socialPostDate || fields.liveOrOnPropertyDate || null;
  return fields.liveOrOnPropertyDate || null;
}

function integrationMetadata(category, cfg, fields, ctx) {
  const rawStatus = ctx.rawStatus == null ? (cfg.defaultStatus || '') : String(ctx.rawStatus);
  const normalizedStatus = statusFor(category, rawStatus);
  const syncState = normalizedStatus ? ctx.syncState : 'partial';
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId: ctx.requestId,
    requestFamilyId: ctx.familyId,
    parentRequestId: ctx.parentId || null,
    generatedChild: Boolean(ctx.parentId),
    childType: ctx.childType || null,
    sourceApp: 'request_hub',
    sourceCategory: category,
    sourceBoardId: String(cfg.boardId),
    sourceItemId: ctx.itemId ? String(ctx.itemId) : null,
    sourceUrl: ctx.itemId ? itemUrl(cfg.boardId, ctx.itemId) : null,
    title: ctx.title,
    requesterEmail: getRequesterEmail(fields) || null,
    team: fields.team || null,
    outlet: fields.outlet || null,
    workstream: fields.launchWorkstream || null,
    launchPriority: fields.launchPriority || null,
    launchImpact: fields.launchImpact || 'unreviewed',
    requestedCompletionDate: requestedDateFor(category, fields),
    liveOrOnPropertyDate: liveDateFor(category, fields),
    workBackDate: fields.workBackDate || null,
    leadTimeDays: fields.leadTimeDays === '' || fields.leadTimeDays == null ? null : Number(fields.leadTimeDays),
    eventDate: fields.eventDate || null,
    programItemId: fields.programItemId || null,
    programTitle: fields.programTitle || null,
    programUrl: fields.programUrl || null,
    rawStatus,
    normalizedStatus: normalizedStatus || 'new',
    syncState,
    syncErrorCode: ctx.syncErrorCode || (normalizedStatus ? null : 'UNKNOWN_STATUS_MAPPING'),
    createdAt: ctx.createdAt,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: syncState === 'synced' ? new Date().toISOString() : null,
  };
}

function integrationValues(category, cfg, fields, ctx) {
  const cols = INTEGRATION_COLUMNS[category];
  const meta = integrationMetadata(category, cfg, fields, ctx);
  const cv = {
    [cols.requestId]: ctx.requestId,
    [cols.familyId]: ctx.familyId,
    [cols.metadata]: { text: JSON.stringify(meta) },
    [cols.sync]: { label: meta.syncState === 'synced' ? 'Synced' : meta.syncState === 'partial' ? 'Partial' : meta.syncState === 'error' ? 'Error' : 'Pending' },
  };
  if (ctx.parentId) cv[cols.parentId] = ctx.parentId;
  if (cols.impact) cv[cols.impact] = { label: meta.launchImpact === 'operational_only' ? 'Operational Only' : meta.launchImpact === 'launch_related' ? 'Launch Related' : 'Unreviewed' };
  if (cols.workstream && fields.launchWorkstream) cv[cols.workstream] = { labels: [fields.launchWorkstream] };
  if (cols.priority && fields.launchPriority) cv[cols.priority] = { labels: [fields.launchPriority] };
  if (cols.programLink && fields.programItemId && fields.programTitle) {
    cv[cols.programLink] = { url: fields.programUrl || itemUrl(CONTRACT.launch.defaultBoardId, fields.programItemId), text: fields.programTitle };
  }
  return cv;
}

function bucketForStatus(category, label) {
  const normalized = statusFor(category, String(label || ''));
  if (normalized === 'cancelled') return null;
  if (normalized === 'complete') return 'completed';
  if (normalized === 'waiting') return 'review';
  if (normalized === 'planned' || normalized === 'in_progress') return 'progress';
  return 'active';
}

// ---------------------------------------------------------------------------
// Monday column value formatting
// ---------------------------------------------------------------------------
function buildColumnValues(cfg, fields) {
  const cv = {};
  for (const f of cfg.fields) {
    if (f.kind === 'name') continue; // name is passed separately
    const raw = fields[f.key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'string' && raw.trim() === '') continue;
    if (Array.isArray(raw) && raw.length === 0) continue;
    switch (f.kind) {
      case 'text':
        cv[f.column] = String(raw);
        break;
      case 'long_text':
        cv[f.column] = { text: String(raw) };
        break;
      case 'email':
        cv[f.column] = { email: String(raw), text: String(raw) };
        break;
      case 'date':
        cv[f.column] = { date: String(raw) }; // expects YYYY-MM-DD
        break;
      case 'numbers':
        cv[f.column] = String(raw);
        break;
      case 'phone': {
        const digits = String(raw).replace(/[^\d]/g, '');
        if (digits) cv[f.column] = { phone: digits, countryShortName: 'US' };
        break;
      }
      case 'status':
        cv[f.column] = { label: String(raw) };
        break;
      case 'dropdown':
        cv[f.column] = Array.isArray(raw)
          ? { labels: raw.map(String) }
          : { labels: [String(raw)] };
        break;
      case 'people':
        if (!/^\d+$/.test(String(raw))) throw badRequest('Choose a current Procurement Owner from the list.');
        cv[f.column] = { personsAndTeams: [{ id: Number(raw), kind: 'person' }] };
        break;
      default:
        break;
    }
  }
  // Set the default workflow status on creation — but only if the board defines
  // one. Boards without a "new" label (e.g. BEO) use defaultStatus: null so the
  // item lands with a blank status, which the dashboard treats as newly open.
  if (cfg.defaultStatus) cv[cfg.statusColumn] = { label: cfg.defaultStatus };
  return cv;
}

// ---------------------------------------------------------------------------
// Monday GraphQL helper
// ---------------------------------------------------------------------------
async function mondayQuery(query, variables) {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    const err = new Error('Server is missing the MONDAY_API_TOKEN environment variable.');
    err.statusCode = 500;
    throw err;
  }
  const resp = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': MONDAY_API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await resp.json();
  if (json.errors) {
    const err = new Error(json.errors.map((e) => e.message).join('; '));
    err.statusCode = 502;
    err.details = json.errors;
    throw err;
  }
  return json.data;
}

const PROGRAM_CACHE_MS = 60 * 1000;
const MILESTONE_ROLE_COLUMN = 'dropdown_mm5xpxcn';
let programCache = { at: 0, items: null };
let procurementOwnerCache = { at: 0, items: null };

function normalizedPerson(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function listProcurementOwners() {
  if (procurementOwnerCache.items && Date.now() - procurementOwnerCache.at < 5 * 60 * 1000) {
    return procurementOwnerCache.items;
  }
  const data = await mondayQuery(
    `query ($board: [ID!], $cols: [String!]) {
      boards(ids: $board) {
        items_page(limit: 500) { items { name column_values(ids: $cols) { id text } } }
      }
      users(limit: 500) { id name email enabled }
    }`,
    { board: [String(USERS_BOARD)], cols: [USERS_EMAIL_COL] }
  );
  const accessItems = (((data || {}).boards || [])[0] || {}).items_page;
  const allowedEmails = new Set();
  const allowedNames = new Set();
  for (const item of (accessItems && accessItems.items) || []) {
    allowedNames.add(normalizedPerson(item.name));
    const emailColumn = (item.column_values || []).find((column) => column.id === USERS_EMAIL_COL);
    const email = String((emailColumn && emailColumn.text) || '').trim().toLowerCase();
    if (email) allowedEmails.add(email);
  }
  const owners = (data.users || []).filter((user) => {
    if (user.enabled === false || /@agent\.monday\.com$/i.test(String(user.email || ''))) return false;
    return allowedEmails.has(String(user.email || '').trim().toLowerCase()) || allowedNames.has(normalizedPerson(user.name));
  }).map((user) => ({ id: String(user.id), name: String(user.name || user.email), email: String(user.email || '') }))
    .sort((left, right) => left.name.localeCompare(right.name));
  procurementOwnerCache = { at: Date.now(), items: owners };
  return owners;
}

function programDate(columns, id) {
  const column = columns[id];
  if (!column) return '';
  try {
    const value = JSON.parse(column.value || 'null');
    return String((value && (value.date || value.to || value.from)) || column.text || '').slice(0, 10);
  } catch (error) { return String(column.text || '').slice(0, 10); }
}

async function listPrograms() {
  if (programCache.items && Date.now() - programCache.at < PROGRAM_CACHE_MS) return programCache.items;
  const columns = CONTRACT.launch.columns;
  const ids = [columns.type, columns.timeline, columns.liveDate, columns.dueDate, MILESTONE_ROLE_COLUMN];
  const first = await mondayQuery(
    `query ($board: [ID!], $cols: [String!]) {
      boards(ids: $board) {
        items_page(limit: 500) {
          cursor items { id name url group { id title } column_values(ids: $cols) { id text value } }
        }
      }
    }`,
    { board: [String(CONTRACT.launch.defaultBoardId)], cols: ids }
  );
  let page = (((first || {}).boards || [])[0] || {}).items_page;
  const items = [];
  while (page) {
    items.push(...(page.items || []));
    if (!page.cursor) break;
    const next = await mondayQuery(
      `query ($cursor: String!, $cols: [String!]) {
        next_items_page(cursor: $cursor, limit: 500) {
          cursor items { id name url group { id title } column_values(ids: $cols) { id text value } }
        }
      }`,
      { cursor: page.cursor, cols: ids }
    );
    page = next.next_items_page;
  }
  const programs = items.map((item) => {
    const byId = {}; (item.column_values || []).forEach((column) => { byId[column.id] = column; });
    if (String((byId[columns.type] || {}).text || '').trim() !== 'Milestone') return null;
    let timelineStart = '', timelineEnd = '';
    try {
      const timeline = JSON.parse((byId[columns.timeline] || {}).value || 'null');
      timelineStart = String((timeline && timeline.from) || '').slice(0, 10);
      timelineEnd = String((timeline && timeline.to) || '').slice(0, 10);
    } catch (error) { /* timeline is optional */ }
    return {
      id: String(item.id), title: String(item.name || 'Untitled program').trim(), url: String(item.url || ''),
      groupId: String((item.group && item.group.id) || ''),
      groupTitle: String((item.group && item.group.title) || 'Other').trim(),
      role: String((byId[MILESTONE_ROLE_COLUMN] || {}).text || '').trim(),
      timelineStart, timelineEnd,
      liveDate: programDate(byId, columns.liveDate),
      dueDate: programDate(byId, columns.dueDate)
    };
  }).filter(Boolean).sort((left, right) =>
    left.groupTitle.localeCompare(right.groupTitle) || left.title.localeCompare(right.title));
  programCache = { at: Date.now(), items: programs };
  return programs;
}

async function applyProgramSelection(fields) {
  const id = String(fields.programItemId || '').trim();
  if (!id) {
    delete fields.programItemId; delete fields.programTitle; delete fields.programUrl;
    return null;
  }
  if (!/^\d+$/.test(id)) throw badRequest('Choose a current opening or program from the list.');
  const program = (await listPrograms()).find((item) => item.id === id);
  if (!program) throw badRequest('That opening or program is no longer available. Refresh and choose a current option.');
  fields.programItemId = program.id;
  fields.programTitle = program.title;
  fields.programUrl = program.url || itemUrl(CONTRACT.launch.defaultBoardId, program.id);
  return program;
}

async function findItemByRequestId(cfg, category, requestId) {
  const col = INTEGRATION_COLUMNS[category] && INTEGRATION_COLUMNS[category].requestId;
  if (!col || !requestId) return null;
  const query = `
    query ($b: ID!, $cols: [String!], $qp: ItemsQuery) {
      boards (ids: [$b]) {
        items_page (limit: 10, query_params: $qp) {
          items { id name column_values (ids: $cols) { id text } }
        }
      }
    }`;
  const qp = { rules: [{ column_id: col, compare_value: [requestId], operator: 'contains_text' }], operator: 'and' };
  const data = await mondayQuery(query, { b: String(cfg.boardId), cols: [col], qp });
  const items = data.boards[0] ? data.boards[0].items_page.items : [];
  return items.find((it) => (it.column_values[0] && it.column_values[0].text) === requestId) || null;
}

async function updateIntegrationState(category, cfg, fields, item, ctx) {
  const cv = integrationValues(category, cfg, fields, { ...ctx, itemId: item.id, title: item.name });
  await mondayQuery(
    `mutation ($b: ID!, $i: ID!, $cv: JSON!) {
       change_multiple_column_values (board_id: $b, item_id: $i, column_values: $cv, create_labels_if_missing: true) { id }
     }`,
    { b: String(cfg.boardId), i: String(item.id), cv: JSON.stringify(cv) }
  );
}

// ---------------------------------------------------------------------------
// Access control (email gate) + usage logging.
//
// Two env vars turn this on:
//   APPROVED_EMAILS  comma/space/newline-separated list of allowed emails
//   AUTH_SECRET      any long random string; signs the access tokens
// If either is unset the gate is OPEN (app behaves as before) so you can't lock
// yourself out mid-setup. Set BOTH to enforce the gate. Because email-only has
// no password, anyone who knows a listed address can enter — this is access
// control + usage logging, not strong authentication.
//
// Every access attempt and every request submission is logged to the
// "Request Hub — Access Log" board so you can see who's using it and how often.
// ---------------------------------------------------------------------------
const ACCESS_LOG_BOARD = 18421802590;
const ACCESS_LOG_COLS = { event: 'color_mm57edg2', category: 'text_mm57eex7', detail: 'text_mm579nym' };
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Access (Users) board — the source of truth for who can sign in and their role.
// Each row is one person: Email + Role (Admin | Requester). Admins see everything;
// requesters see only their own requests. Manage it in Monday, no redeploy needed.
const USERS_BOARD = Number(CONTRACT.users.boardId);
const USERS_COLS = CONTRACT.users.columns;
const USERS_EMAIL_COL = USERS_COLS.email;
const USERS_ROLE_COL = USERS_COLS.role;

function approvedEmails() {
  return String(process.env.APPROVED_EMAILS || '')
    .split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
function authConfigured() { return Boolean(process.env.AUTH_SECRET); }

// Resolve a sign-in email to a role: 'admin', 'requester', or null (blocked).
// The Users board is the source of truth: if a person is listed there, their
// board role wins — full stop. APPROVED_EMAILS is a true break-glass fallback,
// used ONLY when the person isn't on the board, or when Monday can't be reached
// (so an outage can't lock admins out). This ordering means you manage roles on
// the board alone and never have to touch the env var to demote someone.
function checkedColumn(column) {
  if (!column) return false;
  try {
    const value = JSON.parse(column.value || 'null');
    return Boolean(value && (value.checked === true || value.checked === 'true')) || Boolean(column.text);
  } catch (error) { return Boolean(column.text); }
}

async function getUserPermissions(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  try {
    const query = `
      query ($b: ID!, $cols: [String!], $qp: ItemsQuery) {
        boards (ids: [$b]) {
          items_page (limit: 50, query_params: $qp) {
            items { column_values (ids: $cols) { id text value } }
          }
        }
      }`;
    const qp = { rules: [{ column_id: USERS_EMAIL_COL, compare_value: [clean], operator: 'contains_text' }], operator: 'and' };
    const data = await mondayQuery(query, { b: String(USERS_BOARD), cols: Object.values(USERS_COLS), qp });
    for (const it of (data.boards[0] ? data.boards[0].items_page.items : [])) {
      const byId = {};
      for (const c of it.column_values) byId[c.id] = c;
      const text = (id) => String((byId[id] || {}).text || '').trim();
      if (text(USERS_EMAIL_COL).toLowerCase() === clean) {
        const boardRole = text(USERS_ROLE_COL).toLowerCase();
        return {
          email: clean,
          role: boardRole === 'admin' ? 'admin' : (boardRole === 'requester' ? 'requester' : null),
          requestVisibility: text(USERS_COLS.requestVisibility).toLowerCase() === 'all' ? 'all' : 'own',
          launchAccess: text(USERS_COLS.launchAccess) || 'None',
          canTriageRequests: checkedColumn(byId[USERS_COLS.canTriage]),
          canManageIntegration: checkedColumn(byId[USERS_COLS.canManageIntegration])
        };
      }
    }
    // Not on the board → break-glass list may still grant admin, else blocked.
    return approvedEmails().includes(clean) ? { email: clean, role: 'admin', requestVisibility: 'all', launchAccess: 'Edit', canTriageRequests: true, canManageIntegration: true } : null;
  } catch (e) {
    // Monday unreachable → fall back to the break-glass list so admins aren't locked out.
    return approvedEmails().includes(clean) ? { email: clean, role: 'admin', requestVisibility: 'all', launchAccess: 'Edit', canTriageRequests: true, canManageIntegration: true } : null;
  }
}

async function getUserRole(email) {
  const permissions = await getUserPermissions(email);
  return permissions && permissions.role;
}

function issueToken(email, role) {
  const emailLc = String(email).trim().toLowerCase();
  const r = role === 'admin' ? 'admin' : 'requester';
  if (!authConfigured()) return 'open';
  const payload = `${emailLc}|${r}|${Date.now() + TOKEN_TTL_MS}`;
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}
function verifyToken(token) {
  if (!authConfigured()) return { valid: true, email: null, role: 'admin' }; // gate open → full access
  if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false };
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(b64).digest('hex');
  let a, b;
  try { a = Buffer.from(sig || '', 'hex'); b = Buffer.from(expected, 'hex'); } catch { return { valid: false }; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false };
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return { valid: false }; }
  const parts = payload.split('|');
  const email = parts[0], role = parts[1], expStr = parts[2];
  if (!email || !expStr || Number(expStr) < Date.now()) return { valid: false };
  return { valid: true, email, role: role === 'admin' ? 'admin' : 'requester' };
}

function requestCookie(req, name) {
  const match = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.cookie || '');
  return match ? decodeURIComponent(match[1]) : '';
}

async function authenticateRequest(req, suppliedToken) {
  if (requestCookie(req, 'lh_shared_session')) {
    try {
      const response = await fetch(SHARED_AUTH_SESSION_URL, { headers: { cookie: req.headers.cookie || '' } });
      const session = await response.json().catch(() => null);
      if (response.ok && session && session.authenticated && session.permissions && session.permissions.role) {
        return { valid: true, email: session.email, ...session.permissions };
      }
    } catch (error) { /* legacy session remains available during transition */ }
  }
  // During the shared-auth migration the browser stores the literal value
  // "shared" in localStorage. Older users can simultaneously have a valid
  // rh_session cookie. Never let that non-token placeholder mask the valid
  // cookie or the app will bounce between / and /app indefinitely.
  let legacy = verifyToken(suppliedToken);
  if (!legacy.valid) legacy = verifyToken(requestCookie(req, 'rh_session'));
  if (!legacy.valid) return { valid: false };
  if (!legacy.email) return { ...legacy, requestVisibility: legacy.role === 'admin' ? 'all' : 'own' };
  const permissions = await getUserPermissions(legacy.email);
  return permissions && permissions.role ? { valid: true, ...permissions } : { valid: false };
}

async function logAccess(email, eventLabel, category, detail) {
  try {
    const cv = {
      [ACCESS_LOG_COLS.event]: { label: eventLabel },
      [ACCESS_LOG_COLS.category]: category || '',
      [ACCESS_LOG_COLS.detail]: detail || '',
    };
    await mondayQuery(
      `mutation ($b: ID!, $n: String!, $cv: JSON!) { create_item (board_id: $b, item_name: $n, column_values: $cv, create_labels_if_missing: false) { id } }`,
      { b: String(ACCESS_LOG_BOARD), n: (email || 'unknown').slice(0, 240), cv: JSON.stringify(cv) }
    );
  } catch (e) { /* logging is best-effort — never block the request on it */ }
}

async function verifyEmailAction({ email }) {
  const clean = String(email || '').trim();
  if (!clean || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw badRequest('Please enter a valid email address.');
  if (!authConfigured()) return { ok: true, approved: true, role: 'admin', token: 'open', email: clean.toLowerCase() };
  const role = await getUserRole(clean);
  const approved = Boolean(role);
  await logAccess(clean, approved ? 'Access approved' : 'Access denied', role || '', approved ? `Signed in (${role})` : 'Email not on access list');
  if (!approved) return { ok: true, approved: false };
  return { ok: true, approved: true, role, token: issueToken(clean, role), email: clean.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
// Business Card requests route to the Business Card board (18127686590). The
// requester's own email drives the confirmation; the cardholder's details are
// written to the board. This board has no status column (it tracks via groups).
async function createBusinessCardRequest(fields, { role, authEmail } = {}) {
  const cfg = BUSINESS_CARD;
  const f = { ...(fields || {}) };
  if (role === 'requester' && authEmail) f.email = authEmail; // confirmation goes to the requester
  assertCanonical(f);
  validateCreationFields('business_card', f);
  const name = f.cardholderName || f.name || 'Business Card Request';
  const requestId = requestUuid(f.requestId);
  const familyId = requestId;
  const createdAt = new Date().toISOString();
  const columnValues = buildColumnValues(cfg, f);
  Object.assign(columnValues, integrationValues('business_card', cfg, f, {
    requestId, familyId, parentId: null, syncState: 'pending', createdAt, title: name, rawStatus: 'Incoming responses',
  }));
  let item = await findItemByRequestId(cfg, 'business_card', requestId);
  const wasExisting = Boolean(item);
  if (!item) {
    const data = await mondayQuery(
      `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
         create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues, create_labels_if_missing: true) { id name }
       }`,
      { boardId: String(cfg.boardId), groupId: cfg.group || null, itemName: name, columnValues: JSON.stringify(columnValues) }
    );
    item = data.create_item;
  }
  await updateIntegrationState('business_card', cfg, f, item, {
    requestId, familyId, parentId: null, syncState: 'synced', createdAt, rawStatus: 'Incoming responses',
  });
  const result = {
    ok: true, category: 'creative', board: cfg.label, boardId: cfg.boardId,
    itemId: item.id, itemName: item.name, url: itemUrl(cfg.boardId, item.id),
    requestId, requestFamilyId: familyId, idempotentReplay: wasExisting,
    program: f.programItemId ? { id: f.programItemId, title: f.programTitle, url: f.programUrl } : null,
    requestHubUrl: CONTRACT.urls.requests + '/app?view=myrequests',
    launchHubUrl: CONTRACT.urls.launch + '/app?view=requests&q=' + encodeURIComponent(item.name || ''),
  };
  if (!wasExisting) {
    const emailOutcome = await maybeSendConfirmation('businesscard', cfg, f, item);
    result.emailSent = Boolean(emailOutcome.sent);
    if (emailOutcome.error) result.emailError = emailOutcome.error;
    await logAccess(getRequesterEmail(f) || 'unknown', 'Request submitted', cfg.label, item.name);
  }
  return result;
}

async function createRoutedRequest({ category, fields, role, authEmail }) {
  const f0 = { ...(fields || {}) };
  await applyProgramSelection(f0);
  // Business Card is a Creative content type that routes to its own board.
  if (category === 'creative' && String(f0.contentType || '').toLowerCase() === 'business card') {
    return createBusinessCardRequest(f0, { role, authEmail });
  }
  const cfg = BOARDS[category];
  if (!cfg) throw badRequest(`Unknown category "${category}".`);
  const f = f0;
  const createsProcurement = category === 'procurement'
    || (category === 'creative' && String(f.requiresProcurement || '').toLowerCase() === 'yes');
  if (createsProcurement) {
    const ownerId = String(f.procurementOwnerId || '').trim();
    const owners = await listProcurementOwners();
    if (!owners.some((owner) => owner.id === ownerId)) {
      throw badRequest('Choose a current Procurement Owner from the list.');
    }
    // Intake owns the required need-on-property date. Sourcing owns the later
    // order-by and expected-delivery dates.
    if (category === 'procurement' && !f.liveOrOnPropertyDate) f.liveOrOnPropertyDate = f.dueDate;
  }
  // Requesters can only file requests as themselves: force the requester-email
  // column to their signed-in identity so it always shows under "My Requests".
  if (role === 'requester' && authEmail && cfg.emailFieldKey) {
    f[cfg.emailFieldKey] = authEmail;
  }
  assertCanonical(f);
  validateCreationFields(category, f);
  const name = (f.name || f.title) || `${cfg.label} Request`;
  const requestId = requestUuid(f.requestId);
  const familyId = requestId;
  const createdAt = new Date().toISOString();
  const columnValues = buildColumnValues(cfg, f);
  Object.assign(columnValues, integrationValues(category, cfg, f, {
    requestId, familyId, parentId: null, syncState: 'pending', createdAt, title: name,
  }));

  // Print · Menus: expand per-outlet quantities into their columns, set the
  // Outlet(s) dropdown, and total the Quantity column.
  if (category === 'print' && f.outletQuantities && typeof f.outletQuantities === 'object') {
    const chosen = [];
    let total = 0;
    for (const [outlet, qty] of Object.entries(f.outletQuantities)) {
      const col = PRINT_OUTLET_QTY_COLUMNS[outlet];
      const n = Number(qty);
      if (!col || qty === '' || qty === null || qty === undefined || Number.isNaN(n)) continue;
      columnValues[col] = String(n);
      total += n;
      chosen.push(outlet);
    }
    if (chosen.length) {
      columnValues[PRINT_OUTLET_DROPDOWN] = { labels: chosen };
      columnValues[PRINT_TOTAL_QTY] = String(total);
    }
  }

  const query = `
    mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
      create_item (
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) { id name }
    }`;

  let item = await findItemByRequestId(cfg, category, requestId);
  const wasExisting = Boolean(item);
  if (!item) {
    const data = await mondayQuery(query, {
      boardId: String(cfg.boardId),
      groupId: cfg.group || null,
      itemName: name,
      columnValues: JSON.stringify(columnValues),
    });
    item = data.create_item;
  }
  const result = {
    ok: true,
    category,
    board: cfg.label,
    boardId: cfg.boardId,
    itemId: item.id,
    itemName: item.name,
    url: itemUrl(cfg.boardId, item.id),
    requestId,
    requestFamilyId: familyId,
    idempotentReplay: wasExisting,
    program: f.programItemId ? { id: f.programItemId, title: f.programTitle, url: f.programUrl } : null,
    requestHubUrl: CONTRACT.urls.requests + '/app?view=myrequests',
    launchHubUrl: CONTRACT.urls.launch + '/app?view=requests&q=' + encodeURIComponent(item.name || ''),
  };

  // Attach uploaded files to the category's configured Monday Files column.
  if (!wasExisting && cfg.fileColumn && Array.isArray(f.files) && f.files.length) {
    const up = await uploadFilesToItem(item.id, cfg.fileColumn, f.files);
    result.filesAttached = up.filter((r) => r.ok).length;
    const failed = up.filter((r) => !r.ok);
    if (failed.length) result.fileErrors = failed.map((x) => `${x.name}: ${x.error}`);
  }

  // Creative → Procurement: when a creative request also needs procurement,
  // spin up a matching, trackable item on the Procurement board and link them.
  if (category === 'creative' && String(f.requiresProcurement || '').toLowerCase() === 'yes') {
    const CREATIVE_LINK_COL = 'link_mm58mcm8';   // "Linked Procurement" (link) on the Creative board
    const PROC_LINK_COL = 'link_mm58nys4';       // "Linked Creative" (link) on the Procurement board
    try {
      const pcfg = BOARDS.procurement;
      const creativeUrl = itemUrl(cfg.boardId, item.id);
      const descParts = [];
      if (f.projectDescription) descParts.push(String(f.projectDescription));
      if (f.procurementNotes) descParts.push('Needs procured: ' + String(f.procurementNotes));
      descParts.push('Linked creative request: ' + creativeUrl);
      const pf = {
        team: f.team,
        outlet: f.outlet,
        requesterEmail: f.email,
        ccEmail: f.ccEmail,
        dueDate: f.idealDueDate,
        liveOrOnPropertyDate: f.liveOrOnPropertyDate || f.idealDueDate,
        launchImpact: f.launchImpact || 'unreviewed',
        launchWorkstream: f.launchWorkstream,
        launchPriority: f.launchPriority,
        programItemId: f.programItemId,
        programTitle: f.programTitle,
        programUrl: f.programUrl,
        itemDescription: f.procurementNotes || f.projectDescription || '',
        quantity: f.procurementQuantity,
        vendor: f.procurementVendor,
        procurementOwnerId: f.procurementOwnerId,
        estimateBasis: f.procurementEstimateBasis,
        workingCostEstimate: f.procurementWorkingCostEstimate,
        notes: descParts.join('\n\n'),
      };
      assertCanonical(pf);
      const childRequestId = childUuid(familyId, 'procurement');
      const pcv = buildColumnValues(pcfg, pf);
      Object.assign(pcv, integrationValues('procurement', pcfg, pf, {
        requestId: childRequestId, familyId, parentId: requestId, childType: 'procurement',
        syncState: 'pending', createdAt, title: item.name,
      }));
      pcv[PROC_LINK_COL] = { url: creativeUrl, text: 'Creative request' }; // clickable link back to creative
      let procItem = await findItemByRequestId(pcfg, 'procurement', childRequestId);
      const procWasExisting = Boolean(procItem);
      if (!procItem) {
        const pdata = await mondayQuery(
          `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
             create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues, create_labels_if_missing: true) { id name }
           }`,
          { boardId: String(pcfg.boardId), itemName: item.name, columnValues: JSON.stringify(pcv) }
        );
        procItem = pdata.create_item;
      }
      const procUrl = itemUrl(pcfg.boardId, procItem.id);
      result.procurementItemId = procItem.id;
      result.procurementUrl = procUrl;
      result.procurementRequestId = childRequestId;
      // Clickable link on the creative item pointing to the procurement item.
      try {
        await mondayQuery(
          `mutation ($b: ID!, $i: ID!, $cv: JSON!) { change_multiple_column_values (board_id: $b, item_id: $i, column_values: $cv) { id } }`,
          { b: String(cfg.boardId), i: String(item.id), cv: JSON.stringify({ [CREATIVE_LINK_COL]: { url: procUrl, text: 'Procurement request' } }) }
        );
        result.linked = true;
      } catch (e) { result.linkWarning = 'Items created; link cell not set: ' + e.message; }
      await updateIntegrationState('procurement', pcfg, pf, procItem, {
        requestId: childRequestId, familyId, parentId: requestId, childType: 'procurement',
        syncState: 'synced', createdAt, rawStatus: pcfg.defaultStatus,
      });
      if (!procWasExisting) await logAccess(f.email || 'unknown', 'Request submitted', pcfg.label, procItem.name + ' (from Creative)');
    } catch (e) {
      result.procurementError = 'Creative request created, but the linked procurement item failed: ' + e.message;
    }
  }

  // Creative → Social: when a creative request is for social media, create a
  // linked post on the Social & Content board with the target post date. It
  // starts in "Draft" (asset not made yet) and links back to this creative item
  // so scheduling can click through to the finished asset once it's uploaded.
  if (category === 'creative' && String(f.contentType || '').toLowerCase() === 'social media' && f.socialPostDate) {
    try {
      const creativeUrl = itemUrl(cfg.boardId, item.id);
      const sf = {
        team: f.team,
        outlet: f.outlet,
        requesterEmail: f.email,
        requestedCompletionDate: f.idealDueDate,
        socialPostDate: f.socialPostDate,
        launchImpact: f.launchImpact || 'unreviewed',
        launchWorkstream: f.launchWorkstream,
        launchPriority: f.launchPriority,
        programItemId: f.programItemId,
        programTitle: f.programTitle,
        programUrl: f.programUrl,
      };
      assertCanonical(sf);
      const childRequestId = childUuid(familyId, 'social');
      const scv = {
        [SOCIAL_BOARD.statusColumn]: { label: SOCIAL_BOARD.defaultStatus },
        [SOCIAL_BOARD.postDateColumn]: { date: String(f.socialPostDate) },
        [SOCIAL_BOARD.linkToCreativeCol]: { url: creativeUrl, text: 'Creative request' },
      };
      if (sf.outlet) scv[SOCIAL_BOARD.brandColumn] = { labels: [sf.outlet] };
      Object.assign(scv, integrationValues('social', SOCIAL_BOARD, sf, {
        requestId: childRequestId, familyId, parentId: requestId, childType: 'social',
        syncState: 'pending', createdAt, title: item.name, rawStatus: SOCIAL_BOARD.defaultStatus,
      }));
      let socialItem = await findItemByRequestId(SOCIAL_BOARD, 'social', childRequestId);
      const socialWasExisting = Boolean(socialItem);
      if (!socialItem) {
        const sdata = await mondayQuery(
          `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
             create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues, create_labels_if_missing: true) { id name }
           }`,
          { boardId: String(SOCIAL_BOARD.boardId), groupId: SOCIAL_BOARD.group, itemName: item.name, columnValues: JSON.stringify(scv) }
        );
        socialItem = sdata.create_item;
      }
      const socialUrl = itemUrl(SOCIAL_BOARD.boardId, socialItem.id);
      result.socialItemId = socialItem.id;
      result.socialUrl = socialUrl;
      result.socialRequestId = childRequestId;
      // Clickable link on the creative item pointing to the social post.
      try {
        await mondayQuery(
          `mutation ($b: ID!, $i: ID!, $cv: JSON!) { change_multiple_column_values (board_id: $b, item_id: $i, column_values: $cv) { id } }`,
          { b: String(cfg.boardId), i: String(item.id), cv: JSON.stringify({ [CREATIVE_SOCIAL_LINK_COL]: { url: socialUrl, text: 'Social post' } }) }
        );
        result.socialLinked = true;
      } catch (e) { result.socialLinkWarning = 'Items created; social link cell not set: ' + e.message; }
      await updateIntegrationState('social', SOCIAL_BOARD, sf, socialItem, {
        requestId: childRequestId, familyId, parentId: requestId, childType: 'social',
        syncState: 'synced', createdAt, rawStatus: SOCIAL_BOARD.defaultStatus,
      });
      if (!socialWasExisting) await logAccess(f.email || 'unknown', 'Request submitted', 'Social & Content', socialItem.name + ' (from Creative)');
    } catch (e) {
      result.socialError = 'Creative request created, but the linked social post failed: ' + e.message;
    }
  }

  const partial = Boolean(result.procurementError || result.socialError || result.linkWarning || result.socialLinkWarning);
  await updateIntegrationState(category, cfg, f, item, {
    requestId, familyId, parentId: null, syncState: partial ? 'partial' : 'synced',
    syncErrorCode: partial ? 'GENERATED_CHILD_OR_LINK_PARTIAL' : null,
    createdAt, rawStatus: cfg.defaultStatus || '',
  });
  result.syncState = partial ? 'partial' : 'synced';

  // Best-effort confirmation email — never block or fail the submission on it.
  // An idempotent replay resumes integration work without emailing twice.
  if (!wasExisting) {
    const emailOutcome = await maybeSendConfirmation(category, cfg, f, item);
    result.emailSent = Boolean(emailOutcome.sent);
    if (emailOutcome.error) result.emailError = emailOutcome.error;
    await logAccess(getRequesterEmail(f) || 'unknown', 'Request submitted', cfg.label, item.name);
  }

  return result;
}

// Fetch status labels for a board. If emailFilter is set (a requester), only
// items whose requester-email column matches are counted.
async function fetchAllStatusValues(cfg, emailFilter = null) {
  const labels = [];
  const cols = emailFilter ? [cfg.statusColumn, cfg.emailColumn] : [cfg.statusColumn];
  const qp = emailFilter
    ? { rules: [{ column_id: cfg.emailColumn, compare_value: [emailFilter], operator: 'contains_text' }], operator: 'and' }
    : null;
  let cursor = null;
  do {
    let page;
    if (!cursor) {
      const query = `
        query ($boardId: ID!, $cols: [String!], $qp: ItemsQuery) {
          boards (ids: [$boardId]) {
            items_page (limit: 500, query_params: $qp) { cursor items { column_values (ids: $cols) { id text } } }
          }
        }`;
      const data = await mondayQuery(query, { boardId: String(cfg.boardId), cols, qp });
      page = data.boards[0].items_page;
    } else {
      const query = `
        query ($cursor: String!, $cols: [String!]) {
          next_items_page (cursor: $cursor, limit: 500) { cursor items { column_values (ids: $cols) { id text } } }
        }`;
      const data = await mondayQuery(query, { cursor, cols });
      page = data.next_items_page;
    }
    cursor = page.cursor;
    for (const it of page.items) {
      const byId = {};
      for (const c of it.column_values) byId[c.id] = c.text || '';
      if (emailFilter && (byId[cfg.emailColumn] || '').trim().toLowerCase() !== emailFilter) continue;
      labels.push(byId[cfg.statusColumn] || '');
    }
  } while (cursor);
  return labels;
}

function toYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Pull just the fields the dashboard needs (status, due date, team) for every
// item on a board. Requester scoping via emailFilter, same as elsewhere.
async function fetchDashboardItems(cfg, emailFilter = null) {
  const out = [];
  const cols = [cfg.statusColumn, cfg.dateColumn, cfg.teamColumn].filter(Boolean);
  if (emailFilter && !cols.includes(cfg.emailColumn)) cols.push(cfg.emailColumn);
  const qp = emailFilter
    ? { rules: [{ column_id: cfg.emailColumn, compare_value: [emailFilter], operator: 'contains_text' }], operator: 'and' }
    : null;
  let cursor = null;
  do {
    let page;
    if (!cursor) {
      const query = `
        query ($boardId: ID!, $cols: [String!], $qp: ItemsQuery) {
          boards (ids: [$boardId]) {
            items_page (limit: 500, query_params: $qp) { cursor items { id name updated_at column_values (ids: $cols) { id text } } }
          }
        }`;
      const data = await mondayQuery(query, { boardId: String(cfg.boardId), cols, qp });
      page = data.boards[0].items_page;
    } else {
      const query = `
        query ($cursor: String!, $cols: [String!]) {
          next_items_page (cursor: $cursor, limit: 500) { cursor items { id name updated_at column_values (ids: $cols) { id text } } }
        }`;
      const data = await mondayQuery(query, { cursor, cols });
      page = data.next_items_page;
    }
    cursor = page.cursor;
    for (const it of page.items) {
      const byId = {};
      for (const c of it.column_values) byId[c.id] = c.text || '';
      if (emailFilter && (byId[cfg.emailColumn] || '').trim().toLowerCase() !== emailFilter) continue;
      out.push({
        id: it.id,
        name: it.name,
        status: byId[cfg.statusColumn] || '',
        due: (byId[cfg.dateColumn] || '').trim(),
        team: (byId[cfg.teamColumn] || '').trim(),
        updatedAt: it.updated_at,
      });
    }
  } while (cursor);
  return out;
}

// Leadership dashboard: load (open), risk (overdue / due this week), throughput
// (completed in last 30 days), plus open counts by board and by team.
async function dashboardCounts({ role, email } = {}) {
  const emailFilter = role === 'requester' ? String(email || '').trim().toLowerCase() : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = toYMD(today);
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const in7Str = toYMD(in7);
  const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const openByBoard = {};
  const openByTeam = {};
  const openItems = [], overdueItems = [], dueThisWeekItems = [], completedItems = [];

  const results = await Promise.all(
    Object.entries(BOARDS).map(async ([key, cfg]) => {
      const items = await fetchDashboardItems(cfg, emailFilter);
      let open = 0;
      for (const it of items) {
        const brief = { name: it.name, url: itemUrl(cfg.boardId, it.id), category: cfg.label, categoryKey: key, status: it.status, due: it.due };
        const bucket = bucketForStatus(key, it.status);
        const isOpen = bucket !== 'completed' && bucket !== null; // not done, not cancelled
        if (isOpen) {
          open += 1;
          const team = it.team || 'Unspecified';
          openByTeam[team] = (openByTeam[team] || 0) + 1;
          openItems.push(brief);
          if (it.due && it.due < todayStr) overdueItems.push(brief);
          else if (it.due && it.due >= todayStr && it.due <= in7Str) dueThisWeekItems.push(brief);
        } else if (bucket === 'completed') {
          const t = it.updatedAt ? new Date(it.updatedAt).getTime() : 0;
          if (t && t >= cutoff30) { completedItems.push({ ...brief, completedAt: it.updatedAt }); } // approx: last edit ≈ completion
        }
      }
      return [key, open];
    })
  );
  for (const [key, open] of results) { openByBoard[key] = open; }
  const byDueAsc = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
  openItems.sort(byDueAsc); overdueItems.sort(byDueAsc); dueThisWeekItems.sort(byDueAsc);
  completedItems.sort((a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0));
  return {
    ok: true,
    openTotal: openItems.length,
    overdue: overdueItems.length,
    dueThisWeek: dueThisWeekItems.length,
    completed30d: completedItems.length,
    openByBoard, openByTeam,
    items: {
      open: openItems.slice(0, 200),
      overdue: overdueItems.slice(0, 200),
      dueThisWeek: dueThisWeekItems.slice(0, 200),
      completed: completedItems.slice(0, 200),
    },
  };
}

async function recentSubmissions({ limit = 15, role, email, mine = false } = {}) {
  const emailFilter = (mine || role === 'requester') ? String(email || '').trim().toLowerCase() : null;
  const all = [];
  await Promise.all(
    Object.entries(BOARDS).map(async ([key, cfg]) => {
      // For "My Requests" (mine) we also surface requests where this person is
      // the "Also Notify" (cc) recipient — tagged shared:true. The plain
      // requester dashboard feed stays scoped to their own requests only.
      const ccCol = (cfg.fields.find((f) => f.key === 'ccEmail') || {}).column || null;
      const includeShared = Boolean(mine && ccCol);
      const cols = emailFilter
        ? [cfg.statusColumn, cfg.emailColumn, ...(includeShared ? [ccCol] : [])]
        : [cfg.statusColumn];
      let qp = null;
      if (includeShared) {
        qp = { rules: [
          { column_id: cfg.emailColumn, compare_value: [emailFilter], operator: 'contains_text' },
          { column_id: ccCol, compare_value: [emailFilter], operator: 'contains_text' },
        ], operator: 'or' };
      } else if (emailFilter) {
        qp = { rules: [{ column_id: cfg.emailColumn, compare_value: [emailFilter], operator: 'contains_text' }], operator: 'and' };
      }
      const query = `
        query ($boardId: ID!, $cols: [String!], $qp: ItemsQuery) {
          boards (ids: [$boardId]) {
            items_page (limit: 100, query_params: $qp) {
              items { id name created_at column_values (ids: $cols) { id text } }
            }
          }
        }`;
      const data = await mondayQuery(query, { boardId: String(cfg.boardId), cols, qp });
      for (const it of data.boards[0].items_page.items) {
        const byId = {};
        for (const c of it.column_values) byId[c.id] = c.text || '';
        const reqEmail = (byId[cfg.emailColumn] || '').trim().toLowerCase();
        const ccVal = ccCol ? (byId[ccCol] || '').trim().toLowerCase() : '';
        const isMine = reqEmail === emailFilter;
        const isShared = includeShared && !isMine && ccVal === emailFilter;
        if (emailFilter && !isMine && !isShared) continue; // near-miss safeguard
        all.push({
          itemId: it.id,
          name: it.name,
          category: cfg.label,
          categoryKey: key,
          status: byId[cfg.statusColumn] || '',
          createdAt: it.created_at,
          url: itemUrl(cfg.boardId, it.id),
          shared: isShared,
          requestedBy: byId[cfg.emailColumn] || '',
        });
      }
    })
  );
  // "My Requests" also includes Business Card requests (a Creative sub-type that
  // routes to its own board). That board has no status column — it tracks state
  // by group, so completion = the item sitting in the "Complete" group.
  if (emailFilter) {
    try {
      const query = `
        query ($boardId: ID!, $cols: [String!], $qp: ItemsQuery) {
          boards (ids: [$boardId]) {
            items_page (limit: 100, query_params: $qp) {
              items { id name created_at group { id } column_values (ids: $cols) { id text } }
            }
          }
        }`;
      const qp = { rules: [{ column_id: BC_REQUESTER_EMAIL_COL, compare_value: [emailFilter], operator: 'contains_text' }], operator: 'and' };
      const data = await mondayQuery(query, { boardId: String(BUSINESS_CARD.boardId), cols: [BC_REQUESTER_EMAIL_COL], qp });
      for (const it of data.boards[0].items_page.items) {
        const byId = {};
        for (const c of it.column_values) byId[c.id] = c.text || '';
        if ((byId[BC_REQUESTER_EMAIL_COL] || '').trim().toLowerCase() !== emailFilter) continue;
        all.push({
          itemId: it.id,
          name: it.name,
          category: BUSINESS_CARD.label,
          categoryKey: 'businesscard',
          status: (it.group && it.group.id === BC_DONE_GROUP_ID) ? 'Completed' : '',
          createdAt: it.created_at,
          url: itemUrl(BUSINESS_CARD.boardId, it.id),
          shared: false,
          requestedBy: byId[BC_REQUESTER_EMAIL_COL] || '',
        });
      }
    } catch (e) { /* best-effort — never fail My Requests on the Business Card scan */ }
  }
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { ok: true, items: all.slice(0, limit) };
}

// Top requesters over a trailing window (default 7 days), ranked by how many
// requests they submitted across all boards. Admin-only panel on the dashboard.
// Requesters, if they ever hit it, only see their own tally.
async function topRequesters({ role, email, days = 7, top = 3 } = {}) {
  const emailFilter = role === 'requester' ? String(email || '').trim().toLowerCase() : null;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const counts = {};
  await Promise.all(
    Object.entries(BOARDS).map(async ([, cfg]) => {
      if (!cfg.emailColumn) return;
      const query = `
        query ($boardId: ID!, $cols: [String!]) {
          boards (ids: [$boardId]) {
            items_page (limit: 500) { items { created_at column_values (ids: $cols) { id text } } }
          }
        }`;
      const data = await mondayQuery(query, { boardId: String(cfg.boardId), cols: [cfg.emailColumn] });
      for (const it of data.boards[0].items_page.items) {
        const t = it.created_at ? new Date(it.created_at).getTime() : 0;
        if (!t || t < cutoff) continue;
        const byId = {};
        for (const c of it.column_values) byId[c.id] = c.text || '';
        const em = (byId[cfg.emailColumn] || '').trim().toLowerCase();
        if (!em) continue;
        if (emailFilter && em !== emailFilter) continue;
        counts[em] = (counts[em] || 0) + 1;
      }
    })
  );
  const requesters = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([em, count]) => ({ email: em, count }));
  return { ok: true, requesters, days };
}

function normalizeRequesterSearch(value) {
  return String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function requesterMatches(query, requesterEmail) {
  const needle = normalizeRequesterSearch(query);
  if (!needle) return true;
  const emailText = String(requesterEmail || '');
  const localPart = emailText.split('@')[0] || '';
  const haystack = normalizeRequesterSearch(`${emailText} ${localPart}`);
  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

async function listBoardItems({ category, search, requester, status, cursor, limit = 25, role, email }) {
  const cfg = BOARDS[category];
  if (!cfg) throw badRequest(`Unknown category "${category}".`);
  const emailFilter = role === 'requester' ? String(email || '').trim().toLowerCase() : null;
  const requesterFilter = String(requester || '').trim();
  const cols = Array.from(new Set([
    cfg.statusColumn, ...cfg.tableColumns,
    ...(emailFilter ? [cfg.emailColumn] : []),
  ]));
  const queryLimit = requesterFilter ? 500 : limit;

  const rules = [];
  if (search && search.trim()) {
    rules.push({ column_id: 'name', compare_value: [search.trim()], operator: 'contains_text' });
  }
  if (status && status.trim()) {
    rules.push({ column_id: cfg.statusColumn, compare_value: [status.trim()], operator: 'contains_text' });
  }
  if (emailFilter) {
    rules.push({ column_id: cfg.emailColumn, compare_value: [emailFilter], operator: 'contains_text' });
  }

  let page;
  if (cursor) {
    const query = `
      query ($cursor: String!, $cols: [String!], $limit: Int!) {
        next_items_page (cursor: $cursor, limit: $limit) {
          cursor
          items { id name created_at column_values (ids: $cols) { id text } }
        }
      }`;
    const data = await mondayQuery(query, { cursor, cols, limit: queryLimit });
    page = data.next_items_page;
  } else {
    const queryParams = rules.length ? { rules, operator: 'and' } : null;
    const query = `
      query ($boardId: ID!, $cols: [String!], $limit: Int!, $qp: ItemsQuery) {
        boards (ids: [$boardId]) {
          items_page (limit: $limit, query_params: $qp) {
            cursor
            items { id name created_at column_values (ids: $cols) { id text } }
          }
        }
      }`;
    const data = await mondayQuery(query, { boardId: String(cfg.boardId), cols, limit: queryLimit, qp: queryParams });
    page = data.boards[0].items_page;
  }

  // Collect matching pages before applying the normalized email predicate.
  if (requesterFilter && !cursor) {
    const allItems = [...(page.items || [])];
    let nextCursor = page.cursor;
    while (nextCursor) {
      const next = await mondayQuery(
        `query ($cursor: String!, $cols: [String!], $limit: Int!) {
          next_items_page (cursor: $cursor, limit: $limit) {
            cursor items { id name created_at column_values (ids: $cols) { id text } }
          }
        }`,
        { cursor: nextCursor, cols, limit: 500 }
      );
      const nextPage = next.next_items_page;
      allItems.push(...(nextPage.items || []));
      nextCursor = nextPage.cursor;
    }
    page = { items: allItems, cursor: null };
  }

  let items = page.items.map((it) => {
    const byId = {};
    for (const c of it.column_values) byId[c.id] = c.text || '';
    return {
      itemId: it.id,
      name: it.name,
      createdAt: it.created_at,
      status: byId[cfg.statusColumn] || '',
      columns: byId,
      url: itemUrl(cfg.boardId, it.id),
    };
  });
  // Exact-match safeguard so a requester never sees a near-miss email's items.
  if (emailFilter) items = items.filter((it) => (it.columns[cfg.emailColumn] || '').trim().toLowerCase() === emailFilter);
  if (requesterFilter) {
    items = items.filter((it) => requesterMatches(requesterFilter, it.columns[cfg.emailColumn]));
  }

  return {
    ok: true,
    category,
    board: cfg.label,
    statusColumn: cfg.statusColumn,
    columns: cfg.tableColumns,
    items,
    nextCursor: page.cursor || null,
    hasMore: Boolean(page.cursor) && page.items.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function itemUrl(boardId, itemId) {
  return `https://${ACCOUNT_SLUG}.monday.com/boards/${boardId}/pulses/${itemId}`;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const params = req.method === 'POST' ? await readBody(req) : (req.query || {});
    const action = params.action || (req.query && req.query.action);

    // Access gate: data actions require a valid token issued by verify-email.
    // The token carries the signed-in email + role, which scopes what they see.
    const GATED = new Set(['session', 'list-programs', 'list-procurement-owners', 'dashboard-counts', 'recent-submissions', 'list-board-items', 'create-routed-request', 'top-requesters']);
    let authRole = 'admin';
    let scopeRole = 'admin';
    let authEmail = null;
    let authPermissions = null;
    if (GATED.has(action)) {
      const auth = await authenticateRequest(req, params.token);
      if (!auth.valid) { res.status(401).json({ ok: false, error: 'Not authorized — please sign in again.', authRequired: true }); return; }
      authRole = auth.role || 'requester';
      authEmail = auth.email;
      authPermissions = auth;
      scopeRole = auth.requestVisibility === 'all' ? 'admin' : 'requester';
    }

    let result;
    switch (action) {
      case 'verify-email':
        if (String(process.env.ALLOW_LEGACY_EMAIL_GATE || '').toLowerCase() !== 'true') {
          res.status(410).json({ ok: false, error: 'Please use verified WorkOS sign-in.' }); return;
        }
        result = await verifyEmailAction({ email: params.email });
        // Issue an HttpOnly session cookie so the Edge middleware can guard /app.
        if (result && result.approved && result.token && result.token !== 'open') {
          res.setHeader('Set-Cookie', `rh_session=${result.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${12 * 60 * 60}`);
        }
        break;
      case 'session':
        result = {
          ok: true, email: authEmail, role: authRole,
          permissions: {
            requestVisibility: authPermissions.requestVisibility || 'own',
            launchAccess: authPermissions.launchAccess || 'None',
            canTriageRequests: Boolean(authPermissions.canTriageRequests),
            canManageIntegration: Boolean(authPermissions.canManageIntegration)
          },
          schemaVersion: SCHEMA_VERSION
        };
        break;
      case 'list-programs':
        result = { ok: true, programs: await listPrograms(), schemaVersion: SCHEMA_VERSION };
        break;
      case 'list-procurement-owners':
        result = { ok: true, owners: await listProcurementOwners(), schemaVersion: SCHEMA_VERSION };
        break;
      case 'create-routed-request':
        result = await createRoutedRequest({ category: params.category, fields: params.fields, role: authRole, authEmail });
        break;
      case 'dashboard-counts':
        result = await dashboardCounts({ role: scopeRole, email: authEmail });
        break;
      case 'recent-submissions':
        result = await recentSubmissions({ limit: params.limit ? Number(params.limit) : 15, role: scopeRole, email: authEmail, mine: Boolean(params.mine) });
        break;
      case 'top-requesters':
        result = await topRequesters({ role: scopeRole, email: authEmail, days: params.days ? Number(params.days) : 7, top: params.top ? Number(params.top) : 3 });
        break;
      case 'list-board-items':
        result = await listBoardItems({
          category: params.category,
          search: params.search,
          requester: params.requester,
          status: params.status,
          cursor: params.cursor,
          limit: params.limit ? Number(params.limit) : 25,
          role: scopeRole,
          email: authEmail,
        });
        break;
      default:
        throw badRequest(`Unknown or missing action: "${action}".`);
    }

    res.status(200).json(result);
  } catch (err) {
    const code = err.statusCode || 500;
    res.status(code).json({ ok: false, error: err.message, details: err.details || null });
  }
}
