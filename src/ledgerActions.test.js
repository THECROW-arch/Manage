import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'espree';

// These handlers close over component state. Use ESLint's JSX parser to run the
// exact function bodies with explicit state boundaries, without copying logic or
// mounting the entire application. This does not exercise React rendering or SQL.
async function loadHandler(path, name) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true }, range: true });
    let expression;
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'VariableDeclarator' && node.id.name === name) expression = node.init;
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    }
    visit(tree);
    assert.ok(expression, `${name} must exist in ${path}`);
    return context => runInNewContext(`(${source.slice(...expression.range)})`, context);
}
const closeHandler = await loadHandler('./App.jsx', 'handleCloseMonth');
const wipeHandler = await loadHandler('./components/SettingsTab.jsx', 'handleWipeData');
const plain = value => JSON.parse(JSON.stringify(value));

function closeFixture(overrides = {}) {
    const state = { expenses: [], closedMonths: [], assetAdjustments: [] };
    const calls = [];
    const context = {
        session: { user: { id: 'user-a' } }, selectedMonth: '2026-12', closedMonths: [],
        activeMonthlyExpenses: [], monthlyExpenses: [], expenses: [], categories: [], assetCategories: [],
        expenseMetaMap: {}, parsedSalary: 1000, currentStreak: 2, longestStreak: 4, currentWipeEpoch: 7,
        getToday: () => '2027-01-19', t: key => key,
        window: { __activeUserId: 'user-a', scrollTo() {} },
        fetchUserData: (...args) => calls.push({ reload: args }),
        updateExpenseMeta: (...args) => calls.push({ meta: args }),
        supabase: {
            rpc: async (name, body) => {
                calls.push({ name, body });
                return { data: { inserted_batched: [], inserted_recurring: [], inserted_adjustments: [], closed_month: { month: '2026-12' } } };
            },
            from: () => { throw new Error('Unexpected reconciliation'); }
        },
        ...overrides
    };
    for (const key of ['expenses', 'closedMonths', 'assetAdjustments', 'currentStreak', 'longestStreak', 'selectedMonth', 'alertMsg']) {
        context[`set${key[0].toUpperCase()}${key.slice(1)}`] = update => {
            state[key] = typeof update === 'function' ? update(state[key]) : update;
        };
    }
    return { context, state, calls, close: closeHandler(context) };
}

test('month closure blocks signed-out, already-closed, and unsaved batched ledgers', async () => {
    for (const overrides of [
        { session: null }, { closedMonths: [{ month: '2026-12' }] },
        { activeMonthlyExpenses: [{ is_batched: true, _isOptimistic: true }] }
    ]) {
        const fixture = closeFixture(overrides);
        await fixture.close();
        assert.equal(fixture.calls.length, 0);
        assert.equal(fixture.state.closedMonths.length, 0);
    }
});

test('month close forwards recurrence and future skips across December with snapshot and epoch', async () => {
    const expenses = ['daily', 'monthly', 'yearly', 'invalid'].map((recurrence_type, index) => ({
        id: String(index), name: recurrence_type, cost: '10.125', category_id: 'food',
        expense_date: '2026-12-01', is_recurring: true, recurrence_type,
        skipped_periods: ['2026-12', '2027-01', '2027-01', '2027', '2026']
    }));
    const fixture = closeFixture({ monthlyExpenses: expenses });
    await fixture.close();
    const rpc = fixture.calls.find(call => call.name);
    assert.equal(rpc.name, 'close_month');
    assert.equal(rpc.body.p_wipe_epoch, 7);
    assert.equal(rpc.body.p_month, '2026-12');
    assert.deepEqual(plain(rpc.body.p_recurring_inserts.map(row => row.expense_date)), ['2027-01-19', '2027-01-01', '2027-12-01', '2027-01-01']);
    assert.equal(rpc.body.p_recurring_inserts[3].recurrence_type, 'monthly');
    assert.deepEqual(plain(rpc.body.p_recurring_inserts[0].skipped_periods), ['2027-01', '2027']);
    assert.equal(rpc.body.p_expected_expenses[0].cost, 10.13);
    assert.equal(fixture.state.selectedMonth, '2027-01');
    assert.equal(fixture.state.currentStreak, 3);
    assert.equal(fixture.state.longestStreak, 4);
});

test('daily forwarding uses first of next month when today lies outside that month', async () => {
    const fixture = closeFixture({
        getToday: () => '2026-12-31',
        monthlyExpenses: [{ id: 'daily', name: 'Daily', cost: 1, is_recurring: true, recurrence_type: 'daily' }]
    });
    await fixture.close();
    assert.equal(fixture.calls[0].body.p_recurring_inserts[0].expense_date, '2027-01-01');
});

test('month close groups batches by normalized name and category and never sweeps negative balances', async () => {
    const categories = [{ id: 'asset', percentage: 20, type: 'asset' }, { id: 'food', percentage: 80, type: 'expense' }];
    const activeMonthlyExpenses = [
        { id: 'a', name: ' Lunch ', cost: '5', category_id: 'food', is_batched: true },
        { id: 'b', name: 'lunch', cost: '7', category_id: 'food', is_batched: true },
        { id: 'c', name: 'Lunch', cost: '300', category_id: 'asset', is_batched: true }
    ];
    const fixture = closeFixture({ categories, assetCategories: [categories[0]], activeMonthlyExpenses });
    await fixture.close();
    const body = fixture.calls[0].body;
    assert.deepEqual(plain(body.p_batched_delete_ids), ['a', 'b', 'c']);
    assert.equal(body.p_batched_inserts.length, 2);
    assert.equal(body.p_batched_inserts[0].name, 'Lunch (Batched x2)');
    assert.equal(body.p_batched_inserts[0].cost, 12);
    assert.equal(body.p_sweep_adjustments.length, 0);
});

