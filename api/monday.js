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

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_VERSION = '2024-10';
const ACCOUNT_SLUG = 'hbcapital'; // used to build item deep-links

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
    tableColumns: ['color_mm3ym1pj', 'text_mm3ytbvq', 'numeric_mm3yee8z', 'date_mm3yn5hj'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'department', column: 'text_mm3ytbvq', kind: 'text' },
      { key: 'itemDescription', column: 'text_mm3y2353', kind: 'text' },
      { key: 'quantity', column: 'numeric_mm3yee8z', kind: 'numbers' },
      { key: 'vendor', column: 'text_mm3yng56', kind: 'text' },
      { key: 'budget', column: 'text_mm3ypbsb', kind: 'text' },               // Budget is a TEXT column on this board
      { key: 'dueDate', column: 'date_mm3yn5hj', kind: 'date' },
      { key: 'requesterEmail', column: 'email_mm57tjxr', kind: 'email' },
      { key: 'notes', column: 'long_text_mm3y661f', kind: 'long_text' },
    ],
  },
  uniform: {
    label: 'Uniform',
    boardId: 18415985409,
    group: null,
    statusColumn: 'color_mm3yma9j',
    defaultStatus: 'New Request',
    tableColumns: ['color_mm3yma9j', 'dropdown_mm3y16t7', 'text_mm3yghj8', 'numeric_mm3ygc6y', 'date_mm3y77nq'],
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
    ],
  },
  creative: {
    label: 'Creative',
    boardId: 18421786819, // "creative request new"
    group: null,
    statusColumn: 'color_mm57d4mj',
    defaultStatus: 'New',
    tableColumns: ['color_mm57d4mj', 'dropdown_mm57r0h9', 'text_mm57mzz2', 'date_mm57j8b'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'contentType', column: 'dropdown_mm57r0h9', kind: 'dropdown' },
      { key: 'departmentOutlet', column: 'text_mm57mzz2', kind: 'text' },
      { key: 'email', column: 'email_mm57jmf2', kind: 'email' },
      { key: 'idealDueDate', column: 'date_mm57j8b', kind: 'date' },
      { key: 'projectDescription', column: 'long_text_mm57wa18', kind: 'long_text' },
    ],
  },
  print: {
    label: 'Print',
    boardId: 18421786829, // "Print Requests"
    group: null,
    statusColumn: 'color_mm57d28j',
    defaultStatus: 'New',
    tableColumns: ['color_mm57d28j', 'color_mm57egma', 'dropdown_mm57yjtk', 'numeric_mm57rqaq', 'date_mm57f4h4'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'printType', column: 'color_mm57egma', kind: 'status' },         // Menus / Other
      { key: 'outlets', column: 'dropdown_mm57yjtk', kind: 'dropdown' },      // multi-select
      { key: 'details', column: 'long_text_mm57nbb6', kind: 'long_text' },    // used when printType = Other
      { key: 'quantity', column: 'numeric_mm57rqaq', kind: 'numbers' },
      { key: 'requesterName', column: 'text_mm57zdjb', kind: 'text' },
      { key: 'requesterEmail', column: 'email_mm57r2z6', kind: 'email' },
      { key: 'neededBy', column: 'date_mm57f4h4', kind: 'date' },
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
};

