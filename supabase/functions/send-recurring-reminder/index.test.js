import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { SourceTextModule, createContext } from 'node:vm';

// Run the actual Edge Function with an isolated Deno boundary; all HTTP is synthetic.
const source = stripTypeScriptTypes(await readFile(new URL('./index.ts', import.meta.url), 'utf8'));
const payload = { periodKey: '2026-11', pendingExpenses: [{ name: 'Rent', cost: 12.5 }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

async function setup(options = {}) {
    let handler;
    const calls = [];
    const env = {
        SUPABASE_URL: 'https://database.example.test', SUPABASE_ANON_KEY: 'synthetic-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', RESEND_API_KEY: 'synthetic-resend', ...options.env
    };
    const context = createContext({
        Request, Response, AbortSignal, console: { error() {} },
        Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
        fetch: async (url, init = {}) => {
            const call = { url, method: init.method || 'GET', headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
            calls.push(call);
            if (url.endsWith('/auth/v1/user')) return json(options.auth ?? { id: 'user-a', email: 'member@example.test' }, options.authStatus ?? 200);
            if (url.includes('/profiles?') && call.method === 'GET') return json(options.profiles ?? [{ username: 'Member', currency: '$', last_reminder_period: { yearly: '2025' } }], options.profileStatus ?? 200);
            if (url.endsWith('/rpc/claim_reminder_delivery')) return json(options.claim ?? { status: 'claimed', id: 'queue-a' }, options.claimStatus ?? 200);
            if (url === 'https://api.resend.com/emails') {
                if (options.providerThrows) throw new Error('timeout');
                return json({ id: 'email-a' }, options.providerStatus ?? 200);
            }
            if (call.method === 'PATCH') return json({}, url.includes('/profiles?') ? options.profilePatchStatus ?? 200 : options.queuePatchStatus ?? 200);
            if (call.method === 'DELETE' && url.includes('/email_reminder_queue?')) return json({});
            assert.fail(`Unexpected request: ${call.method} ${url}`);
        }
    });
    const module = new SourceTextModule(source, { context });
    await module.link(() => assert.fail('Unexpected module dependency'));
    await module.evaluate();
    return {
        calls,
        async request(body = payload, { method = 'POST', authorization = 'Bearer synthetic-user', raw } = {}) {
            const headers = { 'Content-Type': 'application/json' };
            if (authorization) headers.Authorization = authorization;
            const response = await handler(new Request('https://edge.example.test', {
                method, headers, ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {})
            }));
            return { status: response.status, headers: response.headers, text: await response.text() };
        }
    };
}

test('preflight and unsupported methods never authenticate or send', async () => {
    const { request, calls } = await setup();
    const response = await request(null, { method: 'OPTIONS' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.equal((await request(null, { method: 'GET' })).status, 405);
    assert.equal(calls.length, 0);
});

for (const options of [{ authStatus: 401 }, { auth: {} }, { env: { SUPABASE_URL: '' } }]) {
    test(`authentication fails closed: ${JSON.stringify(options)}`, async () => {
        const { request, calls } = await setup(options);
        assert.equal((await request()).status, 401);
        assert.ok(calls.every(call => call.url.endsWith('/auth/v1/user')));
    });
}

test('missing authorization is rejected before HTTP', async () => {
    const { request, calls } = await setup();
    assert.equal((await request(payload, { authorization: null })).status, 401);
    assert.equal(calls.length, 0);
});

const invalidPayloads = [
    ['null body', null], ['array body', []], ['malformed JSON', payload, '{'],
    ['recipient mismatch', { ...payload, to: 'other@example.test' }, undefined, 403],
    ['unsupported cycle', { ...payload, recurrenceCycle: 'weekly' }],
    ['wrong period shape', { ...payload, recurrenceCycle: 'daily' }],
    ['empty expenses', { ...payload, pendingExpenses: [] }],
    ['oversized batch', { ...payload, pendingExpenses: Array(251).fill({ name: 'Rent', cost: 1 }) }],
    ...[null, 'rent', { name: '', cost: 1 }, { name: '\r\n', cost: 1 }, { name: 'Rent', cost: -1 }, { name: 'Rent', cost: 'NaN' }, { name: 'Rent', cost: 1_000_000_001 }]
        .map((item, index) => [`invalid expense ${index}`, { ...payload, pendingExpenses: [item] }])
];
for (const [name, body, raw, status = 400] of invalidPayloads) {
    test(`rejects ${name} before profile lookup or claim`, async () => {
        const { request, calls } = await setup();
        assert.equal((await request(body, { raw })).status, status);
        assert.equal(calls.length, 1);
    });
}

for (const [options, status] of [
    [{ profileStatus: 503 }, 500],
    [{ profiles: [{ email_reminders_enabled: false }] }, 403],
    [{ claimStatus: 503 }, 500],
    [{ claim: { status: 'rate_limited' } }, 429],
    [{ claim: { status: 'in_progress', id: 'queue-a', created_at: new Date().toISOString() } }, 409],
    [{ claim: { status: 'in_progress', id: 'queue-a', created_at: 'invalid' } }, 409],
    [{ claim: { status: 'claimed' } }, 500],
    [{ claim: { status: 'unknown' } }, 500]
]) {
    test(`does not send when preferences or claim block delivery: ${JSON.stringify(options)}`, async () => {
        const { request, calls } = await setup(options);
        assert.equal((await request()).status, status);
        assert.ok(!calls.some(call => call.url.includes('api.resend.com')));
    });
}

for (const options of [
    { profiles: [{ last_reminder_period: '2026-11' }] },
    { claim: { status: 'already_sent' } }
]) {
    test(`confirmed delivery returns alreadySent without contacting provider: ${JSON.stringify(options)}`, async () => {
        const { request, calls } = await setup(options);
        const response = await request();
        assert.equal(response.status, 200);
        const result = JSON.parse(response.text);
        assert.equal(result.alreadySent, true);
        assert.equal(JSON.parse(result.serializedMap).monthly, '2026-11');
        assert.ok(!calls.some(call => call.url.includes('api.resend.com') || call.method === 'PATCH'));
    });
}

for (const [recurrenceCycle, periodKey] of [['daily', '2026-11-19'], ['monthly', '2026-11'], ['yearly', '2026']]) {
    test(`${recurrenceCycle} delivery renders server content and persists queue and merged profile state`, async () => {
        const { request, calls } = await setup();
        const response = await request({ ...payload, recurrenceCycle, periodKey, to: ' MEMBER@EXAMPLE.TEST ', subject: 'forged', html: '<script>forged</script>' });
        assert.equal(response.status, 200);
        const claim = calls.find(call => call.url.endsWith('/rpc/claim_reminder_delivery'));
        assert.equal(claim.headers.Authorization, 'Bearer synthetic-user');
        assert.equal(claim.body.p_max_per_hour, 6);
        assert.equal(claim.body.p_expense_count, 1);
        const sent = calls.find(call => call.url.includes('api.resend.com'));
        assert.deepEqual(sent.body.to, ['member@example.test']);
        assert.equal(sent.headers['Idempotency-Key'], `reminder_user-a_${periodKey}`);
        assert.match(sent.body.subject, /1 .* Recurring Expense for/);
        assert.match(sent.body.text, /\$12\.50/);
        assert.doesNotMatch(sent.body.html, /forged/);
        assert.equal(sent.body.html, claim.body.p_html_body);
        const patches = calls.filter(call => call.method === 'PATCH');
        assert.equal(patches.length, 2);
        assert.deepEqual(patches.find(call => call.url.includes('email_reminder_queue')).body, { status: 'sent' });
        const map = JSON.parse(patches.find(call => call.url.includes('/profiles?')).body.last_reminder_period);
        assert.equal(map.yearly, recurrenceCycle === 'yearly' ? periodKey : '2025');
        assert.equal(map[recurrenceCycle], periodKey);
        assert.deepEqual(JSON.parse(JSON.parse(response.text).serializedMap), map);
    });
}

test('server escapes HTML, strips header controls, and uses profile identity and currency', async () => {
    const { request, calls } = await setup({ profiles: [{ username: '<Admin>\r\n&', currency: 'MAD' }] });
    assert.equal((await request({ ...payload, username: 'forged', pendingExpenses: [
        { name: '<script>"x"</script>\u0000', category: "'&<cat>", cost: '1000.25' },
        { name: 'Free', cost: 0 }
    ] })).status, 200);
    const sent = calls.find(call => call.url.includes('api.resend.com')).body;
    assert.match(sent.html, /&lt;Admin&gt; &amp;/);
    assert.match(sent.html, /&lt;script&gt;&quot;x&quot;&lt;\/script&gt;/);
    assert.match(sent.html, /&#39;&amp;&lt;cat&gt;/);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(sent.html, /<script>|forged|\u0000/);
    assert.match(sent.text, /1,000\.25 MAD/);
    assert.match(sent.subject, /2 Monthly Recurring Expenses/);
});

test('maximum batch and maximum cost are accepted', async () => {
    const { request, calls } = await setup();
    assert.equal((await request({ ...payload, pendingExpenses: Array(250).fill({ name: 'Boundary', cost: 1_000_000_000 }) })).status, 200);
    assert.equal(calls.find(call => call.url.endsWith('/rpc/claim_reminder_delivery')).body.p_expense_count, 250);
});

test('stale processing claim reuses stored content and deterministic provider key', async () => {
    const { request, calls } = await setup({ claim: {
        status: 'in_progress', id: 'queue-a', created_at: '2000-01-01T00:00:00Z',
        subject: 'Original subject', html_body: '<p>Original</p>', text_body: 'Original text'
    } });
    assert.equal((await request()).status, 200);
    const sent = calls.find(call => call.url.includes('api.resend.com'));
    assert.equal(sent.body.subject, 'Original subject');
    assert.equal(sent.body.html, '<p>Original</p>');
    assert.equal(sent.body.text, 'Original text');
    assert.equal(sent.headers['Idempotency-Key'], 'reminder_user-a_2026-11');
});

for (const [name, options, release] of [
    ['explicit rejection', { providerStatus: 422 }, true],
    ['server failure', { providerStatus: 503 }, false],
    ['ambiguous timeout', { providerThrows: true }, false],
    ['missing provider secret', { env: { RESEND_API_KEY: '' } }, true]
]) {
    test(`${name} ${release ? 'releases' : 'preserves'} the processing claim without recording sent`, async () => {
        const { request, calls } = await setup(options);
        assert.equal((await request()).status, name === 'missing provider secret' ? 500 : 502);
        assert.equal(calls.some(call => call.method === 'DELETE'), release);
        if (release) assert.match(calls.find(call => call.method === 'DELETE').url, /status=eq.processing/);
        assert.ok(!calls.some(call => call.method === 'PATCH'));
    });
}

for (const key of ['profilePatchStatus', 'queuePatchStatus']) {
    test(`${key} failure never reports a successful delivery confirmation`, async () => {
        const { request, calls } = await setup({ [key]: 503 });
        assert.equal((await request()).status, 500);
        assert.equal(calls.filter(call => call.url.includes('api.resend.com')).length, 1);
        assert.ok(!calls.some(call => call.method === 'DELETE'));
    });
}
