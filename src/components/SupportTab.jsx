import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient';

/** 
 * Renders the customer support hub.
 * Uses lifted state (supportDraft) so written tickets survive tab switching.
 */
export default function SupportTab({
    session,
    username,
    supportDraft,
    setSupportDraft,
    draftHydratedUserId,
    isSubmittingTicket = false,
    setSubmittingTicketUserId
}) {
    const { t } = useTranslation();
    const [tickets, setTickets] = useState([]);
    const [localSubmitting, setLocalSubmitting] = useState(false);
    const [successMsg, setSuccessMsg] = useState('');
    const loading = isSubmittingTicket || localSubmitting;

    

    // Only persist draft after hydration for the active user has completed and draft belongs to this user
    useEffect(() => {
        if (
            session?.user?.id &&
            draftHydratedUserId === session.user.id &&
            supportDraft.userId === session.user.id &&
            supportDraft.subject !== undefined
        ) {
            try {
                localStorage.setItem(
                    `supportDraft_${session.user.id}`,
                    JSON.stringify({
                        subject: supportDraft.subject,
                        category: supportDraft.category,
                        message: supportDraft.message
                    })
                );
            } catch (e) {
                console.warn('Failed to save draft', e);
            }
        }
    }, [supportDraft, session?.user?.id, draftHydratedUserId]);

    const fetchRequestIdRef = useRef(0);
    const userId = session?.user?.id;
    const accessToken = session?.access_token;

    const fetchTickets = useCallback(async () => {
        if (!userId) return;
        const reqId = ++fetchRequestIdRef.current;
        const { data, error } = await supabase
            .from('support_tickets')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (reqId !== fetchRequestIdRef.current) return;
        if (!error && data) setTickets(data);
    }, [userId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (userId) fetchTickets();
    }, [userId, accessToken, fetchTickets]);

    const handleCreateTicket = async (e) => {
        e.preventDefault();
        const submitterId = session?.user?.id;
        if (!submitterId || loading) return;

        const submittedSubject = (supportDraft.subject || '').trim();
        const submittedCategory = supportDraft.category || 'general';
        const submittedMessage = (supportDraft.message || '').trim();
        if (!submittedSubject || !submittedMessage) return;

        if (setSubmittingTicketUserId) setSubmittingTicketUserId(submitterId);
        else setLocalSubmitting(true);
        setSuccessMsg('');

        const newTicket = {
            user_id: submitterId,
            username: username || 'User',
            email: session.user.email,
            subject: submittedSubject,
            category: submittedCategory,
            priority: 'pending',
            message: submittedMessage,
            status: 'open',
            admin_reply: ''
        };

        try {
            const { data, error } = await supabase.from('support_tickets').insert([newTicket]).select();

            if (error) {
                console.error(error);
                alert(t('err_ticket_submit', 'Failed to submit ticket. Please try again.'));
                return;
            }

            if (data && data.length > 0) {
                // Only clear the draft if it still belongs to the submitting user AND wasn't edited during submission
                setSupportDraft(prev => {
                    if (prev.userId && prev.userId !== submitterId) return prev;
                    const wasEditedDuringSubmit =
                        (prev.subject || '').trim() !== submittedSubject ||
                        (prev.category || 'general') !== submittedCategory ||
                        (prev.message || '').trim() !== submittedMessage;

                    if (wasEditedDuringSubmit) return prev;

                    const clearedDraft = { subject: '', category: 'general', message: '' };
                    try {
                        localStorage.setItem(`supportDraft_${submitterId}`, JSON.stringify(clearedDraft));
                    } catch (err) {
                        console.warn('Failed to clear saved draft', err);
                    }
                    return { userId: submitterId, ...clearedDraft };
                });

                if (session?.user?.id === submitterId) {
                    setTickets(current => [data[0], ...current]);
                    setSuccessMsg(t('succ_ticket_submit', 'Ticket submitted successfully!'));
                }
            }
        } finally {
            if (setSubmittingTicketUserId) {
                setSubmittingTicketUserId(prev => (prev === submitterId ? null : prev));
            } else {
                setLocalSubmitting(false);
            }
        }
    };

    const handleDeleteTicket = async (id) => {
        if (!window.confirm(t('confirm_delete_ticket', 'Are you sure you want to delete this ticket?'))) return;

        const deletedIndex = tickets.findIndex(item => item.id === id);
        const deletedTicket = tickets[deletedIndex];
        if (!deletedTicket) return;

        setTickets(current => current.filter(item => item.id !== id));

        try {
            const { data, error } = await supabase
                .from('support_tickets')
                .delete()
                .eq('id', id)
                .select('id');

            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('No ticket was deleted.');
            }
        } catch (error) {
            console.error(error);
            alert(t('err_delete_ticket', 'Failed to delete ticket.'));
            setTickets(current => {
                if (current.some(item => item.id === id)) return current;
                const next = [...current];
                next.splice(Math.min(deletedIndex, next.length), 0, deletedTicket);
                return next;
            });
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_category')}</label>
                            <select
                                value={supportDraft.category}
                                disabled={loading}
                                onChange={(e) => setSupportDraft(prev => ({ ...prev, userId: session?.user?.id ?? prev.userId, category: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                            >
                                <option value="general">{t('cat_general')}</option>
                                <option value="bug">{t('cat_bug')}</option>
                                <option value="billing">{t('cat_billing')}</option>
                                <option value="feature_request">{t('cat_feature')}</option>
                            </select>
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_subject')}</label>
                            <input
                                type="text"
                                disabled={loading}
                                value={supportDraft.subject}
                                onChange={(e) => setSupportDraft(prev => ({ ...prev, userId: session?.user?.id ?? prev.userId, subject: e.target.value }))}
                                placeholder="Brief summary"
                                className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                                required
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase mb-1">{t('ticket_message')}</label>
                        <textarea
                            rows={3}
                            value={supportDraft.message}
                            disabled={loading}
                            onChange={(e) => setSupportDraft(prev => ({ ...prev, userId: session?.user?.id ?? prev.userId, message: e.target.value }))}
                            placeholder="Describe your issue or request..."
                            className="w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                            required
                        ></textarea>
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="py-2.5 px-5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold text-sm shadow transition-colors"
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
                            <div key={ticket.id} className="p-4 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 space-y-2 relative group">
                                <div className="flex justify-between items-center pr-8">
                                    <span className="font-bold text-sm text-gray-900 dark:text-white">{ticket.subject}</span>
                                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${ticket.status === 'resolved' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300' :
                                            ticket.status === 'in_progress' ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300' :
                                                'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300'
                                        }`}>
                                        {ticket.status === 'resolved' ? t('status_resolved') : ticket.status === 'in_progress' ? t('status_in_progress') : t('status_open')}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-600 dark:text-zinc-400">{ticket.message}</p>
                                {ticket.admin_reply && (
                                    <div className="mt-2 p-2.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-500/20 text-xs text-emerald-900 dark:text-emerald-200">
                                        <strong>{t('admin_response')}</strong> {ticket.admin_reply}
                                    </div>
                                )}
                                {/* Delete Button */}
                                <button
                                    onClick={() => handleDeleteTicket(ticket.id)}
                                    className="absolute top-4 right-4 text-gray-400 hover:text-rose-500 transition-colors"
                                    title="Delete Ticket"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}