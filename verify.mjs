import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

await fs.access(new URL('./api/monday.js', import.meta.url));
await fs.access(new URL('./api/signout.js', import.meta.url));
const moduleUrl = new URL('./api/monday.js?creative-production-verify', import.meta.url);

process.env.MONDAY_API_TOKEN = 'test-token';
delete process.env.AUTH_SECRET;
delete process.env.EMAIL_WEBHOOK_URL;

const calls = [];
let nextItem = 100;
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  calls.push(body);
  let data;
  if (body.query.includes('column_values(ids: $cols)') && String(body.variables.board) === '18424230222') {
    data = { boards: [{ items_page: { cursor: null, items: [{
      id: '19000000001',
      name: 'Dog Program',
      url: 'https://hbcapital.monday.com/boards/18424230222/pulses/19000000001',
      group: { id: 'group_property', title: 'Property Wide Programs' },
      column_values: [
        { id: 'dropdown_mm5q4mx2', text: 'Milestone', value: null },
        { id: 'boolean_mm5yfh4r', text: 'v', value: '{"checked":true}' },
        { id: 'dropdown_mm5xpxcn', text: 'Launch', value: null },
        { id: 'timerange_mkyp8kx7', text: '2026-08-01 - 2026-10-15', value: '{"from":"2026-08-01","to":"2026-10-15"}' },
        { id: 'date_mm5qb732', text: '2026-10-15', value: '{"date":"2026-10-15"}' },
        { id: 'date_mm5q5w63', text: '2026-10-10', value: '{"date":"2026-10-10"}' }
      ]
    }, {
      id: '19000000002', name: 'Internal readiness checkpoint', group: { id: 'group_property', title: 'Property Wide Programs' },
      column_values: [
        { id: 'dropdown_mm5q4mx2', text: 'Milestone', value: null },
        { id: 'boolean_mm5yfh4r', text: '', value: '{"checked":false}' }
      ]
    }] } }] };
  } else if (body.query.includes('items_page')) {
    data = { boards: [{ items_page: { items: [] } }] };
  } else if (body.query.includes('create_item')) {
    nextItem += 1;
    data = { create_item: { id: String(nextItem), name: body.variables.itemName || body.variables.n || 'Log' } };
  } else if (body.query.includes('change_multiple_column_values')) {
    data = { change_multiple_column_values: { id: String(body.variables.i) } };
  } else {
    throw new Error('Unexpected test query');
  }
  return { ok: true, json: async () => ({ data }) };
};

const { default: handler } = await import(moduleUrl);
const requestId = '11111111-1111-4111-8111-111111111111';
const req = {
  method: 'POST',
  headers: {},
  body: {
    action: 'create-routed-request',
    category: 'creative',
    fields: {
      requestId,
      requestFamilyId: requestId,
      contentType: 'Social Media',
      name: 'Phase 2 verification',
      team: 'Guest Services',
      outlet: 'Lobby',
      email: 'tester@example.com',
      idealDueDate: '2026-08-10',
      liveOrOnPropertyDate: '2026-08-15',
      socialPostDate: '2026-08-15',
      programItemId: '19000000001',
      programTitle: 'dog program typo',
      programUrl: 'https://wrong.example/program',
      projectDescription: 'Verify the family handoff.',
      requiresProcurement: 'Yes',
      procurementNotes: 'Printed table tent'
    }
  }
};
let payload;
const res = {
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(value) { payload = value; return value; },
  end() {}
};

await handler(req, res);
assert.equal(res.statusCode, 200);
assert.equal(payload.requestId, requestId);
assert.equal(payload.requestFamilyId, requestId);
assert.equal(payload.syncState, 'synced');
assert.ok(payload.procurementRequestId);
assert.ok(payload.socialRequestId);
assert.deepEqual(payload.program, {
  id: '19000000001',
  title: 'Dog Program',
  url: 'https://hbcapital.monday.com/boards/18424230222/pulses/19000000001'
});

