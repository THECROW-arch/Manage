import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function DevDashboard() {
    const [tickets, setTickets] = useState([]);
    const [filter, setFilter] = useState('open'); // 'all', 'open', 'in_progress', 'resolved'
    const [replyDrafts, setReplyDrafts] = useState({});

    useEffect(() => {
        fetchTickets();
    }, []);

    const fetchTickets = async () => {
        const { data, error } = await supabase
            .from('support_tickets')
            .select('*')
            .order('created_at', { ascending: false });
        if (!error && data) setTickets(data);
    };

    const handleReplyChange = (ticketId, text) => {
        setReplyDrafts(prev => ({ ...prev, [ticketId]: text }));
    };

    const submitReply = async (ticketId, newStatus) => {
        const replyText = replyDrafts[ticketId];
        if (replyText === undefined && newStatus === 'open') return;

        const updateData = { status: newStatus };
        if (replyText !== undefined) updateData.admin_reply = replyText;

        const { error } = await supabase
            .from('support_tickets')
            .update(updateData)
            .eq('id', ticketId);

        if (!error) {
            setReplyDrafts(prev => {
                const updated = { ...prev };
                delete updated[ticketId];
                return updated;
            });
            fetchTickets();
        }
    };

    const filteredTickets = filter === 'all' ? tickets : tickets.filter(t => t.status === filter);

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-12">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black text-gray-900 dark:text-white">Dev Operations</h1>
                    <p className="text-sm text-gray-500 dark:text-zinc-400">Manage user support tickets and bugs.</p>
                </div>
                <select 
                    value={filter} 
                    onChange={(e) => setFilter(e.target.value)}
                    className="px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm font-bold text-gray-900 dark:text-white"
                >
                    <option value="all">All Tickets</option>
                    <option value="open">Open Needs Reply</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                </select>
            </div>

            <div className="space-y-4">
                {filteredTickets.map(ticket => (
                    <div key={ticket.id} className="bg-white dark:bg-zinc-900 p-5 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row gap-6">
                        {/* User Issue Column */}
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-3">
                                <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded ${
                                    ticket.priority === 'high' ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400' :
                                    ticket.priority === 'medium' ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400' :
                                    'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400'
                                }`}>{ticket.priority} Priority</span>
                                <span className="text-xs font-bold text-gray-500 uppercase">{ticket.category}</span>
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{ticket.subject}</h3>
                            <p className="text-sm text-gray-700 dark:text-zinc-300 bg-gray-50 dark:bg-zinc-950 p-3 rounded border border-gray-100 dark:border-zinc-800">{ticket.message}</p>
                            <p className="text-xs text-gray-400 font-mono">User: {ticket.username} | {new Date(ticket.created_at).toLocaleString()}</p>
                        </div>

                        {/* Dev Reply Column */}
                        <div className="w-full md:w-96 flex flex-col space-y-3 border-t md:border-t-0 md:border-l border-gray-200 dark:border-zinc-800 pt-4 md:pt-0 md:pl-6">
                            <textarea
                                value={replyDrafts[ticket.id] !== undefined ? replyDrafts[ticket.id] : (ticket.admin_reply || '')}
                                onChange={(e) => handleReplyChange(ticket.id, e.target.value)}
                                placeholder="Type your response to the user here..."
                                className="w-full h-24 px-3 py-2 rounded bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                            ></textarea>
                            <div className="flex gap-2">
                                <button onClick={() => submitReply(ticket.id, 'in_progress')} className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold text-xs">
                                    Mark In Progress
                                </button>
                                <button onClick={() => submitReply(ticket.id, 'resolved')} className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded font-bold text-xs">
                                    Resolve & Send
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