import { useState, useEffect, useRef } from 'react';

/**
 * Renders an accessible modal displaying MANAGED's Terms of Service,
 * Privacy Policy (including all third-party sub-processors), and Browser Storage Notice.
 */
export default function LegalModal({
    isOpen,
    onClose,
    initialSection = 'terms',
    onSelectSection
}) {
    const [localSection, setLocalSection] = useState(null);
    const dialogRef = useRef(null);
    const closeBtnRef = useRef(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const activeSection = onSelectSection
        ? initialSection
        : (localSection || initialSection);

    const handleTabChange = (tabId) => {
        if (onSelectSection) {
            onSelectSection(tabId);
        } else {
            setLocalSection(tabId);
        }
    };

    const handleClose = () => {
        setLocalSection(null);
        if (onCloseRef.current) onCloseRef.current();
    };

    // Move focus into the modal on open, trap Tab/Shift+Tab within it, and restore focus to the trigger on close
    useEffect(() => {
        if (!isOpen) return;
        const previousActiveElement = document.activeElement;

        const timerId = setTimeout(() => {
            closeBtnRef.current?.focus();
        }, 0);

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setLocalSection(null);
                if (onCloseRef.current) onCloseRef.current();
                return;
            }

            if (e.key !== 'Tab' || !dialogRef.current) return;

            const focusable = dialogRef.current.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;

            const firstEl = focusable[0];
            const lastEl = focusable[focusable.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === firstEl || !dialogRef.current.contains(document.activeElement)) {
                    e.preventDefault();
                    lastEl.focus();
                }
            } else if (document.activeElement === lastEl || !dialogRef.current.contains(document.activeElement)) {
                e.preventDefault();
                firstEl.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            clearTimeout(timerId);
            document.removeEventListener('keydown', handleKeyDown);
            if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
                previousActiveElement.focus();
            }
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Legal & Privacy Policies"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
            onClick={handleClose}
        >
            <div
                ref={dialogRef}
                className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 bg-gray-50 dark:bg-zinc-950 border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-wider text-gray-900 dark:text-white">
                            MANAGED — Legal &amp; Privacy Center
                        </h2>
                        <p className="text-[11px] text-gray-500 dark:text-zinc-400">
                            Last Updated: November 15, 2026
                        </p>
                    </div>
                    <button
                        ref={closeBtnRef}
                        type="button"
                        onClick={handleClose}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-700 transition-colors"
                    >
                        ✕ Close
                    </button>
                </div>

                <div className="px-5 pt-3 border-b border-gray-200 dark:border-zinc-800 flex gap-2 bg-white dark:bg-zinc-900">
                    {[
                        { id: 'terms', label: 'Terms of Service' },
                        { id: 'privacy', label: 'Privacy Policy' },
                        { id: 'cookies', label: 'Storage & Cookies' }
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => handleTabChange(tab.id)}
                            className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${activeSection === tab.id
                                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                                : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:bg-zinc-200'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed text-gray-700 dark:text-zinc-300 custom-scrollbar">
                    {activeSection === 'terms' && (
                        <>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                1. Eligibility (18+ Only) &amp; Acceptance
                            </h3>
                            <p>
                                By creating an account or using MANAGED, you confirm that you are at least <strong>18 years of age</strong>. MANAGED is not directed to children under 13 (or under 16 in the EEA/UK), and we do not knowingly collect personal data from minors.
                            </p>

                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                2. Financial &amp; Tax Disclaimer
                            </h3>
                            <p>
                                MANAGED is a self-directed budgeting, cash-flow tracking, and progressive tax estimation tool. MANAGED does not provide certified financial, investment, legal, or tax accounting advice. All outputs—including projections from the Sterling AI assistant and Tax Center estimates—are for informational purposes only.
                            </p>

                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                3. Subscriptions &amp; Instant 1-Click Cancellation
                            </h3>
                            <p>
                                You may cancel a paid MANAGED Pro subscription at any time with a single click inside <strong>Settings → Subscription</strong>. Recurring billing stops immediately upon cancellation, and your Pro features remain active until the end of your current paid billing period.
                            </p>
                        </>
                    )}

                    {activeSection === 'privacy' && (
                        <>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                1. Data We Collect &amp; Local AI Processing
                            </h3>
                            <p>
                                We collect your account email, display username (capped at 32 characters), workspace preferences, and the budget categories, expenses, recurring bill confirmations, occasions, sandbox sheets, and wealth objectives you save. Sterling AI prompts and Excel exports are processed locally in your browser.
                            </p>

                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                2. Every Third-Party Service That Touches Your Data
                            </h3>
                            <ul className="list-disc pl-5 space-y-1.5">
                                <li><strong>Supabase, Inc.:</strong> PostgreSQL database hosting (protected by Row Level Security), user authentication, and serverless Edge Functions.</li>
                                <li><strong>Cloudflare, Inc.:</strong> Global web application hosting (Cloudflare Pages), CDN, and DDoS mitigation.</li>
                                <li><strong>Resend, Inc.:</strong> Transactional email delivery for opt-in recurring bill reminders and authentication emails.</li>
                                <li><strong>Payment Processor (Stripe / Lemon Squeezy / Paddle):</strong> Handles Pro subscription checkouts and billing webhooks without storing your card details on MANAGED servers.</li>
                            </ul>

                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                3. No Session Replays or Ad Trackers
                            </h3>
                            <p>
                                MANAGED does not use session-replay recording scripts (such as Hotjar or LogRocket) and never sells your data to third-party advertisers.
                            </p>
                        </>
                    )}

                    {activeSection === 'cookies' && (
                        <>
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                Strictly Necessary Browser Storage Only
                            </h3>
                            <p>
                                MANAGED does not use advertising or cross-site tracking cookies. We use strictly necessary browser <code>localStorage</code> keys to keep you signed in (<code>sb-*-auth-token</code>), remember your language (<code>i18nextLng</code>), and sync your recurring bill Confirm/Skip decisions (<code>managed_expense_meta_*</code>).
                            </p>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}