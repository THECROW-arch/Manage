import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Executive Owner Command Center for platform-wide SaaS metrics, support health,
 * and interactive user role & subscription tier management.
 */
export default function OwnerDashboard() {
    const [users, setUsers] = useState([]);
    const [tickets, setTickets] = useState([]);
    const [rpcMetrics, setRpcMetrics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [toastMsg, setToastMsg] = useState('');

    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [tierFilter, setTierFilter] = useState('all');
    const [savingUserId, setSavingUserId] = useState(null);

    const fetchRequestIdRef = useRef(0);

    const fetchCommandCenterData = useCallback(async () => {
        const reqId = ++fetchRequestIdRef.current;
        await Promise.resolve();
        setLoading(true);
        setErrorMsg('');

        try {
            const [rpcRes, ownerProfilesRes, ticketsRes] = await Promise.all([
                supabase.rpc('get_saas_metrics_for_owner'),
                supabase.rpc('get_all_profiles_for_owner'),
                supabase.from('support_tickets').select('*')
            ]);

            if (reqId !== fetchRequestIdRef.current) return;

            if (!rpcRes.error && rpcRes.data) {
                setRpcMetrics(rpcRes.data);
            }

            const rpcUserList = Array.isArray(rpcRes.data?.users)
                ? rpcRes.data.users
                : Array.isArray(rpcRes.data)
                ? rpcRes.data
                : [];

            const profileRows = Array.isArray(ownerProfilesRes.data) ? ownerProfilesRes.data : [];
            const mergedMap = new Map();

            rpcUserList.forEach((u) => {
                const uid = u.user_id || u.id;
                if (uid) mergedMap.set(uid, { ...u, user_id: uid });
            });

            profileRows.forEach((p) => {
                const uid = p.user_id || p.id;
                if (uid) {
                    const existing = mergedMap.get(uid) || {};
                    mergedMap.set(uid, { ...existing, ...p, user_id: uid });
                }
            });

            const normalizedUsers = Array.from(mergedMap.values()).map((u) => {
                const rawName =
                    u.username ||
                    u.name ||
                    (u.email ? u.email.split('@')[0] : '') ||
                    `user_${String(u.user_id || '').slice(0, 6)}`;

                const rawRole = (u.role || 'user').toLowerCase();
                const cleanRole = rawRole === 'customer' ? 'user' : rawRole;
                const cleanTier = (u.subscription_tier || u.tier || 'free').toLowerCase();

                return {
                    ...u,
                    displayName: rawName,
                    role: cleanRole,
                    subscription_tier: cleanTier,
                    accountStatus: 'active',
                    current_streak: Number(u.current_streak || 0),
                    longest_streak: Number(u.longest_streak || 0),
                    salary: Number(u.salary || 0),
                    currency: u.currency || '$',
                    created_at: u.created_at || null
                };
            });

            setUsers(normalizedUsers);
            setTickets(Array.isArray(ticketsRes.data) ? ticketsRes.data : []);

            if (ownerProfilesRes.error && rpcRes.error) {
                setErrorMsg(ownerProfilesRes.error.message || rpcRes.error.message);
            }
        } catch (err) {
            if (reqId === fetchRequestIdRef.current) {
                setErrorMsg(err.message || 'Failed to load Command Center data.');
            }
        } finally {
            if (reqId === fetchRequestIdRef.current) {
                setLoading(false);
            }
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchCommandCenterData();
    }, [fetchCommandCenterData]);

    useEffect(() => {
        if (!toastMsg) return;
        const timer = setTimeout(() => setToastMsg(''), 3500);
        return () => clearTimeout(timer);
    }, [toastMsg]);

    const handleUpdateUserAccess = async (targetUserId, updates) => {
        setSavingUserId(targetUserId);
        const previousUsers = [...users];

        setUsers((prev) =>
            prev.map((u) => (u.user_id === targetUserId ? { ...u, ...updates } : u))
        );

        try {
            const { error } = await supabase.rpc('owner_update_user_profile', {
                target_user_id: targetUserId,
                new_role: updates.role ?? null,
                new_tier: updates.subscription_tier ?? null
            });

            if (error) throw error;

            const updatedUser = users.find((u) => u.user_id === targetUserId);
            setToastMsg(
                `Updated @${updatedUser?.displayName || 'user'} (${Object.entries(updates)
                    .map(([k, v]) => `${k.replace('subscription_', '')}: ${String(v).toUpperCase()}`)
                    .join(', ')})`
            );
        } catch (err) {
            setUsers(previousUsers);
            setErrorMsg(`Failed to update user: ${err.message || 'Database error'}`);
        } finally {
            setSavingUserId(null);
        }
    };

    const handleExportUsersCSV = () => {
        if (users.length === 0) return;
        const headers = ['Username', 'User ID', 'Role', 'Subscription Tier', 'Status', 'Current Streak', 'Joined Date'];
        const rows = users.map((u) => [
            `@${u.displayName.replace(/,/g, '')}`,
            u.user_id,
            u.role.toUpperCase(),
            u.subscription_tier.toUpperCase(),
            u.accountStatus.toUpperCase(),
            u.current_streak,
            u.created_at ? new Date(u.created_at).toISOString().slice(0, 10) : 'Active'
        ]);
        const csvContent = [headers, ...rows].map((r) => r.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `managed_users_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const totalUsers = users.length || Number(rpcMetrics?.total_users || 0);
    const ownerCount = users.filter((u) => u.role === 'owner').length;
    const devCount = users.filter((u) => u.role === 'dev').length;
    const specialCount = users.filter((u) => u.role === 'special').length;
    const standardUserCount = Math.max(0, totalUsers - ownerCount - devCount - specialCount);
    const proUsersCount = users.filter((u) => (u.subscription_tier === 'pro' || u.subscription_tier === 'enterprise') && u.role !== 'special').length;
    const activeBudgetsCount = users.filter((u) => u.salary > 0 || u.current_streak > 0).length;

    const totalTickets = tickets.length;
    const openTickets = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;
    const resolvedTickets = tickets.filter((t) => t.status === 'resolved').length;
    const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 100;

    const filteredUsers = users.filter((u) => {
        const matchesSearch =
            u.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            String(u.user_id || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
            u.role.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesRole = roleFilter === 'all' || u.role === roleFilter;
        const matchesTier = tierFilter === 'all' || u.subscription_tier === tierFilter;
        return matchesSearch && matchesRole && matchesTier;
    });

    if (loading) {
        return (
            <div className="p-8 space-y-6 animate-pulse">
                <div className="h-24 rounded-2xl bg-gray-200 dark:bg-zinc-900" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map((n) => (
                        <div key={n} className="h-28 rounded-xl bg-gray-200 dark:bg-zinc-900" />
                    ))}
                </div>
                <div className="h-96 rounded-2xl bg-gray-200 dark:bg-zinc-900" />
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-12">
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950 text-white p-6 sm:p-8 border border-zinc-800 shadow-xl">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black uppercase tracking-widest mb-3">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            Owner Command Center • Live Telemetry
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                            Executive Platform Overview
                        </h1>
                        <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
                            Monitor global user growth, manage staff permissions (Owner / Dev / Special / User), oversee subscription tiers, and audit customer support SLA performance.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                        <button
                            type="button"
                            onClick={fetchCommandCenterData}
                            className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 text-xs font-bold transition-all flex items-center gap-2"
                        >
                            ↻ Refresh Telemetry
                        </button>
                        <button
                            type="button"
                            onClick={handleExportUsersCSV}
                            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all"
                        >
                            ↓ Export User Directory (CSV)
                        </button>
                    </div>
                </div>
            </div>

            {errorMsg && (
                <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs font-semibold flex items-center justify-between">
                    <span>{errorMsg}</span>
                    <button type="button" onClick={() => setErrorMsg('')} className="font-black ml-4">✕</button>
                </div>
            )}

            {toastMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center justify-between shadow-sm">
                    <span>✓ {toastMsg}</span>
                    <button type="button" onClick={() => setToastMsg('')} className="font-black ml-4">✕</button>
                </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                            Total Accounts
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            Verified
                        </span>
                    </div>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{totalUsers}</p>
                    <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                        {activeBudgetsCount} with configured budgets/streaks
                    </p>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                            Staff & Special VIPs
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300">
                            RBAC Active
                        </span>
                    </div>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{ownerCount + devCount + specialCount}</p>
                    <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                        {ownerCount} Owner • {devCount} Dev • {specialCount} Special (Free Pro)
                    </p>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                            Pro Access Breakdown
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                            {totalUsers > 0 ? Math.round((proUsersCount / totalUsers) * 100) : 0}% Paid
                        </span>
                    </div>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{proUsersCount + specialCount}</p>
                    <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                        {proUsersCount} Paid Pro • {specialCount} Special (Comped) • {Math.max(0, totalUsers - proUsersCount - specialCount)} Free
                    </p>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                            Support SLA Health
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            openTickets === 0
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                        }`}>
                            {openTickets} Open
                        </span>
                    </div>
                    <p className="text-3xl font-black text-gray-900 dark:text-white">{resolutionRate}%</p>
                    <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                        {resolvedTickets} resolved of {totalTickets} total tickets
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                        Role Distribution
                    </h2>
                    <div className="space-y-3">
                        {[
                            { label: 'Standard Users', count: standardUserCount, color: 'bg-emerald-500' },
                            { label: 'Special Users (Free Pro / VIP)', count: specialCount, color: 'bg-amber-500' },
                            { label: 'Developers (Dev Ops)', count: devCount, color: 'bg-sky-500' },
                            { label: 'Platform Owners', count: ownerCount, color: 'bg-purple-500' }
                        ].map((item) => {
                            const pct = totalUsers > 0 ? Math.round((item.count / totalUsers) * 100) : 0;
                            return (
                                <div key={item.label} className="space-y-1">
                                    <div className="flex justify-between text-xs font-semibold text-gray-700 dark:text-zinc-300">
                                        <span>{item.label}</span>
                                        <span>{item.count} ({pct}%)</span>
                                    </div>
                                    <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-zinc-950 overflow-hidden">
                                        <div className={`h-2 rounded-full ${item.color} transition-all duration-500`} style={{ width: `${pct}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                        Recent Support Queue Snapshot
                    </h2>
                    {tickets.length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-zinc-500 py-6 text-center">
                            No support tickets logged across the platform.
                        </p>
                    ) : (
                        <div className="space-y-2.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                            {tickets.slice(0, 4).map((tk) => (
                                <div key={tk.id} className="p-2.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{tk.subject}</p>
                                        <p className="text-[11px] text-gray-500 dark:text-zinc-500 truncate">
                                            @{tk.username || 'user'} • {tk.category || 'general'}
                                        </p>
                                    </div>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${
                                        tk.status === 'resolved'
                                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'
                                            : tk.status === 'in_progress'
                                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
                                            : 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300'
                                    }`}>
                                        {tk.status || 'open'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-200 dark:border-zinc-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-base font-bold text-gray-900 dark:text-white">
                            Interactive User Directory & Access Control
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                            Showing {filteredUsers.length} of {totalUsers} registered accounts. Changes to Role or Subscription Tier take effect immediately.
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search @username or ID..."
                            className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 w-full sm:w-52"
                        />
                        <select
                            aria-label="Filter by role"
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value)}
                            className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs font-semibold text-gray-800 dark:text-zinc-200"
                        >
                            <option value="all">All Roles</option>
                            <option value="owner">Owners</option>
                            <option value="dev">Devs</option>
                            <option value="special">Special (Free Pro)</option>
                            <option value="user">Standard Users</option>
                        </select>
                        <select
                            aria-label="Filter by subscription tier"
                            value={tierFilter}
                            onChange={(e) => setTierFilter(e.target.value)}
                            className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs font-semibold text-gray-800 dark:text-zinc-200"
                        >
                            <option value="all">All Tiers</option>
                            <option value="free">Free Tier</option>
                            <option value="pro">Pro Tier</option>
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-zinc-800 bg-gray-50/70 dark:bg-zinc-950/60 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                                <th className="py-3.5 px-6">User Identity</th>
                                <th className="py-3.5 px-4">Account Status</th>
                                <th className="py-3.5 px-4">Activity & Streak</th>
                                <th className="py-3.5 px-4">Joined</th>
                                <th className="py-3.5 px-4">Subscription Tier</th>
                                <th className="py-3.5 px-6 text-right">Access Role</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/70 text-xs">
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-12 text-center text-gray-500 dark:text-zinc-500">
                                        No users match your current search or filter criteria.
                                    </td>
                                </tr>
                            ) : (
                                filteredUsers.map((u) => {
                                    const isSaving = savingUserId === u.user_id;
                                    const isSpecialRole = u.role === 'special';

                                    const roleBadgeClass =
                                        u.role === 'owner'
                                            ? 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-500/20 dark:text-purple-300 dark:border-purple-500/30'
                                            : u.role === 'dev'
                                            ? 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30'
                                            : u.role === 'special'
                                            ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30'
                                            : 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700';

                                    return (
                                        <tr
                                            key={u.user_id}
                                            className="hover:bg-gray-50/80 dark:hover:bg-zinc-950/40 transition-colors"
                                        >
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-500/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-black text-sm shrink-0">
                                                        {u.displayName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-gray-900 dark:text-white truncate">
                                                                @{u.displayName}
                                                            </span>
                                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${roleBadgeClass}`}>
                                                                {isSpecialRole ? 'special • vip' : u.role}
                                                            </span>
                                                        </div>
                                                        <p className="text-[11px] font-mono text-gray-400 dark:text-zinc-500 truncate mt-0.5">
                                                            ID: {String(u.user_id).slice(0, 8)}...{String(u.user_id).slice(-4)}
                                                        </p>
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4">
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                    Active
                                                </span>
                                            </td>

                                            <td className="py-4 px-4">
                                                <div className="flex flex-col">
                                                    <span className="font-semibold text-gray-800 dark:text-zinc-200">
                                                        Streak: {u.current_streak} mo (Best: {u.longest_streak})
                                                    </span>
                                                    <span className="text-[11px] text-gray-500 dark:text-zinc-500">
                                                        {u.salary > 0 ? `Budget Configured (${u.currency})` : 'Default Workspace'}
                                                    </span>
                                                </div>
                                            </td>

                                            <td className="py-4 px-4 text-gray-600 dark:text-zinc-400 font-medium">
                                                {u.created_at
                                                    ? new Date(u.created_at).toLocaleDateString(undefined, {
                                                          year: 'numeric',
                                                          month: 'short',
                                                          day: 'numeric'
                                                      })
                                                    : 'Verified Member'}
                                            </td>

                                            <td className="py-4 px-4">
                                                {isSpecialRole ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-500/40 text-[11px] font-black text-amber-800 dark:text-amber-300">
                                                        ★ FREE PRO (SPECIAL)
                                                    </span>
                                                ) : (
                                                    <select
                                                        aria-label={`Subscription tier for ${u.displayName}`}
                                                        disabled={isSaving}
                                                        value={u.subscription_tier}
                                                        onChange={(e) =>
                                                            handleUpdateUserAccess(u.user_id, {
                                                                subscription_tier: e.target.value
                                                            })
                                                        }
                                                        className="px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-xs font-bold text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50 cursor-pointer"
                                                    >
                                                        <option value="free">FREE TIER</option>
                                                        <option value="pro">PRO TIER</option>
                                                    </select>
                                                )}
                                            </td>

                                            <td className="py-4 px-6 text-right">
                                                <select
                                                    aria-label={`Role for ${u.displayName}`}
                                                    disabled={isSaving}
                                                    value={u.role}
                                                    onChange={(e) => {
                                                        const nextRole = e.target.value;
                                                        const patch = nextRole === 'special'
                                                            ? { role: 'special', subscription_tier: 'pro' }
                                                            : { role: nextRole };
                                                        handleUpdateUserAccess(u.user_id, patch);
                                                    }}
                                                    className="px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-xs font-bold text-gray-800 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 disabled:opacity-50 cursor-pointer"
                                                >
                                                    <option value="user">USER</option>
                                                    <option value="special">SPECIAL (FREE PRO)</option>
                                                    <option value="dev">DEV</option>
                                                    <option value="owner">OWNER</option>
                                                </select>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}