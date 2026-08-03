import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

await fs.access(new URL('./api/monday.js', import.meta.url));
const moduleUrl = new URL('./api/monday.js?phase5-verify', import.meta.url);

process.env.MONDAY_API_TOKEN = 'test-token';
delete process.env.AUTH_SECRET;
delete process.env.EMAIL_WEBHOOK_URL;

const calls = [];
let nextItem = 100;
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  calls.push(body);
  let data;
  if (body.query.includes('items_page')) {
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
assert.equal(JSON.parse(procurement.long_text_mm5wq9ad.text).schemaVersion, '1.1.0');
assert.equal(JSON.parse(social.long_text_mm5w1sxt.text).generatedChild, true);

assert.equal(payload.requestHubUrl, 'https://requests.lemonadehospitality.com/app?view=myrequests');
assert.match(payload.launchHubUrl, /launchcalendar\.lemonadehospitality\.com/);

console.log('Phase 5 Request Hub verification passed.');