const EMAIL_LABELS = {
  name: 'Request', department: 'Department', itemDescription: 'Item / what’s needed',
  quantity: 'Quantity', vendor: 'Vendor', budget: 'Budget', dueDate: 'Due date', notes: 'Notes',
  uniformType: 'Uniform type', departmentRole: 'Department / role',
  requirements: 'Specific requirements', sizeRequirements: 'Size requirements',
  contentType: 'Content type', departmentOutlet: 'Department / outlet',
  idealDueDate: 'Ideal due date', projectDescription: 'Project description',
  printType: 'Type', details: 'Details', neededBy: 'Needed by',
  requesterName: 'Requester name', requesterEmail: 'Email', email: 'Email',
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
    if (v === undefined || v === null || v === '' || k === 'name' || k === 'title') continue;
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
    <p style="margin:22px 0 0;font-size:12px;color:#6d7a77">You'll be updated as your request progresses.</p>
  </div>`;

  const text = `Thanks — we received your ${cfg.label} request.\n\n${item.name}\n`
    + rows.map(([l, v]) => `- ${l}: ${v}`).join('\n')
    + (expected ? `\n\nExpected completion: ${expected}` : '\n\nNo target date was provided.');

  return { subject, html, text, expected };
}

async function maybeSendConfirmation(category, cfg, fields, item) {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (!url) return { sent: false, skipped: true };
  const to = getRequesterEmail(fields);
  if (!to) return { sent: false, error: 'no requester email on submission' };
  try {
    const summary = buildEmailSummary(category, cfg, fields, item);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to,
        subject: summary.subject,
        html: summary.html,
        text: summary.text,
        category: cfg.label,
        requestName: item.name,
        expectedCompletion: summary.expected,
      }),
    });
    if (!resp.ok) return { sent: false, error: `email webhook returned ${resp.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// KPI bucketing. The boards use different status vocabularies, so we normalize
// each status label into one of four dashboard buckets by keyword. Terminal-
// negative states (cancelled / rejected) are excluded from all cards.
// Adjust the keyword lists here to retune the KPI cards.
// ---------------------------------------------------------------------------
const BUCKETS = ['active', 'review', 'progress', 'completed'];

function bucketForStatus(label) {
  const s = (label || '').toLowerCase().trim();
  if (!s) return 'active'; // blank status = newly submitted, still active
  if (/(cancel|reject)/.test(s)) return null; // excluded from KPIs
  if (/(review|pending)/.test(s)) return 'review';
  if (/(complete|received|delivered|printed|live|\bdone\b|move to dam)/.test(s)) return 'completed';
  if (/(progress|working|sourcing|ordered|transit|approved|assigned)/.test(s)) return 'progress';
  return 'active'; // new, new request, awaiting, ready to order, on hold, stuck, etc.
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
      case 'status':
        cv[f.column] = { label: String(raw) };
        break;
      case 'dropdown':
        cv[f.column] = Array.isArray(raw)
          ? { labels: raw.map(String) }
          : { labels: [String(raw)] };
        break;
      default:
        break;
    }
  }
  // Always set the default workflow status on creation.
  cv[cfg.statusColumn] = { label: cfg.defaultStatus };
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

function approvedEmails() {
  return String(process.env.APPROVED_EMAILS || '')
    .split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}
function isEmailApproved(email) {
  const list = approvedEmails();
  if (!list.length) return true; // gate not configured → open
  return list.includes(String(email || '').trim().toLowerCase());
}
function authConfigured() { return Boolean(process.env.AUTH_SECRET); }

function issueToken(email) {
  const emailLc = String(email).trim().toLowerCase();
  if (!authConfigured()) return 'open';
  const payload = `${emailLc}|${Date.now() + TOKEN_TTL_MS}`;
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}
function verifyToken(token) {
  if (!authConfigured()) return { valid: true, email: null }; // gate open
  if (!token || typeof token !== 'string' || !token.includes('.')) return { valid: false };
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(b64).digest('hex');
  let a, b;
  try { a = Buffer.from(sig || '', 'hex'); b = Buffer.from(expected, 'hex'); } catch { return { valid: false }; }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false };
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return { valid: false }; }
  const [email, expStr] = payload.split('|');
  if (!email || !expStr || Number(expStr) < Date.now()) return { valid: false };
  if (!isEmailApproved(email)) return { valid: false }; // access revoked if removed from list
  return { valid: true, email };
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
  const approved = isEmailApproved(clean);
  await logAccess(clean, approved ? 'Access approved' : 'Access denied', '', approved ? 'Signed in' : 'Email not on approved list');
  if (!approved) return { ok: true, approved: false };
  return { ok: true, approved: true, token: issueToken(clean), email: clean.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
async function createRoutedRequest({ category, fields }) {
  const cfg = BOARDS[category];
  if (!cfg) throw badRequest(`Unknown category "${category}".`);
  const name = (fields && (fields.name || fields.title)) || `${cfg.label} Request`;
  const columnValues = buildColumnValues(cfg, fields || {});

  // Print · Menus: expand per-outlet quantities into their columns, set the
  // Outlet(s) dropdown, and total the Quantity column.
  if (category === 'print' && fields && fields.outletQuantities && typeof fields.outletQuantities === 'object') {
    const chosen = [];
    let total = 0;
    for (const [outlet, qty] of Object.entries(fields.outletQuantities)) {
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
        create_labels_if_missing: false
      ) { id name }
    }`;

  const data = await mondayQuery(query, {
    boardId: String(cfg.boardId),
    groupId: cfg.group || null,
    itemName: name,
    columnValues: JSON.stringify(columnValues),
  });

  const item = data.create_item;
  const result = {
    ok: true,
    category,
    board: cfg.label,
    boardId: cfg.boardId,
    itemId: item.id,
    itemName: item.name,
    url: itemUrl(cfg.boardId, item.id),
  };

  // Best-effort confirmation email — never block or fail the submission on it.
  const emailOutcome = await maybeSendConfirmation(category, cfg, fields || {}, item);
  result.emailSent = Boolean(emailOutcome.sent);
  if (emailOutcome.error) result.emailError = emailOutcome.error;

  await logAccess(getRequesterEmail(fields || {}) || 'unknown', 'Request submitted', cfg.label, item.name);

  return result;
}

async function fetchAllStatusValues(cfg) {
  const labels = [];
  let cursor = null;
  do {
    let data;
    if (!cursor) {
      const query = `
        query ($boardId: ID!, $col: [String!]) {
          boards (ids: [$boardId]) {
            items_page (limit: 500) {
              cursor
              items { column_values (ids: $col) { text } }
            }
          }
        }`;
      data = await mondayQuery(query, { boardId: String(cfg.boardId), col: [cfg.statusColumn] });
      const page = data.boards[0].items_page;
      cursor = page.cursor;
      for (const it of page.items) labels.push(it.column_values[0] ? it.column_values[0].text : '');
    } else {
      const query = `
        query ($cursor: String!, $col: [String!]) {
          next_items_page (cursor: $cursor, limit: 500) {
            cursor
            items { column_values (ids: $col) { text } }
          }
        }`;
      data = await mondayQuery(query, { cursor, col: [cfg.statusColumn] });
      const page = data.next_items_page;
      cursor = page.cursor;
      for (const it of page.items) labels.push(it.column_values[0] ? it.column_values[0].text : '');
    }
  } while (cursor);
  return labels;
}

async function dashboardCounts() {
  const totals = { active: 0, review: 0, progress: 0, completed: 0 };
  const perBoard = {};
  const results = await Promise.all(
    Object.entries(BOARDS).map(async ([key, cfg]) => {
      const labels = await fetchAllStatusValues(cfg);
      const local = { active: 0, review: 0, progress: 0, completed: 0, total: labels.length };
      for (const l of labels) {
        const b = bucketForStatus(l);
        if (b) local[b] += 1;
      }
      return [key, local];
    })
  );
  for (const [key, local] of results) {
    perBoard[key] = local;
    for (const b of BUCKETS) totals[b] += local[b];
  }
  return { ok: true, totals, perBoard };
}

async function recentSubmissions({ limit = 15 } = {}) {
  const all = [];
  await Promise.all(
    Object.entries(BOARDS).map(async ([key, cfg]) => {
      const query = `
        query ($boardId: ID!, $col: [String!]) {
          boards (ids: [$boardId]) {
            items_page (limit: 100) {
              items { id name created_at column_values (ids: $col) { text } }
            }
          }
        }`;
      const data = await mondayQuery(query, { boardId: String(cfg.boardId), col: [cfg.statusColumn] });
      for (const it of data.boards[0].items_page.items) {
        all.push({
          itemId: it.id,
          name: it.name,
          category: cfg.label,
          categoryKey: key,
          status: it.column_values[0] ? it.column_values[0].text : '',
          createdAt: it.created_at,
          url: itemUrl(cfg.boardId, it.id),
        });
      }
    })
  );
  all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { ok: true, items: all.slice(0, limit) };
}

async function listBoardItems({ category, search, status, cursor, limit = 25 }) {
  const cfg = BOARDS[category];
  if (!cfg) throw badRequest(`Unknown category "${category}".`);
  const cols = Array.from(new Set([cfg.statusColumn, ...cfg.tableColumns]));

  const rules = [];
  if (search && search.trim()) {
    rules.push({ column_id: 'name', compare_value: [search.trim()], operator: 'contains_text' });
  }
  if (status && status.trim()) {
    rules.push({ column_id: cfg.statusColumn, compare_value: [status.trim()], operator: 'contains_text' });
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
    const data = await mondayQuery(query, { cursor, cols, limit });
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
    const data = await mondayQuery(query, { boardId: String(cfg.boardId), cols, limit, qp: queryParams });
    page = data.boards[0].items_page;
  }

  const items = page.items.map((it) => {
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

  return {
    ok: true,
    category,
    board: cfg.label,
    statusColumn: cfg.statusColumn,
    columns: cfg.tableColumns,
    items,
    nextCursor: page.cursor || null,
    hasMore: Boolean(page.cursor) && items.length > 0,
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
    const GATED = new Set(['dashboard-counts', 'recent-submissions', 'list-board-items', 'create-routed-request']);
    if (GATED.has(action)) {
      const auth = verifyToken(params.token);
      if (!auth.valid) { res.status(401).json({ ok: false, error: 'Not authorized — please sign in again.', authRequired: true }); return; }
    }

    let result;
    switch (action) {
      case 'verify-email':
        result = await verifyEmailAction({ email: params.email });
        // Issue an HttpOnly session cookie so the Edge middleware can guard /app.
        if (result && result.approved && result.token && result.token !== 'open') {
          res.setHeader('Set-Cookie', `rh_session=${result.token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${12 * 60 * 60}`);
        }
        break;
      case 'create-routed-request':
        result = await createRoutedRequest({ category: params.category, fields: params.fields });
        break;
      case 'dashboard-counts':
        result = await dashboardCounts();
        break;
      case 'recent-submissions':
        result = await recentSubmissions({ limit: params.limit ? Number(params.limit) : 15 });
        break;
      case 'list-board-items':
        result = await listBoardItems({
          category: params.category,
          search: params.search,
          status: params.status,
          cursor: params.cursor,
          limit: params.limit ? Number(params.limit) : 25,
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
