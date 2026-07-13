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
    boardId: 18404162829,
    group: null,
    statusColumn: 'color_mm1gjsqg',
    defaultStatus: 'New',
    // columns shown in the tracking table (order matters)
    tableColumns: ['color_mm1gjsqg', 'dropdown_mm57trse', 'color_mm1gy17s', 'color_mm1gfcfb', 'date_mm57f4s6', 'numeric_mm57r30c'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'requestType', column: 'dropdown_mm57trse', kind: 'dropdown' },
      { key: 'department', column: 'color_mm1gy17s', kind: 'status' },
      { key: 'description', column: 'long_text_mm579pwz', kind: 'long_text' },
      { key: 'requesterName', column: 'text_mm57fsqc', kind: 'text' },
      { key: 'requesterEmail', column: 'email_mm57v4ag', kind: 'email' },
      { key: 'dueDate', column: 'date_mm57f4s6', kind: 'date' },
      { key: 'priority', column: 'color_mm1gfcfb', kind: 'status' },
      { key: 'budget', column: 'numeric_mm57r30c', kind: 'numbers' },
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
    ],
  },
  creative: {
    label: 'Creative',
    boardId: 8723326529,
    group: 'group_mm1cyers',
    statusColumn: 'status8',
    defaultStatus: 'New',
    tableColumns: ['status8', 'dropdown_mkpwtq12', 'text_mkpw8xrc', 'date_mkpwatyw'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'contentType', column: 'dropdown_mkpwtq12', kind: 'dropdown' },
      { key: 'departmentOutlet', column: 'text_mkpw8xrc', kind: 'text' },
      { key: 'projectDescription', column: 'long_text_mkpw4qsm', kind: 'long_text' },
      { key: 'email', column: 'email_mkpwc949', kind: 'email' },
      { key: 'idealDueDate', column: 'date_mkpwatyw', kind: 'date' },
    ],
  },
  event: {
    label: 'Event',
    boardId: 18421737613,
    group: null,
    statusColumn: 'color_mm57kea7',
    defaultStatus: 'New Request',
    tableColumns: ['color_mm57kea7', 'dropdown_mm57d6ce', 'color_mm57bde7', 'date_mm57gw1w', 'numeric_mm57k2sz'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'requestType', column: 'dropdown_mm57d6ce', kind: 'dropdown' },
      { key: 'description', column: 'long_text_mm57vz1t', kind: 'long_text' },
      { key: 'requesterName', column: 'text_mm57qjrq', kind: 'text' },
      { key: 'requesterEmail', column: 'email_mm578v57', kind: 'email' },
      { key: 'dueDate', column: 'date_mm57gw1w', kind: 'date' },
      { key: 'priority', column: 'color_mm57bde7', kind: 'status' },
      { key: 'budget', column: 'numeric_mm57k2sz', kind: 'numbers' },
    ],
  },
  design: {
    label: 'Design',
    boardId: 18421737614,
    group: null,
    statusColumn: 'color_mm57t0bg',
    defaultStatus: 'New Request',
    tableColumns: ['color_mm57t0bg', 'dropdown_mm57kttm', 'color_mm577rx0', 'date_mm57mnp', 'numeric_mm57wgvs'],
    fields: [
      { key: 'name', column: 'name', kind: 'name' },
      { key: 'requestType', column: 'dropdown_mm57kttm', kind: 'dropdown' },
      { key: 'description', column: 'long_text_mm5758fn', kind: 'long_text' },
      { key: 'requesterName', column: 'text_mm57p77q', kind: 'text' },
      { key: 'requesterEmail', column: 'email_mm576xwj', kind: 'email' },
      { key: 'dueDate', column: 'date_mm57mnp', kind: 'date' },
      { key: 'priority', column: 'color_mm577rx0', kind: 'status' },
      { key: 'budget', column: 'numeric_mm57wgvs', kind: 'numbers' },
    ],
  },
};

// ---------------------------------------------------------------------------
// KPI bucketing. The five boards use different status vocabularies, so we
// normalize each status label into one of four dashboard buckets by keyword.
// Terminal-negative states (cancelled / rejected) are excluded from all cards.
// Adjust the keyword lists here to retune the KPI cards.
// ---------------------------------------------------------------------------
const BUCKETS = ['active', 'review', 'progress', 'completed'];

function bucketForStatus(label) {
  const s = (label || '').toLowerCase().trim();
  if (!s) return 'active'; // blank status = newly submitted, still active
  if (/(cancel|reject)/.test(s)) return null; // excluded from KPIs
  if (/(review|pending)/.test(s)) return 'review';
  if (/(complete|received|delivered|live|\bdone\b|move to dam)/.test(s)) return 'completed';
  if (/(progress|working|sourcing|ordered|transit|approved|assigned)/.test(s)) return 'progress';
  return 'active'; // new, new request, on hold, stuck, sourcing-adjacent, etc.
}

// ---------------------------------------------------------------------------
// Monday column value formatting
// ---------------------------------------------------------------------------
function buildColumnValues(cfg, fields) {
  const cv = {};
  for (const f of cfg.fields) {
    if (f.kind === 'name') continue; // name is passed separately
    const raw = fields[f.key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
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
  // Always set the default status on creation.
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
// Actions
// ---------------------------------------------------------------------------
async function createRoutedRequest({ category, fields }) {
  const cfg = BOARDS[category];
  if (!cfg) throw badRequest(`Unknown category "${category}".`);
  const name = (fields && (fields.name || fields.title)) || `${cfg.label} Request`;
  const columnValues = buildColumnValues(cfg, fields || {});

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
  return {
    ok: true,
    category,
    board: cfg.label,
    boardId: cfg.boardId,
    itemId: item.id,
    itemName: item.name,
    url: itemUrl(cfg.boardId, item.id),
  };
}

async function fetchAllStatusValues(cfg) {
  // Returns array of status label strings for every item on the board.
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

  // Build query_params rules for server-side search/filter (first page only;
  // Monday's next_items_page carries the original query forward via the cursor).
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
          items {
            id name created_at
            column_values (ids: $cols) { id text ... on BoardRelationValue { display_value } }
          }
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
            items {
              id name created_at
              column_values (ids: $cols) { id text }
            }
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
  // Fallback: read raw stream (defensive; Vercel usually parses JSON already)
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

    let result;
    switch (action) {
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