test('month close sweeps remaining asset allocation and resets an overspent streak', async () => {
    const categories = [{ id: 'asset', percentage: 20, type: 'asset' }, { id: 'food', percentage: 80, type: 'expense' }];
    const fixture = closeFixture({ categories, assetCategories: [categories[0]], activeMonthlyExpenses: [
        { category_id: 'asset', cost: 50 }, { category_id: 'food', cost: 801 }
    ] });
    await fixture.close();
    assert.equal(fixture.calls[0].body.p_sweep_adjustments[0].amount, 150);
    assert.equal(fixture.calls[0].body.p_sweep_adjustments[0].adjustment_date, '2027-01-01');
    assert.equal(fixture.state.currentStreak, 0);
    assert.equal(fixture.state.longestStreak, 4);
});

test('account switch during close prevents applying returned rows or alerts to another user', async () => {
    const fixture = closeFixture();
    fixture.context.supabase.rpc = async () => {
        fixture.context.window.__activeUserId = 'user-b';
        return { data: { closed_month: { month: '2026-12' } } };
    };
    await fixture.close();
    assert.equal(fixture.state.closedMonths.length, 0);
    assert.equal(fixture.state.alertMsg, undefined);
});

for (const [check, expected] of [
    [{ data: null }, 'err_close_month_stale'],
    [{ error: { message: 'offline' } }, 'err_close_month_unverified']
]) {
    test(`ambiguous close refreshes ledger and reports ${expected}`, async () => {
        const fixture = closeFixture();
        fixture.context.supabase.rpc = async () => ({ error: { code: '40001' } });
        fixture.context.supabase.from = () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => check });
        await fixture.close();
        assert.equal(fixture.state.alertMsg, expected);
        assert.equal(fixture.calls.filter(call => call.reload).length, 1);
        assert.equal(fixture.state.closedMonths.length, 0);
    });
}

function wipeFixture({ confirm = true, rpcError = null, rows = [], lookupError = null, switchAccount = false } = {}) {
    const removed = [];
    const alerts = [];
    const calls = [];
    const context = {
        userId: 'user-a', activeAccountRef: { current: 'user-a' }, isMountedRef: { current: true },
        t: key => key, console: { error() {} }, alert: value => alerts.push(value),
        localStorage: { removeItem: key => removed.push(key) },
        setIsProcessingDanger: value => calls.push({ processing: value }),
        window: { __activeUserId: 'user-a', confirm: () => confirm, location: { reload: () => calls.push({ reload: true }) } },
        supabase: {
            auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' } } } }) },
            rpc: async name => {
                calls.push({ name });
                if (switchAccount) context.window.__activeUserId = 'user-b';
                return { error: rpcError };
            },
            from: table => ({ select() { return this; }, eq() { return this; }, limit: async () => {
                calls.push({ table });
                return { data: rows, error: lookupError };
            } })
        }
    };
    return { wipe: wipeHandler(context), calls, removed, alerts };
}

test('wipe cancellation performs no work', async () => {
    const fixture = wipeFixture({ confirm: false });
    await fixture.wipe();
    assert.equal(fixture.calls.length, 0);
});

test('successful atomic wipe clears only the originating account settings and reloads', async () => {
    const fixture = wipeFixture();
    await fixture.wipe();
    assert.equal(fixture.calls.find(call => call.name).name, 'wipe_user_financial_data');
    assert.equal(fixture.removed.length, 9);
    assert.ok(fixture.removed.every(key => key.includes('user-a')));
    assert.ok(fixture.removed.includes('managed_last_reminder_user-a_yearly'));
    assert.equal(fixture.alerts[0], 'succ_data_wiped');
    assert.equal(fixture.calls.filter(call => call.reload).length, 1);
});

for (const [name, options, success] of [
    ['all tables verified empty', {}, true],
    ['remaining financial rows', { rows: [{ id: 'remaining' }] }, false],
    ['unverified lookup', { lookupError: { message: 'offline' } }, false]
]) {
    test(`ambiguous wipe with ${name} ${success ? 'finalizes' : 'preserves'} local settings`, async () => {
        const fixture = wipeFixture({ rpcError: { message: 'network' }, ...options });
        await fixture.wipe();
        assert.equal(fixture.calls.filter(call => call.table).length, 5);
        assert.equal(fixture.removed.length, success ? 9 : 0);
        assert.equal(fixture.calls.some(call => call.reload), success);
    });
}

test('account switch during wipe suppresses storage cleanup, reload, and alerts', async () => {
    const fixture = wipeFixture({ switchAccount: true });
    await fixture.wipe();
    assert.equal(fixture.removed.length, 0);
    assert.equal(fixture.alerts.length, 0);
    assert.ok(!fixture.calls.some(call => call.reload));
});
