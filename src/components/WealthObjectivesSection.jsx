import { useState } from 'react';

/**
 * Renders the Wealth Objectives manager inside the Portfolio tab.
 * Supports multi-category automated monthly pulls plus manual contributions from any category.
 */
export default function WealthObjectivesSection({
    wealthObjectives = [],
    setWealthObjectives,
    categories = [],
    parsedSalary = 0,
    formatCurrency,
    getCategoryAvailablePool,
    onManualContributeToObjective
}) {
    const [objName, setObjName] = useState('');
    const [objTarget, setObjTarget] = useState('');
    const [autoPulls, setAutoPulls] = useState({});
    const [tempAutoCatId, setTempAutoCatId] = useState('');
    const [tempAutoAmount, setTempAutoAmount] = useState('');

    // Manual top-up inputs keyed by objective ID
    const [manualInputs, setManualInputs] = useState({});
    const [statusMsg, setStatusMsg] = useState('');

    const handleAddAutoPullRule = () => {
        const catId = tempAutoCatId || categories[0]?.id;
        const amt = parseFloat(tempAutoAmount);
        if (!catId || isNaN(amt) || amt <= 0) return;
        setAutoPulls(prev => ({
            ...prev,
            [catId]: Number(((prev[catId] || 0) + amt).toFixed(2))
        }));
        setTempAutoAmount('');
    };

    const handleCreateObjective = (e) => {
        e.preventDefault();
        const targetNum = parseFloat(objTarget);
        if (!objName.trim() || isNaN(targetNum) || targetNum <= 0) return;

        const finalAutoPulls = { ...autoPulls };
        if (tempAutoCatId && parseFloat(tempAutoAmount) > 0) {
            finalAutoPulls[tempAutoCatId] = (finalAutoPulls[tempAutoCatId] || 0) + parseFloat(tempAutoAmount);
        }

        const newObjective = {
            id: crypto.randomUUID(),
            name: objName.trim(),
            targetAmount: targetNum,
            manualSaved: 0,
            autoPulls: finalAutoPulls,
            history: [],
            createdAt: new Date().toISOString().slice(0, 10)
        };

        setWealthObjectives(prev => [newObjective, ...prev]);
        setObjName('');
        setObjTarget('');
        setAutoPulls({});
        setTempAutoAmount('');
        setStatusMsg(`Created objective "${newObjective.name}" (${formatCurrency(targetNum)}).`);
    };

    const handleManualDeposit = async (obj) => {
        const input = manualInputs[obj.id] || {};
        const catId = input.catId || categories[0]?.id;
        const amt = parseFloat(input.amount);
        if (!catId || isNaN(amt) || amt <= 0) return;

        const catObj = categories.find(c => c.id === catId);
        if (!catObj) return;

        if (getCategoryAvailablePool) {
            const avail = getCategoryAvailablePool(catId);
            if (amt > avail) {
                setStatusMsg(`Cannot pull ${formatCurrency(amt)} from ${catObj.name} (only ${formatCurrency(avail)} available).`);
                return;
            }
        }

        if (onManualContributeToObjective) {
            const ok = await onManualContributeToObjective({
                objectiveName: obj.name,
                categoryId: catId,
                amount: amt
            });
            if (!ok) return;
        }

        const stamp = new Date().toISOString().slice(0, 10);
        setWealthObjectives(prev =>
            prev.map(item =>
                item.id === obj.id
                    ? {
                          ...item,
                          manualSaved: Number(((item.manualSaved || 0) + amt).toFixed(2)),
                          history: [
                              { id: crypto.randomUUID(), date: stamp, categoryName: catObj.name, amount: amt, type: 'manual' },
                              ...(item.history || [])
                          ]
                      }
                    : item
            )
        );

        setManualInputs(prev => ({ ...prev, [obj.id]: { ...input, amount: '' } }));
        setStatusMsg(`Added ${formatCurrency(amt)} from ${catObj.name} to "${obj.name}"!`);
    };

    const handleDeleteObjective = (id) => {
        setWealthObjectives(prev => prev.filter(o => o.id !== id));
    };

    return (
        <section className="mt-8 bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
                <div>
                    <h2 className="text-base font-bold text-gray-900 dark:text-white">Wealth Objectives & Target Goals</h2>
                    <p className="text-xs text-gray-500 dark:text-zinc-400">
                        Build dedicated targets (e.g., Car Chevy • 240,000) with automated monthly category pulls and manual top-ups.
                    </p>
                </div>
            </div>

            {statusMsg && (
                <div className="mb-4 px-3 py-2 rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-xs font-medium text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
                    <span>{statusMsg}</span>
                    <button type="button" onClick={() => setStatusMsg('')} className="font-bold ml-2">✕</button>
                </div>
            )}

            {/* Create New Objective Form */}
            <form onSubmit={handleCreateObjective} className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 mb-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-zinc-400">New Wealth Objective</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                        type="text"
                        value={objName}
                        onChange={(e) => setObjName(e.target.value)}
                        placeholder="Objective Name (e.g. Car Chevy)"
                        className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        required
                    />
                    <input
                        type="number"
                        step="0.01"
                        min="1"
                        value={objTarget}
                        onChange={(e) => setObjTarget(e.target.value)}
                        placeholder="Target Cost (e.g. 240000)"
                        className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        required
                    />
                </div>

                {/* Automated Monthly Category Pull Builder */}
                <div className="space-y-2">
                    <label className="block text-xs font-semibold text-gray-600 dark:text-zinc-400">
                        Automated Monthly Category Pulls (Optional — choose 1 or multiple categories)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <select
                            value={tempAutoCatId || categories[0]?.id || ''}
                            onChange={(e) => setTempAutoCatId(e.target.value)}
                            className="sm:w-1/2 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                        >
                            {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>
                                    {cat.name} ({formatCurrency(parsedSalary * ((cat.percentage || 0) / 100))}/mo budget)
                                </option>
                            ))}
                        </select>
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempAutoAmount}
                            onChange={(e) => setTempAutoAmount(e.target.value)}
                            placeholder="Monthly auto-pull amount (e.g. 2000)"
                            className="flex-1 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                        />
                        <button
                            type="button"
                            onClick={handleAddAutoPullRule}
                            className="px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold shrink-0"
                        >
                            + Add Auto-Pull
                        </button>
                    </div>

                    {Object.keys(autoPulls).length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                            {Object.entries(autoPulls).map(([cId, amt]) => {
                                const cName = categories.find(c => c.id === cId)?.name || 'Category';
                                return (
                                    <span key={cId} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30">
                                        Auto: {cName} ({formatCurrency(amt)}/mo)
                                        <button
                                            type="button"
                                            onClick={() => setAutoPulls(prev => {
                                                const copy = { ...prev };
                                                delete copy[cId];
                                                return copy;
                                            })}
                                            className="hover:text-rose-500 font-black"
                                        >
                                            ✕
                                        </button>
                                    </span>
                                );
                            })}
                        </div>
                    )}
                </div>

                <button
                    type="submit"
                    className="w-full py-2.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm transition-colors"
                >
                    Create Wealth Objective
                </button>
            </form>

            {/* Objectives List */}
            {wealthObjectives.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-gray-200 dark:border-zinc-800 rounded-lg text-xs text-gray-500 dark:text-zinc-500">
                    No wealth objectives created yet. Add one above or ask Sterling: &quot;Create a wealth objective named Car Chevy for 240000&quot;.
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {wealthObjectives.map((obj) => {
                        const monthlyAutoTotal = Object.values(obj.autoPulls || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                        const totalAccumulated = (parseFloat(obj.manualSaved) || 0) + monthlyAutoTotal;
                        const progressPct = obj.targetAmount > 0 ? Math.min(100, (totalAccumulated / obj.targetAmount) * 100) : 0;
                        const remainingNeeded = Math.max(0, obj.targetAmount - totalAccumulated);
                        const mInput = manualInputs[obj.id] || { catId: categories[0]?.id || '', amount: '' };

                        return (
                            <div key={obj.id} className="p-5 rounded-lg border border-gray-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-950/60 flex flex-col justify-between space-y-4">
                                <div>
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div>
                                            <h4 className="text-sm font-bold text-gray-900 dark:text-white">{obj.name}</h4>
                                            <p className="text-xs text-gray-500 dark:text-zinc-400">
                                                Target: <strong className="text-gray-800 dark:text-zinc-200">{formatCurrency(obj.targetAmount)}</strong>
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteObjective(obj.id)}
                                            aria-label={`Delete ${obj.name}`}
                                            className="text-gray-400 hover:text-rose-500 text-xs font-bold p-1"
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    <div className="flex items-baseline justify-between text-xs mb-1.5">
                                        <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                            {formatCurrency(totalAccumulated)} funded ({progressPct.toFixed(1)}%)
                                        </span>
                                        <span className="text-gray-500 dark:text-zinc-500">
                                            {formatCurrency(remainingNeeded)} remaining
                                        </span>
                                    </div>
                                    <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-zinc-800 overflow-hidden mb-3">
                                        <div
                                            className="h-2 rounded-full bg-emerald-600 transition-all duration-500"
                                            style={{ width: `${progressPct}%` }}
                                        />
                                    </div>

                                    {/* Active Automated Pulls */}
                                    {Object.keys(obj.autoPulls || {}).length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                            {Object.entries(obj.autoPulls).map(([cId, amt]) => {
                                                const cName = categories.find(c => c.id === cId)?.name || 'Category';
                                                return (
                                                    <span key={cId} className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 font-semibold">
                                                        Auto Pull: {cName} ({formatCurrency(amt)}/mo)
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Manual Contribution Box (From ANY Category) */}
                                <div className="pt-3 border-t border-gray-200 dark:border-zinc-800 space-y-2">
                                    <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                                        Add Manual Funds (From Any Category)
                                    </span>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <select
                                            value={mInput.catId || categories[0]?.id || ''}
                                            onChange={(e) => setManualInputs(prev => ({
                                                ...prev,
                                                [obj.id]: { ...mInput, catId: e.target.value }
                                            }))}
                                            className="sm:w-2/5 px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                                        >
                                            {categories.map(cat => (
                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="1"
                                            value={mInput.amount || ''}
                                            onChange={(e) => setManualInputs(prev => ({
                                                ...prev,
                                                [obj.id]: { ...mInput, amount: e.target.value }
                                            }))}
                                            placeholder="Amount (e.g. 1500)"
                                            className="flex-1 px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleManualDeposit(obj)}
                                            className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shrink-0"
                                        >
                                            + Fund
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}