const creates = calls.filter((call) => call.query.includes('create_item') && call.variables.boardId);
const byBoard = Object.fromEntries(creates.map((call) => [String(call.variables.boardId), JSON.parse(call.variables.columnValues)]));
const root = byBoard['18421786819'];
const procurement = byBoard['18415967514'];
const social = byBoard['18409075892'];

assert.equal(root.text_mm5wqsp4, requestId);
assert.equal(root.text_mm5wfmqh, requestId);
assert.equal(procurement.text_mm5w38ba, requestId);
assert.equal(procurement.text_mm5wtk63, requestId);
assert.equal(social.text_mm5wqjed, requestId);
assert.equal(social.text_mm5wza5g, requestId);
assert.deepEqual(root.link_mm5w2hnv, {
  url: 'https://hbcapital.monday.com/boards/18424230222/pulses/19000000001',
  text: 'Dog Program'
});
assert.deepEqual(procurement.link_mm5wfwm, {
  url: 'https://hbcapital.monday.com/boards/18424230222/pulses/19000000001',
  text: 'Dog Program'
});
const procurementMetadata = JSON.parse(procurement.long_text_mm5wq9ad.text);
const socialMetadata = JSON.parse(social.long_text_mm5w1sxt.text);
assert.equal(procurementMetadata.schemaVersion, '1.2.0');
assert.equal(procurementMetadata.programItemId, '19000000001');
assert.equal(procurementMetadata.programTitle, 'Dog Program');
assert.equal(socialMetadata.generatedChild, true);
assert.equal(socialMetadata.programItemId, '19000000001');
assert.equal(socialMetadata.programTitle, 'Dog Program');

assert.equal(payload.requestHubUrl, 'https://requests.lemonadehospitality.com/app?view=myrequests');
assert.match(payload.launchHubUrl, /launchcalendar\.lemonadehospitality\.com/);

const photoRequestId = '22222222-2222-4222-8222-222222222222';
payload = null;
res.statusCode = undefined;
await handler({
  method: 'POST', headers: {}, body: {
    action: 'create-routed-request', category: 'creative', fields: {
      contentType: 'Photography', name: 'Incomplete shoot', team: 'Brand',
      email: 'tester@example.com', idealDueDate: '2026-08-28',
      projectDescription: 'Budget is intentionally missing.', intendedUsage: ['Website']
    }
  }
}, res);
assert.equal(res.statusCode, 400);
assert.match(payload.error, /estimated budget/);

const photoCallStart = calls.length;
payload = null;
res.statusCode = undefined;
await handler({
  method: 'POST', headers: {}, body: {
    action: 'create-routed-request', category: 'creative', fields: {
      requestId: photoRequestId, requestFamilyId: photoRequestId,
      contentType: 'Photography', name: 'Summer lifestyle shoot', team: 'Brand',
      email: 'tester@example.com', idealDueDate: '2026-08-28',
      projectDescription: 'Lifestyle photography for the fall campaign.',
      requiresProcurement: 'No',
      intendedUsage: ['Website', 'Organic Social', 'Paid Social / Advertising'],
      photographerVideographer: 'Sunny Studio', estimatedBudget: '12500.50'
    }
  }
}, res);
assert.equal(res.statusCode, 200);
const photoCreate = calls.slice(photoCallStart).find((call) =>
  call.query.includes('create_item') && String(call.variables.boardId) === '18421786819');
assert.ok(photoCreate, 'Photography request should create a Creative item');
const photoColumns = JSON.parse(photoCreate.variables.columnValues);
assert.deepEqual(photoColumns.dropdown_mm5ww6cx, { labels: ['Website', 'Organic Social', 'Paid Social / Advertising'] });
assert.equal(photoColumns.text_mm5wnab3, 'Sunny Studio');
assert.equal(photoColumns.numeric_mm5wrdh9, '12500.50');

