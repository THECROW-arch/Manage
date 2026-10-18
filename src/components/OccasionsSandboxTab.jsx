/**
 * Manages Special Occasion bundles and temporary hypothetical budget calculations.
 */
export default function OccasionsSandboxTab({
    handleDeleteSandboxSheet,
    selectedMonth,
    plannerSubTab,
    setPlannerSubTab,
    bundleName,
    setBundleName,
    categories,
    getCategoryAvailablePool,
    bundleAllocations,
    setBundleAllocations,
    handleCreateBundle,
    bundles,
    occasionItemInputs,
    setOccasionItemInputs,
    handleAddOccasionItem,
    handleDeleteOccasionItem,
    handleLockAndFinalizeBundle,
    isReadOnly,
    handleDeleteBundle,
    handleCreateSandboxSheet,
    newSheetTitle,
    setNewSheetTitle,
    newSheetBudget,
    setNewSheetBudget,
    sandboxSheets,
    setSandboxSheets,
    activeSheetId,
    setActiveSheetId,
    activeSheet,
    handleExportSandboxCSV,
    handleAddSubBucket,
    subBucketName,
    setSubBucketName,
    subBucketLimit,
    setSubBucketLimit,
    handleAddSandboxExpense,
    sandboxExpName,
    setSandboxExpName,
    sandboxExpCost,
    setSandboxExpCost,
    sandboxExpBucketId,
    setSandboxExpBucketId,
    setAlertMsg,
    formatCurrencyFn
}) {
    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-zinc-800 pb-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Occasions & Sandbox Planner</h2>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
                        Bundle one-time exceptional events or run temporary what-if calculations without touching your real ledger.
                    </p>
                </div>
                <div className="flex bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg border border-gray-200 dark:border-zinc-800">
                    <button
                        onClick={() => setPlannerSubTab('occasions')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${plannerSubTab === 'occasions' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 dark:text-zinc-400'}`}
                    >
                        ✨ Special Occasions
                    </button>
                    <button
                        onClick={() => setPlannerSubTab('sandbox')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${plannerSubTab === 'sandbox' ? 'bg-indigo-600 text-white shadow' : 'text-gray-500 dark:text-zinc-400'}`}
                    >
                        🧮 Temporary Calculations
                    </button>
                </div>
            </div>

            {plannerSubTab === 'occasions' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    <div className="lg:col-span-5 bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                            <span>✨</span> 1. Create Special Occasion ({selectedMonth})
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-zinc-400">
                            Choose which categories will fund this event. Once you finish logging the event's expenses and lock it, the bundle joins your main Transactions list.
                        </p>

                        <input
                            type="text"
                            value={bundleName}
                            onChange={(e) => setBundleName(e.target.value)}
                            placeholder="Occasion Name (e.g. 3id l adha, Marrakech Trip)"
                            className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                        />

                        <div className="flex gap-2">
                            <select
                                id="temp-bundle-cat"
                                className="flex-1 px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs"
                            >
                                {categories.map(c => {
                                    const avail = getCategoryAvailablePool(c.id) - (bundleAllocations[c.id] || 0);
                                    return (
                                        <option key={c.id} value={c.id}>
                                            {c.name} ({c.type === 'asset' ? 'Lifetime Vault: ' : 'Avail: '}{formatCurrencyFn(Math.max(0, avail))})
                                        </option>
                                    );
                                })}
                            </select>
                            <input
                                type="number"
                                id="temp-bundle-amt"
                                placeholder="Pull Amount"
                                className="w-1/3 px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    const catEl = document.getElementById('temp-bundle-cat');
                                    const amtEl = document.getElementById('temp-bundle-amt');
                                    const val = parseFloat(amtEl.value);
                                    if (catEl.value && val > 0) {
                                        const currentStaged = bundleAllocations[catEl.value] || 0;
                                        const maxAvail = getCategoryAvailablePool(catEl.value);
                                        const catObj = categories.find(c => c.id === catEl.value);
                                        if (currentStaged + val > maxAvail) {
                                            setAlertMsg(`Cannot pull ${formatCurrencyFn(currentStaged + val)} from ${catObj?.name}. Only ${formatCurrencyFn(maxAvail)} available.`);
                                            return;
                                        }
                                        setBundleAllocations(prev => ({ ...prev, [catEl.value]: currentStaged + val }));
                                        amtEl.value = '';
                                    }
                                }}
                                className="px-4 py-2 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/60 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-md font-bold text-sm"
                            >
                                +
                            </button>
                        </div>

                        {Object.entries(bundleAllocations).length > 0 && (
                            <div className="space-y-1.5 p-3 bg-gray-50 dark:bg-zinc-950 rounded-md border border-gray-200 dark:border-zinc-800">
                                <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Funding Categories:</p>
                                {Object.entries(bundleAllocations).map(([cId, amt]) => (
                                    <div key={cId} className="flex justify-between text-xs font-medium text-gray-700 dark:text-zinc-300">
                                        <span>{categories.find(c => c.id === cId)?.name}</span>
                                        <span>{formatCurrencyFn(amt)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={handleCreateBundle}
                            className="w-full py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold shadow-md transition-all"
                        >
                            Create Occasion Bundle
                        </button>
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                        {bundles.filter(b => b.month === selectedMonth).length === 0 ? (
                            <div className="bg-white dark:bg-zinc-900 p-10 rounded-lg border border-dashed border-gray-300 dark:border-zinc-800 text-center">
                                <p className="text-gray-400 dark:text-zinc-500 text-sm">No Special Occasions created for {selectedMonth} yet.</p>
                            </div>
                        ) : (
                            bundles.filter(b => b.month === selectedMonth).map(bundle => {
                                const items = Array.isArray(bundle.items) ? bundle.items : [];
                                const totalSpent = items.reduce((sum, i) => sum + parseFloat(i.cost), 0);
                                const totalBudget = Object.values(bundle.target_budget || {}).reduce((sum, amt) => sum + parseFloat(amt), 0);
                                const percentUsed = totalBudget > 0 ? Math.min(100, (totalSpent / totalBudget) * 100) : 0;
                                const isLocked = bundle.status === 'locked';
                                const itemInput = occasionItemInputs[bundle.id] || { name: '', cost: '' };

                                return (
                                    <div key={bundle.id} className={`w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border-2 shadow-sm ${isLocked ? 'border-emerald-500/40' : 'border-indigo-500/60'}`}>
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-base font-bold text-gray-900 dark:text-white">✨ {bundle.name}</h3>
                                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${isLocked ? 'bg-emerald-500/20 text-emerald-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
                                                        {isLocked ? '🔒 Locked in Transactions' : 'Open Bundle'}
                                                    </span>
                                                </div>
                                                <div className="flex flex-wrap gap-2 mt-1.5">
                                                    {Object.entries(bundle.target_budget || {}).map(([cId, amt]) => (
                                                        <span key={cId} className="text-[10px] bg-gray-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-gray-600 dark:text-zinc-400">
                                                            Pulling {formatCurrencyFn(amt)} from {categories.find(c => c.id === cId)?.name || 'Category'}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteBundle(bundle.id)}
                                                className="text-xs text-gray-400 hover:text-rose-500"
                                                title="Delete Occasion"
                                            >
                                                ✕
                                            </button>
                                        </div>

                                        <div className="flex justify-between items-end mb-2">
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-2xl font-bold text-gray-900 dark:text-zinc-100">{formatCurrencyFn(Math.max(0, totalBudget - totalSpent))}</span>
                                                <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">remaining of {formatCurrencyFn(totalBudget)}</span>
                                            </div>
                                            <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500">{formatCurrencyFn(totalSpent)} spent</span>
                                        </div>

                                        <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-2 mb-4 overflow-hidden border border-gray-200 dark:border-zinc-800">
                                            <div
                                                className={`h-2 rounded-full transition-all duration-500 ${isLocked ? 'bg-emerald-500' : percentUsed > 90 ? 'bg-rose-500' : 'bg-indigo-500'}`}
                                                style={{ width: `${percentUsed}%` }}
                                            ></div>
                                        </div>

                                        {!isLocked && !isReadOnly && (
                                            <div className="flex flex-col gap-2 mb-4 p-3 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20 rounded-md">
                                                <input
                                                    type="text"
                                                    placeholder="Item Name (e.g. Rope length)"
                                                    value={itemInput.name || ''}
                                                    onChange={(e) => setOccasionItemInputs({ ...occasionItemInputs, [bundle.id]: { ...itemInput, name: e.target.value } })}
                                                    className="w-full px-3 py-2 rounded-md bg-white dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none"
                                                />
                                                <div className="flex flex-wrap gap-2 items-end">
                                                    {Object.keys(bundle.target_budget || {}).map(cId => {
                                                        const catName = categories.find(c => c.id === cId)?.name || 'Category';
                                                        const catCeiling = parseFloat(bundle.target_budget[cId]) || 0;
                                                        const catSpent = items.reduce((s, i) => s + (parseFloat(i.allocations?.[cId]) || 0), 0);
                                                        const catLeft = Math.max(0, catCeiling - catSpent);

                                                        return (
                                                            <div key={cId} className="flex-1 min-w-[100px]">
                                                                <label className="text-[10px] uppercase text-gray-500 font-bold ml-1 flex justify-between">
                                                                    <span>From {catName}</span>
                                                                    <span className="text-indigo-400 dark:text-indigo-500">{formatCurrencyFn(catLeft)} left</span>
                                                                </label>
                                                                <input
                                                                    type="number"
                                                                    placeholder="0.00"
                                                                    value={itemInput.allocations?.[cId] || ''}
                                                                    onChange={(e) => setOccasionItemInputs({
                                                                        ...occasionItemInputs,
                                                                        [bundle.id]: {
                                                                            ...itemInput,
                                                                            allocations: { ...itemInput.allocations, [cId]: e.target.value }
                                                                        }
                                                                    })}
                                                                    className="w-full px-3 py-2 rounded-md bg-white dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none"
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAddOccasionItem(bundle.id)}
                                                        className="px-4 py-2 h-[34px] bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold"
                                                    >
                                                        Add Item
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {items.length > 0 && (
                                            <ul className="space-y-1.5 mb-4 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                                {items.map(item => (
                                                    <li key={item.id} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 text-xs px-3 py-2 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-100 dark:border-zinc-800">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-semibold text-gray-800 dark:text-zinc-200">{item.name}</span>
                                                            {item.allocations && Object.entries(item.allocations).map(([cId, amt]) => (
                                                                <span key={cId} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200/70 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 font-medium">
                                                                    {categories.find(c => c.id === cId)?.name || 'Category'}: {formatCurrencyFn(amt)}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="flex items-center gap-3 self-end sm:self-auto">
                                                            <span className="font-mono font-bold text-gray-700 dark:text-zinc-300">{formatCurrencyFn(item.cost)}</span>
                                                            {!isLocked && !isReadOnly && (
                                                                <button onClick={() => handleDeleteOccasionItem(bundle.id, item.id)} className="text-gray-400 hover:text-rose-500">✕</button>
                                                            )}
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}

                                        {!isLocked && !isReadOnly && (
                                            <button
                                                onClick={() => handleLockAndFinalizeBundle(bundle)}
                                                className="w-full py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow transition-all"
                                            >
                                                🔒 Done — Lock Bundle & Send to Transactions
                                            </button>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                    <div className="lg:col-span-4 space-y-6">
                        <form onSubmit={handleCreateSandboxSheet} className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 space-y-4">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">New Calculation Sheet</h3>
                            <input
                                type="text"
                                placeholder="Calculation Title (e.g. Summer Europe Plan)"
                                value={newSheetTitle}
                                onChange={(e) => setNewSheetTitle(e.target.value)}
                                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm"
                                required
                            />
                            <input
                                type="number"
                                placeholder="Total Hypothetical Budget (e.g. 7000)"
                                value={newSheetBudget}
                                onChange={(e) => setNewSheetBudget(e.target.value)}
                                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm"
                                required
                            />
                            <button type="submit" className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-bold">
                                Create Calculation Page
                            </button>
                        </form>

                        {sandboxSheets.length > 0 && (
                            <div className="bg-white dark:bg-zinc-900 p-4 rounded-lg border border-gray-200 dark:border-zinc-800 space-y-2">
                                <p className="text-xs font-bold uppercase text-gray-400 mb-2">Saved Calculation Pages</p>
                                {sandboxSheets.map(s => (
                                    <div
                                        key={s.id}
                                        className={`rounded-md flex justify-between items-center border transition-all ${activeSheet?.id === s.id ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'bg-gray-50 dark:bg-zinc-950 border-gray-200 dark:border-zinc-800'}`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setActiveSheetId(s.id)}
                                            className="flex-1 min-w-0 p-3 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500"
                                        >
                                            <span className="block text-sm font-bold">{s.title}</span>
                                            <span className="block text-xs text-gray-500">{formatCurrencyFn(s.totalBudget)} budget</span>
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Delete ${s.title}`}
                                            onClick={() => handleDeleteSandboxSheet(s.id)}
                                            className="text-xs text-gray-400 hover:text-rose-500 px-2 mr-3"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-8">
                        {!activeSheet ? (
                            <div className="bg-white dark:bg-zinc-900 p-12 rounded-lg border border-dashed border-gray-300 dark:border-zinc-800 text-center">
                                <p className="text-gray-400 dark:text-zinc-500 text-sm">Create a Calculation Sheet on the left to start dividing budgets and testing expenses.</p>
                            </div>
                        ) : (
                            <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 space-y-6">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-zinc-800 pb-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{activeSheet.title}</h3>
                                        <p className="text-xs text-gray-500">
                                            Total Budget: <strong>{formatCurrencyFn(activeSheet.totalBudget)}</strong> •
                                            Total Imaginary Spent: <strong>{formatCurrencyFn(activeSheet.expenses.reduce((s, e) => s + e.cost, 0))}</strong> •
                                            Remaining: <strong className="text-emerald-500">{formatCurrencyFn(activeSheet.totalBudget - activeSheet.expenses.reduce((s, e) => s + e.cost, 0))}</strong>
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleExportSandboxCSV(activeSheet)}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold shadow"
                                    >
                                        Export Calculation CSV
                                    </button>
                                </div>

                                <div className="p-4 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-3">
                                    <p className="text-xs font-bold uppercase text-gray-400">Optional: Divide Budget into Sub-Buckets (e.g. 3000 Rent/Food, 1500 Snacks)</p>
                                    <form onSubmit={handleAddSubBucket} className="flex flex-col sm:flex-row gap-2">
                                        <input
                                            type="text"
                                            placeholder="Sub-Bucket Name (e.g. Rent, Food & Supplies)"
                                            value={subBucketName}
                                            onChange={(e) => setSubBucketName(e.target.value)}
                                            className="flex-1 px-3 py-2 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-800 text-xs"
                                        />
                                        <input
                                            type="number"
                                            placeholder="Allocated Amount (e.g. 3000)"
                                            value={subBucketLimit}
                                            onChange={(e) => setSubBucketLimit(e.target.value)}
                                            className="sm:w-44 px-3 py-2 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-800 text-xs"
                                        />
                                        <button type="submit" className="px-4 py-2 bg-gray-800 dark:bg-zinc-800 text-white rounded text-xs font-bold">
                                            + Add Part
                                        </button>
                                    </form>

                                    {activeSheet.buckets.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                                            {activeSheet.buckets.map(b => {
                                                const bSpent = activeSheet.expenses.filter(e => e.bucketId === b.id).reduce((s, e) => s + e.cost, 0);
                                                return (
                                                    <div key={b.id} className="p-3 rounded bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800">
                                                        <div className="flex justify-between text-xs font-bold mb-1">
                                                            <span>{b.name}</span>
                                                            <span>{formatCurrencyFn(b.limit - bSpent)} left of {formatCurrencyFn(b.limit)}</span>
                                                        </div>
                                                        <div className="w-full bg-gray-100 dark:bg-zinc-950 h-1.5 rounded-full overflow-hidden">
                                                            <div className="bg-indigo-500 h-1.5" style={{ width: `${Math.min(100, (bSpent / b.limit) * 100)}%` }}></div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <form onSubmit={handleAddSandboxExpense} className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="text"
                                        placeholder="Hypothetical Expense (e.g. Movie Tickets)"
                                        value={sandboxExpName}
                                        onChange={(e) => setSandboxExpName(e.target.value)}
                                        className="flex-1 px-3 py-2 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs"
                                        required
                                    />
                                    <input
                                        type="number"
                                        step="0.01"
                                        placeholder="Cost"
                                        value={sandboxExpCost}
                                        onChange={(e) => setSandboxExpCost(e.target.value)}
                                        className="sm:w-32 px-3 py-2 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs"
                                        required
                                    />
                                    <select
                                        value={sandboxExpBucketId}
                                        onChange={(e) => setSandboxExpBucketId(e.target.value)}
                                        className="sm:w-48 px-3 py-2 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs"
                                    >
                                        <option value="MAIN">General Budget Pool</option>
                                        {activeSheet.buckets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                    </select>
                                    <button type="submit" className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold">
                                        Add Item
                                    </button>
                                </form>

                                {activeSheet.expenses.length > 0 && (
                                    <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                                        {activeSheet.expenses.map(exp => {
                                            const bName = exp.bucketId === 'MAIN' ? 'General Pool' : (activeSheet.buckets.find(b => b.id === exp.bucketId)?.name || 'General Pool');
                                            return (
                                                <li key={exp.id} className="flex justify-between items-center p-2.5 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-100 dark:border-zinc-800 text-xs">
                                                    <div>
                                                        <span className="font-bold text-gray-800 dark:text-zinc-200">{exp.name}</span>
                                                        <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-gray-200 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400">{bName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="font-mono font-bold">{formatCurrencyFn(exp.cost)}</span>
                                                        <button
                                                            onClick={() => {
                                                                if (isReadOnly) {
                                                                    setAlertMsg("Cannot edit sandbox items while the budget month is locked.");
                                                                    return;
                                                                }
                                                                const updated = { ...activeSheet, expenses: activeSheet.expenses.filter(x => x.id !== exp.id) };
                                                                setSandboxSheets(sandboxSheets.map(s => s.id === activeSheet.id ? updated : s));
                                                            }}
                                                            className="text-gray-400 hover:text-rose-500"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
