import { useTranslation } from 'react-i18next';

/**
 * Renders the historical ledger of finalized months and portfolio adjustments.
 */
export default function HistoryTab({ historyFeed }) {
  const { t } = useTranslation();

  // Helper to dynamically translate system-generated event titles
  const translateTitle = (title) => {
    if (!title) return '';
    if (title === 'Ledger Closed') return t('history_ledger_closed');
    if (title.startsWith('Month-End Auto-Sweep')) {
      return title.replace('Month-End Auto-Sweep', t('history_auto_sweep'));
    }
    return title;
  };

  // Helper to dynamically translate system-generated event descriptions
  const translateDesc = (desc) => {
    if (!desc) return '';
    
    // Pattern: "Finalized budget and executed wealth sweep for 2026-09"
    if (desc.startsWith('Finalized budget and executed wealth sweep for ')) {
      const month = desc.split('for ')[1];
      return t('history_finalized_budget', { month });
    }
    
    // Pattern: "MAD 1,600.00 logged to Savings+"
    if (desc.includes(' logged to ')) {
      const parts = desc.split(' logged to ');
      if (parts.length === 2) {
        return t('history_logged_to', { amount: parts[0], category: parts[1] });
      }
    }
    
    return desc;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div className="w-full bg-white dark:bg-zinc-900 p-8 rounded-lg border border-gray-200 dark:border-zinc-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">{t('action_ledger_title')}</h2>
        <p className="text-gray-500 dark:text-zinc-500 text-sm mb-6">
          {t('action_ledger_desc')}
        </p>

        {historyFeed.length === 0 ? (
          <p className="text-gray-500 dark:text-zinc-500 text-sm text-center py-10 border border-dashed border-gray-200 dark:border-zinc-800 rounded-md">
            {t('no_history_logged')}
          </p>
        ) : (
          <div className="relative border-l-2 border-gray-200 dark:border-zinc-800 ml-3 space-y-8 pb-4">
            {historyFeed.map((event, idx) => (
              <div key={`${event.id}-${idx}`} className="relative pl-6">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${event.type === 'ledger' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1" dir="ltr">
                    {event.date}
                  </span>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">
                    {translateTitle(event.title)}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
                    {translateDesc(event.desc)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}