const procurementCallStart = calls.length;
payload = null;
res.statusCode = undefined;
await handler({
  method: 'POST', headers: {}, body: {
    action: 'create-routed-request', category: 'procurement', fields: {
      name: 'Lobby planters', team: 'Guest Services', requesterEmail: 'tester@example.com',
      dueDate: '2026-08-25', estimateBasis: 'Planning Allowance', workingCostEstimate: '3750.00'
    }
  }
}, res);
assert.equal(res.statusCode, 200);
const procurementCreate = calls.slice(procurementCallStart).find((call) =>
  call.query.includes('create_item') && String(call.variables.boardId) === '18415967514');
assert.ok(procurementCreate, 'Procurement request should create a Procurement item');
const procurementColumns = JSON.parse(procurementCreate.variables.columnValues);
assert.equal(procurementColumns.numeric_mm5r88qe, '3750.00');
assert.deepEqual(procurementColumns.dropdown_mm5yhppt, { labels: ['Planning Allowance'] });

payload = null;
res.statusCode = undefined;
await handler({
  method: 'POST', headers: {}, body: {
    action: 'create-routed-request', category: 'procurement', fields: {
      name: 'Missing estimate', team: 'Guest Services', requesterEmail: 'tester@example.com',
      dueDate: '2026-08-25', estimateBasis: 'Internal Estimate'
    }
  }
}, res);
assert.equal(res.statusCode, 400);
assert.match(payload.error, /working cost estimate/i);

const html = await fs.readFile(new URL('./public/app.html', import.meta.url), 'utf8');
assert.match(html, /Where will the photos or video be used\?/);
assert.match(html, /request-table-shell/);
assert.match(html, /data-showif-values/);
assert.match(html, /Filter by requester email/);
assert.doesNotMatch(html, /key: 'requesterName', label: 'Your Name'/);
assert.match(html, /key: 'workingCostEstimate', label: 'Working Cost Estimate'/);
assert.match(html, /Approved Budget','Vendor Quote','Internal Estimate','Planning Allowance','Estimate Needed/);
assert.match(html, /What opening or program does this support\?/);
assert.match(html, /Search openings and programs/);
assert.match(html, /programOptionsHtml/);
assert.match(html, /optgroup/);
assert.doesNotMatch(html, /Program \/ Initiative \(if applicable\)/);

// Regression: a user with a valid legacy rh_session cookie can also have the
// literal shared-auth marker in localStorage. The marker must not mask the
// valid cookie and trigger a / -> /app -> signout refresh loop.
process.env.AUTH_SECRET = 'legacy-loop-secret';
process.env.APPROVED_EMAILS = 'legacy@example.com';
const legacyPayload = `legacy@example.com|admin|${Date.now() + 3600000}`;
const legacyB64 = Buffer.from(legacyPayload).toString('base64url');
const legacySignature = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(legacyB64).digest('hex');
payload = null;
res.statusCode = undefined;
await handler({
  method: 'POST',
  headers: { cookie: `rh_session=${encodeURIComponent(`${legacyB64}.${legacySignature}`)}` },
  body: { action: 'session', token: 'shared' }
}, res);
assert.equal(res.statusCode, 200);
assert.equal(payload.ok, true);
assert.equal(payload.email, 'legacy@example.com');

const { default: signoutHandler } = await import(new URL('./api/signout.js?verify', import.meta.url));
const signout = {
  headers: {}, statusCode: 200, ended: false,
  setHeader(name, value) { this.headers[name] = value; },
  writeHead(statusCode, headers) { this.statusCode = statusCode; Object.assign(this.headers, headers); },
  end() { this.ended = true; }
};
signoutHandler({}, signout);
assert.equal(signout.statusCode, 302);
assert.match(signout.headers['Set-Cookie'], /rh_session=.*Max-Age=0/);
assert.match(signout.headers.Location, /launchcalendar\.lemonadehospitality\.com\/api\/signout/);
assert.equal(signout.ended, true);

console.log('Request creation, table UI, and legacy-session loop regression verification passed.');
