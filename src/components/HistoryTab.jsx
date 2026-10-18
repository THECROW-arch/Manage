export default function HistoryTab({ historyFeed }) {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div className="w-full bg-white dark:bg-zinc-900 p-8 rounded-lg border border-gray-200 dark:border-zinc-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Action Ledger</h2>
        <p className="text-gray-500 dark:text-zinc-500 text-sm mb-6">
          A chronological history of your month-end closures and portfolio adjustments.
        </p>

        {historyFeed.length === 0 ? (
          <p className="text-gray-500 dark:text-zinc-500 text-sm text-center py-10 border border-dashed border-gray-200 dark:border-zinc-800 rounded-md">
            No historical actions logged yet.
          </p>
        ) : (
          <div className="relative border-l-2 border-gray-200 dark:border-zinc-800 ml-3 space-y-8 pb-4">
            {historyFeed.map((event, idx) => (
              <div key={`${event.id}-${idx}`} className="relative pl-6">
                <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${event.type === 'ledger' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                    {event.date}
                  </span>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{event.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">{event.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}