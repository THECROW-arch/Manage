import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const source = await readFile(new URL('./emailReminderService.js', import.meta.url), 'utf8');
const params = {
    userId: 'user-a', recipientEmail: 'member@example.test', username: 'Member',
    periodKey: '2026-11', pendingExpenses: [{ name: 'Rent', cost: '12.50' }]
};

async function setup({ profile = { data: null }, queue = { data: [] }, invoke, storageThrows = false } = {}) {
    const calls = [];
    const stored = new Map();
    const context = createContext({
        console: { warn() {} },
        localStorage: { setItem(key, value) {
            if (storageThrows) throw new Error('quota');
            stored.set(key, value);
        } }
    });
    const supabase = {
        from(table) {
            calls.push({ table });
            const result = table === 'profiles' ? profile : queue;
            const query = {
                select() { return this; }, eq() { return this; },
                maybeSingle: async () => result, limit: async () => result
            };
            return query;
        },
        functions: { async invoke(name, options) {
            calls.push({ name, ...options });
            return invoke ? invoke(options) : { data: { ok: true } };
        } }
    };
    const dependency = new SyntheticModule(['supabase'], function () {
        this.setExport('supabase', supabase);
    }, { context });
    const module = new SourceTextModule(source, { context });
    await module.link((specifier) => {
        assert.equal(specifier, '../supabaseClient');
        return dependency;
    });
    await module.evaluate();
    return { send: module.namespace.sendRecurringExpenseReminderEmail, calls, stored };
}

test('missing identity and empty batches never query or dispatch', async () => {
    const { send, calls } = await setup();
    for (const override of [{ userId: null }, { recipientEmail: '' }, { pendingExpenses: [] }, { pendingExpenses: null }]) {
        assert.equal((await send({ ...params, ...override })).ok, false);
    }
    assert.equal(calls.length, 0);
});

test('dispatch sends bounded structured fields and caches the server confirmation map', async () => {
    const serializedMap = JSON.stringify({ daily: '2026-11-19', monthly: '2026-11' });
    const { send, calls, stored } = await setup({ invoke: async () => ({ data: { ok: true, serializedMap } }) });
    const result = await send({ ...params, pendingExpenses: [{ name: `  ${'x'.repeat(130)}  `, cost: '12.50', category: 'y'.repeat(70), html: '<script>' }] });
    assert.equal(result.status, 'sent');
    const dispatch = calls.find(call => call.name);
    assert.equal(dispatch.name, 'send-recurring-reminder');
    assert.deepEqual(JSON.parse(JSON.stringify(dispatch.body)), {
        to: params.recipientEmail, username: 'Member', periodKey: '2026-11', recurrenceCycle: 'monthly',
        pendingExpenses: [{ name: 'x'.repeat(120), cost: 12.5, category: 'y'.repeat(60), recurrenceType: 'monthly' }]
    });
    assert.equal(stored.get('managed_last_reminder_user-a'), serializedMap);
    assert.equal(stored.get('managed_last_reminder_user-a_monthly'), '2026-11');
});

for (const count of [250, 251]) {
    test(`batch size ${count} ${count === 250 ? 'is accepted' : 'is rejected without dispatch'}`, async () => {
        const { send, calls } = await setup();
        const result = await send({ ...params, onlyIfNotSent: false, pendingExpenses: Array.from({ length: count }, () => params.pendingExpenses[0]) });
        assert.equal(result.status, count === 250 ? 'sent' : 'batch_too_large');
        assert.equal(calls.filter(call => call.name).length, count === 250 ? 1 : 0);
        if (count > 250) assert.equal(result.retryable, false);
    });
}

for (const confirmedBy of ['profile', 'queue']) {
    test(`${confirmedBy} confirmation prevents duplicate delivery even when the other lookup fails`, async () => {
        const { send, calls } = await setup({
            profile: confirmedBy === 'profile' ? { data: { last_reminder_period: '2026-11' } } : { error: { message: 'offline' } },
            queue: confirmedBy === 'queue' ? { data: [{ id: 'sent' }] } : { error: { message: 'offline' } }
        });
        const result = await send(params);
        assert.equal(result.status, 'already_sent');
        assert.equal(JSON.parse(result.serializedMap).monthly, '2026-11');
        assert.equal(calls.filter(call => call.name).length, 0);
    });
}

for (const table of ['profile', 'queue']) {
    test(`unverified ${table} lookup fails closed`, async () => {
        const { send, calls, stored } = await setup({ [table]: { error: { message: 'offline' } } });
        const result = await send(params);
        assert.equal(result.status, 'verification_failed');
        assert.equal(result.retryable, true);
        assert.equal(stored.size, 0);
        assert.equal(calls.filter(call => call.name).length, 0);
    });
}

for (const response of [{ error: { message: 'offline' } }, { data: { ok: false, error: 'denied' } }, { data: null }]) {
    test(`dispatch failure does not cache delivery: ${JSON.stringify(response)}`, async () => {
        const { send, stored } = await setup({ invoke: async () => response });
        const result = await send(params);
        assert.equal(result.status, 'failed');
        assert.equal(result.retryable, true);
        assert.equal(stored.size, 0);
    });
}

test('server already-sent response and storage quota failure still succeed', async () => {
    const { send } = await setup({ storageThrows: true, invoke: async () => ({ data: { ok: true, alreadySent: true } }) });
    const result = await send(params);
    assert.equal(result.status, 'already_sent');
    assert.equal(result.alreadySent, true);
    assert.deepEqual(JSON.parse(result.serializedMap), { monthly: '2026-11' });
});

test('concurrent dispatches share one request, with independent users and released locks after rejection', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const { send, calls } = await setup({ invoke: () => pending });
    const first = send({ ...params, onlyIfNotSent: false });
    const duplicate = send({ ...params, onlyIfNotSent: false });
    const otherUser = send({ ...params, userId: 'user-b', onlyIfNotSent: false });
    assert.equal(calls.length, 2);
    release({ data: { ok: true } });
    const results = await Promise.all([first, duplicate, otherUser]);
    assert.deepEqual(results[0], results[1]);
    await send({ ...params, onlyIfNotSent: false });
    assert.equal(calls.length, 3);

    let attempts = 0;
    const failing = await setup({ invoke: async () => {
        if (++attempts === 1) throw new Error('network');
        return { data: { ok: true } };
    } });
    await assert.rejects(failing.send(params), /network/);
    assert.equal((await failing.send(params)).status, 'sent');
});
