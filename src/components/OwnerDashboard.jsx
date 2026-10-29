import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

/**
 * OwnerDashboard component for high-level SaaS metrics and user management.
 * Calculates user segmentations, estimated revenue, and allows owners to instantly mutate user roles and tiers.
 */
export default function OwnerDashboard() {
    const [metrics, setMetrics] = useState({
        totalUsers: 0,
        roleBreakdown: { user: 0, test_user: 0, special_user: 0, owner: 0, dev: 0 },
        tierBreakdown: { free: 0, pro_monthly: 0, pro_yearly: 0 },
        mrr: 0,
        arr: 0
    });
    const [userList, setUserList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [updatingId, setUpdatingId] = useState(null);

    // Mock pricing for theoretical calculations
    const PRICING = {
        pro_monthly: 9.99,
        pro_yearly: 99.99  
    };

    useEffect(() => {
        fetchMetrics();
    }, []);

    /**
     * Fetches all user profiles via a secure RPC and computes aggregations.
     */
    const fetchMetrics = async () => {
        setLoading(true);
        setErrorMsg('');
        const { data, error } = await supabase.rpc('get_saas_metrics_for_owner');
        
        if (error) {
            console.error("RPC Error:", error);
            setErrorMsg(error.message || 'Access denied or database query failed.');
            setLoading(false);
            return;
        }
        
        if (data) {
            setUserList(data);
            const breakdown = {
                roles: { user: 0, test_user: 0, special_user: 0, owner: 0, dev: 0 },
                tiers: { free: 0, pro_monthly: 0, pro_yearly: 0 },
                calculatedMRR: 0,
                calculatedARR: 0
            };

            data.forEach(user => {
                const role = user.role || 'user';
                breakdown.roles[role] = (breakdown.roles[role] || 0) + 1;

                const tier = user.subscription_tier || 'free';
                breakdown.tiers[tier] = (breakdown.tiers[tier] || 0) + 1;

                if (role === 'user') {
                    if (tier === 'pro_monthly') {
                        breakdown.calculatedMRR += PRICING.pro_monthly;
                        breakdown.calculatedARR += (PRICING.pro_monthly * 12);
                    } else if (tier === 'pro_yearly') {
                        breakdown.calculatedMRR += (PRICING.pro_yearly / 12);
                        breakdown.calculatedARR += PRICING.pro_yearly;
                    }
                }
            });

            setMetrics({
                totalUsers: data.length,
                roleBreakdown: breakdown.roles,
                tierBreakdown: breakdown.tiers,
                mrr: breakdown.calculatedMRR,
                arr: breakdown.calculatedARR
            });
        }
        setLoading(false);
    };

    /**
     * Instantly mutates a user's role or subscription tier via secure RPC.
     * @param {string} targetId - UUID of the target user profile.
     * @param {string} newRole - The assigned system role.
     * @param {string} newTier - The assigned subscription tier.
     */
    const handleUpdateUser = async (targetId, newRole, newTier) => {
        setUpdatingId(targetId);
        const { error } = await supabase.rpc('update_user_role_tier', {
            target_user_id: targetId,
            new_role: newRole,
            new_tier: newTier
        });
        
        if (error) {
            alert('Failed to update user: ' + error.message);
            setUpdatingId(null);
        } else {
            await fetchMetrics(); 
            setUpdatingId(null);
        }
    };

    if (loading) return <div className="p-10 text-center animate-pulse">Loading SaaS metrics...</div>;
    if (errorMsg) return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="bg-rose-50 border border-rose-200 text-rose-700 p-4 rounded-lg font-bold">
                Failed to load Command Center: {errorMsg}
            </div>
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-8 pb-12">
            <div>
                <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Owner Command Center</h1>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Real-time SaaS metrics, revenue, and user segmentation.</p>
                <p className="text-xs text-amber-600 font-bold bg-amber-50 p-2 mt-2 rounded border border-amber-200">
                    NOTE: Revenue figures shown are theoretical estimates based on mock subscription tiers. 
                    Actual transaction data (Stripe/Payment Gateway) is not yet integrated.
                </p>
            </div>

            {/* Revenue Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-emerald-50 dark:bg-emerald-900/20 p-6 rounded-xl border border-emerald-200 dark:border-emerald-800/30">
                    <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider mb-2">Estimated Monthly Revenue</h3>
                    <p className="text-4xl font-black text-emerald-600 dark:text-emerald-500">${metrics.mrr.toFixed(2)} <span className="text-lg font-bold text-emerald-800/50 dark:text-emerald-500/50">/mo</span></p>
                </div>
                <div className="bg-indigo-50 dark:bg-indigo-900/20 p-6 rounded-xl border border-indigo-200 dark:border-indigo-800/30">
                    <h3 className="text-sm font-bold text-indigo-800 dark:text-indigo-400 uppercase tracking-wider mb-2">Estimated Annual Run Rate</h3>
                    <p className="text-4xl font-black text-indigo-600 dark:text-indigo-500">${metrics.arr.toFixed(2)} <span className="text-lg font-bold text-indigo-800/50 dark:text-indigo-500/50">/yr</span></p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* User Roles Breakdown */}
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-base font-bold text-gray-900 dark:text-white">User Base Segmentation</h2>
                        <span className="bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 text-xs font-bold px-2.5 py-1 rounded">Total: {metrics.totalUsers}</span>
                    </div>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center text-sm"><span className="text-gray-600 dark:text-zinc-400">Standard Users (Paying pool)</span> <span className="font-bold text-gray-900 dark:text-white">{metrics.roleBreakdown.user || 0}</span></div>
                        <div className="flex justify-between items-center text-sm"><span className="text-gray-600 dark:text-zinc-400">Special Users (Comped)</span> <span className="font-bold text-gray-900 dark:text-white">{metrics.roleBreakdown.special_user || 0}</span></div>
                        <div className="flex justify-between items-center text-sm"><span className="text-gray-600 dark:text-zinc-400">Test Accounts (QA)</span> <span className="font-bold text-gray-900 dark:text-white">{metrics.roleBreakdown.test_user || 0}</span></div>
                        <div className="flex justify-between items-center text-sm"><span className="text-gray-600 dark:text-zinc-400">Staff (Devs & Owners)</span> <span className="font-bold text-gray-900 dark:text-white">{(metrics.roleBreakdown.dev || 0) + (metrics.roleBreakdown.owner || 0)}</span></div>
                    </div>
                </div>

                {/* Subscription Tiers */}
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800">
                    <h2 className="text-base font-bold text-gray-900 dark:text-white mb-6">Subscription Distribution</h2>
                    <div className="space-y-4">
                        <div className="flex justify-between items-center text-sm"><span className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-gray-400"></div>Free Tier</span> <span className="font-bold text-gray-900 dark:text-white">{metrics.tierBreakdown.free || 0}</span></div>
                        <div className="flex justify-between items-center text-sm"><span className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div>Pro (Monthly)</span> <span className="font-bold text-gray-900 dark:text-white">{metrics.tierBreakdown.pro_monthly || 0}</span></div>
                        <div className="flex justify-between items-center text-sm"><span className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-indigo-500"></div>Pro (Yearly)</span> <span className="font-bold text-gray-900 dark:text-white">{metrics.tierBreakdown.pro_yearly || 0}</span></div>
                    </div>
                </div>
            </div>

            {/* Interactive User Manager */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800">
                <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">Interactive User Manager</h2>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-zinc-800 text-xs uppercase text-gray-500 dark:text-zinc-500">
                                <th className="py-3 px-4 font-bold">User</th>
                                <th className="py-3 px-4 font-bold">Role</th>
                                <th className="py-3 px-4 font-bold">Subscription Tier</th>
                                <th className="py-3 px-4 font-bold">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {userList.map(user => {
                                const targetId = user.user_id || user.id;
                                return (
                                    <tr key={targetId} className="border-b border-gray-100 dark:border-zinc-800/50 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                                        <td className="py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">
                                            {user.username || 'Unknown User'}
                                            <div className="text-[10px] text-gray-400 font-mono mt-0.5">{targetId}</div>
                                        </td>
                                        <td className="py-3 px-4">
                                            <select
                                                className="px-2 py-1 rounded bg-gray-100 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-xs font-semibold focus:outline-none"
                                                value={user.role || 'user'}
                                                onChange={(e) => handleUpdateUser(targetId, e.target.value, user.subscription_tier || 'free')}
                                                disabled={updatingId !== null}
                                            >
                                                <option value="user">User</option>
                                                <option value="test_user">Test User</option>
                                                <option value="special_user">Special User</option>
                                                <option value="dev">Dev</option>
                                                <option value="owner">Owner</option>
                                            </select>
                                        </td>
                                        <td className="py-3 px-4">
                                            <select
                                                className="px-2 py-1 rounded bg-gray-100 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-xs font-semibold focus:outline-none"
                                                value={user.subscription_tier || 'free'}
                                                onChange={(e) => handleUpdateUser(targetId, user.role || 'user', e.target.value)}
                                                disabled={updatingId !== null}
                                            >
                                                <option value="free">Free</option>
                                                <option value="pro_monthly">Pro Monthly</option>
                                                <option value="pro_yearly">Pro Yearly</option>
                                            </select>
                                        </td>
                                        <td className="py-3 px-4 w-24">
                                            {updatingId === targetId && <span className="text-[10px] text-indigo-500 font-black uppercase tracking-wider animate-pulse">Saving...</span>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}