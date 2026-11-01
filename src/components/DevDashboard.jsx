import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

/**
 * DevDashboard component for internal staff (devs/owners) to manage support tickets.
 * Allows filtering, reading, and replying to user-submitted tickets.
 */
export default function DevDashboard() {
    const [tickets, setTickets] = useState([]);
    const [filter, setFilter] = useState('open'); // 'all', 'open', 'in_progress', 'resolved'
    const [categoryFilter, setCategoryFilter] = useState('all'); // 'all', 'bug', 'general', etc.
    const [replyDrafts, setReplyDrafts] = useState({});
    const [priorityUpdates, setPriorityUpdates] = useState({});
    const [savingTicketIds, setSavingTicketIds] = useState({});
    const [alertMsg, setAlertMsg] = useState('');
    useEffect(() => {
        fetchTickets();
    }, []);

    /**
     * Fetches all support tickets from the database, ordered by newest first.
     */
    const fetchTickets = async () => {
        const { data, error } = await supabase
            .from('support_tickets')
            .select('*')
            .order('created_at', { ascending: false });
        if (!error && data) setTickets(data);
    };

    /**
     * Updates local state with the staff member's drafted reply for a specific ticket.
     * @param {string} ticketId - UUID of the ticket being replied to.
     * @param {string} text - The drafted response text.
     */
    const handleReplyChange = (ticketId, text) => {
        setReplyDrafts(prev => ({ ...prev, [ticketId]: text }));
    };

    /**
     * Submits an admin reply and/or status change to the database.
     * @param {string} ticketId - UUID of the ticket to update.
     * @param {string} newStatus - The new status ('open', 'in_progress', 'resolved').
     */
    const savePriority = async (ticketId) => {
        if (savingTicketIds[ticketId]) return;
        const newPriority = priorityUpdates[ticketId];
        const currentTicket = tickets.find(t => t.id === ticketId);
        if (newPriority === undefined || !currentTicket || newPriority === (currentTicket.priority ?? 'pending')) return;

        setAlertMsg('');
        setSavingTicketIds(prev => ({ ...prev, [ticketId]: true }));
        try {
            const { data, error } = await supabase
                .from('support_tickets')
                .update({ priority: newPriority })
                .eq('id', ticketId)
                .select('id');

            if (error || !data || data.length === 0) {
                console.error(error);
                setAlertMsg(`Failed to update priority for ticket ${ticketId.substring(0, 8)}`);
                return;
            }

            setPriorityUpdates(prev => {
                const updated = { ...prev };
                if (updated[ticketId] === newPriority) delete updated[ticketId];
                return updated;
            });
            setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, priority: newPriority } : t));
            setAlertMsg(`Ticket priority updated.`);
            await fetchTickets();
        } finally {
            setSavingTicketIds(prev => {
                const updated = { ...prev };
                delete updated[ticketId];
                return updated;
            });
        }
    };

    const submitReply = async (ticketId, newStatus) => {
        if (savingTicketIds[ticketId]) return;
        setAlertMsg('');
        const replyText = replyDrafts[ticketId];
        const newPriority = priorityUpdates[ticketId];
        
        if (replyText === undefined && newPriority === undefined && !newStatus) return;

        const updateData = {};
        if (newStatus) updateData.status = newStatus;
        if (replyText !== undefined) updateData.admin_reply = replyText;
        if (newPriority !== undefined) updateData.priority = newPriority;

        setSavingTicketIds(prev => ({ ...prev, [ticketId]: true }));
        try {
            const { data, error } = await supabase
                .from('support_tickets')
                .update(updateData)
                .eq('id', ticketId)
                .select('id');

            if (error || !data || data.length === 0) {
                console.error(error);
                setAlertMsg(`Failed to update ticket ${ticketId.substring(0, 8)}`);
                return;
            }

            setReplyDrafts(prev => {
                const updated = { ...prev };
                if (updated[ticketId] === replyText) delete updated[ticketId];
                return updated;
            });
            setPriorityUpdates(prev => {
                const updated = { ...prev };
                if (updated[ticketId] === newPriority) delete updated[ticketId];
                return updated;
            });
            setAlertMsg(`Ticket updated successfully.`);
            await fetchTickets();
        } finally {
            setSavingTicketIds(prev => {
                const updated = { ...prev };
                delete updated[ticketId];
                return updated;
            });
        }
    };

    const filteredTickets = tickets.filter(t => {
        const matchesStatus = filter === 'all' || t.status === filter;
        const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
        return matchesStatus && matchesCategory;
    });

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-12">
            {alertMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-md text-sm font-bold">
                    {alertMsg}
                </div>
            )}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 dark:text-white">Dev Operations</h1>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">Manage user support tickets and bugs.</p>
                </div>
                <div className="flex gap-2">
                    <select 
                        value={categoryFilter} 
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm font-bold text-gray-900 dark:text-white"
                    >
                        <option value="all">All Types</option>
                        <option value="bug">Bugs</option>
                        <option value="feature_request">Features</option>
                        <option value="billing">Billing</option>
                        <option value="general">General</option>
                    </select>
                    <select 
                        value={filter} 
                        onChange={(e) => setFilter(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm font-bold text-gray-900 dark:text-white"
                    >
                        <option value="all">All Statuses</option>
                        <option value="open">Open / Needs Reply</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                    </select>
                </div>
            </div>

            <div className="space-y-4">
                {filteredTickets.map(ticket => (
                    <div key={ticket.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row gap-6">
                        {/* User Issue Column */}
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-3">
                                {ticket.priority && (
                                    <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded ${
                                        ticket.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                                        ticket.priority === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                                        ticket.priority === 'low' ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400' :
                                        'bg-gray-200 text-gray-700 dark:bg-zinc-700 dark:text-zinc-300'
                                    }`}>
                                        {ticket.priority === 'pending' ? 'Needs Triage' : `${ticket.priority} Priority`}
                                    </span>
                                )}
                                <span className="text-xs font-black px-2 py-0.5 rounded bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300 uppercase tracking-widest">{ticket.category}</span>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">ID: {ticket.id.substring(0,8)}</span>
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{ticket.subject}</h3>
                            <p className="text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-zinc-950 p-3 rounded border border-gray-100 dark:border-zinc-800">{ticket.message}</p>
                            <p className="text-xs text-gray-400 font-mono">User: {ticket.username || 'Unknown'} | {new Date(ticket.created_at).toLocaleString()}</p>
                        </div>

                        {/* Dev Reply Column */}
                        <div className="w-full md:w-96 flex flex-col space-y-3 border-t md:border-t-0 md:border-l border-gray-200 dark:border-zinc-800 pt-4 md:pt-0 md:pl-6">
                            <div className="flex gap-2">
                                <select
                                    aria-label="Ticket priority"
                                    disabled={Boolean(savingTicketIds[ticket.id])}
                                    value={priorityUpdates[ticket.id] ?? ticket.priority ?? 'pending'}
                                    onChange={(e) => setPriorityUpdates(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                                    className="flex-1 px-3 py-1.5 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-xs font-bold focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white uppercase"
                                >
                                    <option value="pending">Pending Triage</option>
                                    <option value="low">Low Priority</option>
                                    <option value="medium">Medium Priority</option>
                                    <option value="high">High Priority</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={() => savePriority(ticket.id)}
                                    disabled={
                                        Boolean(savingTicketIds[ticket.id]) ||
                                        priorityUpdates[ticket.id] === undefined ||
                                        priorityUpdates[ticket.id] === (ticket.priority ?? 'pending')
                                    }
                                    className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white rounded font-bold text-xs transition-colors"
                                >
                                    {savingTicketIds[ticket.id] ? 'Saving...' : 'Save Priority'}
                                </button>
                            </div>
                            <textarea
                                value={replyDrafts[ticket.id] !== undefined ? replyDrafts[ticket.id] : (ticket.admin_reply || '')}
                                onChange={(e) => handleReplyChange(ticket.id, e.target.value)}
                                placeholder="Type your response to the user here..."
                                className="w-full h-24 px-3 py-2 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                            ></textarea>
                            <div className="flex gap-2">
                                <button onClick={() => submitReply(ticket.id, 'in_progress')} className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold text-xs">
                                    In Progress
                                </button>
                                <button onClick={() => submitReply(ticket.id, 'resolved')} className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-bold text-xs">
                                    Resolve
                                </button>
                                <button 
                                    onClick={async () => {
                                        if (!window.confirm("Dismiss this ticket as junk/invalid? It will be deleted permanently.")) return;
                                        setAlertMsg('');
                                        const { data, error } = await supabase
                                            .from('support_tickets')
                                            .delete()
                                            .eq('id', ticket.id)
                                            .select('id');
                                        if (error || !data || data.length === 0) {
                                            console.error(error);
                                            setAlertMsg(`Failed to dismiss ticket ${ticket.id.substring(0, 8)}. Check permissions.`);
                                            return;
                                        }
                                        setAlertMsg(`Ticket ${ticket.id.substring(0, 8)} dismissed.`);
                                        fetchTickets();
                                    }} 
                                    className="px-3 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded font-bold text-xs transition-colors"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
                {filteredTickets.length === 0 && (
                    <p className="text-center text-sm text-gray-500 py-12">No tickets found in this category.</p>
                )}
            </div>
        </div>
    );
}