import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

export default function SupportTab({ session, username }) {
    const { t } = useTranslation();
    const [tickets, setTickets] = useState([]);
    const [subject, setSubject] = useState('');
    const [category, setCategory] = useState('general');
    const [priority, setPriority] = useState('medium');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');

    useEffect(() => {
        if (session) fetchTickets();
    }, [session]);

    const fetchTickets = async () => {
        const { data, error } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false });
        if (!error && data) setTickets(data);
    };

    const handleCreateTicket = async (e) => {
        e.preventDefault();
        if (!subject.trim() || !message.trim()) return;
        setLoading(true);
        setSuccessMsg('');

        const newTicket = {
            user_id: session.user.id,
            username: username || 'User',
            email: session.user.email,
            subject: subject.trim(),
            category,
            priority,
            message: message.trim(),
            status: 'open',
            admin_reply: ''
        };

        const { data, error } = await supabase.from('support_tickets').insert([newTicket]).select();
        setLoading(false);

        if (!error && data) {
            setTickets([data[0], ...tickets]);
            setSubject('');
            setMessage('');
            setSuccessMsg('Ticket submitted successfully!');
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-fade-in pb-12">
            <div>
                <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">{t('support_hub_title')}</h1>
                <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">{t('support_hub_subtitle')}</p>
            </div>

            {/* FAQ Accordion Section */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">{t('faq_section_title')}</h2>
                <div className="space-y-3">
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q1')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a1')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q2')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a2')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q3')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a3')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q4')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a4')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q5')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a5')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q6')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a6')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q7')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a7')}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200 mb-1">{t('faq_q8')}</h3>
                        <p className="text-xs text-gray-600 dark:text-zinc-400">{t('faq_a8')}</p>
                    </div>
                </div>
            </div>

            {/* Submit Ticket Form */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">{t('submit_ticket')}</h2>
                {successMsg && (
                    <div className="mb-4 p-3 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 text-xs font-semibold">
                        {successMsg}
                    </div>
                )}
                <form onSubmit={handleCreateTicket} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_category')}</label>
                            <select
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                            >
                                <option value="general">{t('cat_general')}</option>
                                <option value="bug">{t('cat_bug')}</option>
                                <option value="billing">{t('cat_billing')}</option>
                                <option value="feature_request">{t('cat_feature')}</option>
                            </select>
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_priority')}</label>
                            <select
                                value={priority}
                                onChange={(e) => setPriority(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                            >
                                <option value="low">{t('priority_low')}</option>
                                <option value="medium">{t('priority_medium')}</option>
                                <option value="high">{t('priority_high')}</option>
                            </select>
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_subject')}</label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Brief summary"
                                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                                required
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_message')}</label>
                        <textarea
                            rows={3}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Describe your issue or request..."
                            className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                            required
                        ></textarea>
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-sm shadow transition-colors"
                    >
                        {loading ? 'Submitting...' : t('submit_ticket')}
                    </button>
                </form>
            </div>

            {/* Tickets History List */}
            <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-sm space-y-4">
                <h2 className="text-base font-bold text-gray-900 dark:text-white">{t('my_tickets')}</h2>
                {tickets.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-zinc-500">{t('no_tickets')}</p>
                ) : (
                    <div className="space-y-3">
                        {tickets.map(ticket => (
                            <div key={ticket.id} className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-2">
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-sm text-gray-900 dark:text-white">{ticket.subject}</span>
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                                        ticket.status === 'resolved' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' :
                                        ticket.status === 'in_progress' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' :
                                        'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
                                    }`}>
                                        {ticket.status === 'resolved' ? t('status_resolved') : ticket.status === 'in_progress' ? t('status_in_progress') : t('status_open')}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-zinc-400">{ticket.message}</p>
                                {ticket.admin_reply && (
                                    <div className="mt-2 p-2.5 rounded bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-500/20 text-xs text-indigo-900 dark:text-indigo-200">
                                        <strong>{t('admin_response')}</strong> {ticket.admin_reply}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}