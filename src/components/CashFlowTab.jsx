import { useState, useEffect, useRef } from 'react';
import { PieChart, Pie, Tooltip, ResponsiveContainer } from 'recharts';
import { hexColorMap, getToday } from '../utils/constants';
import { getLocalTranscriber, mergeAndResampleTo16kHz } from '../utils/voiceTranscriber';
import { useTranslation } from 'react-i18next';
/**
 * Renders the primary Cash Flow dashboard, handling category allocations and daily transaction logging.
 */
export default function CashFlowTab({
    isPastMonth,
    closedMonths,
    selectedMonth,
    handleCloseMonth,
    setSelectedMonth,
    isReadOnly,
    totalRemaining,
    parsedSalary,
    baseSalary = 0,
    currentMonthBoost = 0,
    handleAddMonthlyBoost,
    handleClearMonthlyBoost,
    globalPercentUsed,
    totalSpent,
    totalAutomatedAssets,
    chartData,
    theme,
    formatCurrency,
    handleUnlockAll,
    lockedCategories,
    handleSmartLockAll,
    categories,
    monthlyExpenses,
    dragState,
    setDragState,
    handleSliderChange,
    toggleIndividualLock,
    setEditingCategory,
    handleDeleteCategory,
    editingCategory,
    handleUpdateCategory,
    setIsCategoryModalOpen,
    isCategoryModalOpen,
    newCategoryType,
    setNewCategoryType,
    newCategoryName,
    setNewCategoryName,
    newCategoryGoal,
    setNewCategoryGoal,
    handleAddCategory,
    setActiveTab,
    setPlannerSubTab,
    handleAddExpense,
    expenseName,
    setExpenseName,
    expenseCost,
    setExpenseCost,
    expenseCategoryId,
    setExpenseCategoryId,
    expenseDate,
    setExpenseDate,
    isRecurring,
    setIsRecurring,
    isBatched,
    setIsBatched,
    searchQuery,
    setSearchQuery,
    filterCategory,
    setFilterCategory,
    filteredExpenses,
    expandedTransactionId,
    setExpandedTransactionId,
    bundles,
    handleDeleteExpense,
    editingExpense,
    setEditingExpense,
    handleUpdateExpense,
    userId,
    expenseMetaMap: externalMetaMap,
    updateExpenseMeta: externalUpdateMeta,
    isExpenseSkippedForCurrentPeriod: externalIsSkipped,
    groupedExpenses
}) {
    const { t, i18n } = useTranslation();
    const [recurrenceType, setRecurrenceType] = useState('monthly');
    const [showBoostInput, setShowBoostInput] = useState(false);
    const [boostAmountInput, setBoostAmountInput] = useState('');
    const metaStorageKey = userId ? `managed_expense_meta_${userId}` : null;

    const [localMetaMap, setLocalMetaMap] = useState(() => {
        if (!metaStorageKey) return {};
        try {
            const saved = localStorage.getItem(metaStorageKey);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    const expenseMetaMap = externalMetaMap ?? localMetaMap;

    const updateExpenseMeta = (expId, patch) => {
        if (externalUpdateMeta) {
            externalUpdateMeta(expId, patch);
            return;
        }
        setLocalMetaMap(prev => {
            const next = {
                ...prev,
                [expId]: { ...(prev[expId] || {}), ...patch }
            };
            if (metaStorageKey) {
                try {
                    localStorage.setItem(metaStorageKey, JSON.stringify(next));
                } catch (e) {
                    console.warn('Failed to save expense metadata:', e);
                }
            }
            return next;
        });
    };

    const todayDateStr = getToday();

    const isExpenseSkippedForCurrentPeriod = (exp) => {
        if (externalIsSkipped) {
            return externalIsSkipped(exp);
        }
        if (!exp?.is_recurring) return false;
        const meta = expenseMetaMap[exp.id];
        if (!meta || !Array.isArray(meta.skippedPeriods)) return false;
        const freq = meta.recurrenceType || 'monthly';
        const periodKey = freq === 'daily'
            ? todayDateStr
            : freq === 'yearly'
            ? selectedMonth.slice(0, 4)
            : selectedMonth;
        return meta.skippedPeriods.includes(periodKey);
    };

    const togglePeriodConfirmation = (exp) => {
        const meta = expenseMetaMap[exp.id] || {};
        const freq = meta.recurrenceType || 'monthly';
        const periodKey = freq === 'daily'
            ? todayDateStr
            : freq === 'yearly'
            ? selectedMonth.slice(0, 4)
            : selectedMonth;
        const currentSkipped = Array.isArray(meta.skippedPeriods) ? meta.skippedPeriods : [];
        const isSkipped = currentSkipped.includes(periodKey);
        const nextSkipped = isSkipped
            ? currentSkipped.filter(k => k !== periodKey)
            : [...currentSkipped, periodKey];
        updateExpenseMeta(exp.id, { recurrenceType: freq, skippedPeriods: nextSkipped });
    };

    const [isListening, setIsListening] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [voiceFeedback, setVoiceFeedback] = useState(null);

    const isRecordingRef = useRef(false);
    const isStartingMicRef = useRef(false);
    const micAttemptRef = useRef(0);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const audioChunksRef = useRef([]);
    const recordingTimeoutRef = useRef(null);

    const releaseAudioHardware = async () => {
        clearTimeout(recordingTimeoutRef.current);
        micAttemptRef.current += 1;
        isStartingMicRef.current = false;
        isRecordingRef.current = false;

        if (processorRef.current) {
            try { processorRef.current.disconnect(); } catch { /* ignore */ }
            processorRef.current = null;
        }
        if (audioContextRef.current) {
            await audioContextRef.current.close().catch(() => {});
            audioContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => {
                try { track.stop(); } catch { /* ignore */ }
            });
            mediaStreamRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            releaseAudioHardware();
        };
    }, []);

    const cancelVoiceRecording = async () => {
        audioChunksRef.current = [];
        await releaseAudioHardware();
        setIsListening(false);
        setIsTranscribing(false);
        setVoiceFeedback(null);
    };

    const parseVoiceExpense = (rawTranscript) => {
        const text = rawTranscript.trim();
        if (!text) return;

        // Preserve decimal points and commas inside numbers; strip only non-numeric punctuation
        let working = text
            .replace(/[!?;:]+/g, ' ')
            .replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
            .replace(/[-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Remove thousands separators (e.g. "1,500" -> "1500", "240,000" -> "240000") BEFORE cost & name matchers
        while (/(\d),(\d{3})(?!\d)/.test(working)) {
            working = working.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
        }

        // 0. EXPLICIT FORM RESET / CLEAR COMMAND
        const clearFormRegex = /\b(?:clear|reset|empty|wipe)\s+(?:the\s+)?(?:form|fields|inputs|everything|all|expense)\b/i;
        if (clearFormRegex.test(working)) {
            setExpenseName('');
            setExpenseCost('');
            setIsRecurring(false);
            setIsBatched(false);
            setVoiceFeedback({
                type: 'success',
                message: `${t('voice_captured', 'Heard')}: "${text}" — Form fields cleared.`
            });
            return;
        }

        let hadExplicitFieldCommand = false;
        let explicitTargetName = null;

        // 1. EXPLICIT NAME CHANGE COMMANDS
        const explicitNameToRegex = /\b(?:change|set|update|rename|edit|make|call)\s+(?:the\s+)?(?:expense\s+|item\s+)?(?:name|title|description|it)\b.*?\b(?:to|as|into)\s+([a-z0-9\s']+?)(?=\s+(?:and\s+)?(?:change|set|update|check|uncheck|in\s+|under\s+|category\s+|cost\s+|price\s+|amount\s+|recurring|monthly|batch)|$)/i;
        const explicitNameDirectRegex = /\b(?:change|set|update|rename|edit)\s+(?:the\s+)?(?:expense\s+|item\s+)?(?:name|title|description)\s+([a-z0-9\s']+?)(?=\s+(?:and\s+)?(?:change|set|update|check|uncheck|in\s+|under\s+|category\s+|cost\s+|price\s+|amount\s+|recurring|monthly|batch)|$)/i;

        const nameToMatch = working.match(explicitNameToRegex);
        const nameDirectMatch = !nameToMatch ? working.match(explicitNameDirectRegex) : null;

        if (nameToMatch && nameToMatch[1]) {
            explicitTargetName = nameToMatch[1].trim();
            hadExplicitFieldCommand = true;
            working = working.replace(nameToMatch[0], ' ');
        } else if (nameDirectMatch && nameDirectMatch[1]) {
            explicitTargetName = nameDirectMatch[1]
                .replace(/^(?:from\s+.+?\s+to\s+|to\s+)/i, '')
                .trim();
            hadExplicitFieldCommand = true;
            working = working.replace(nameDirectMatch[0], ' ');
        }

        // 2. EXPLICIT COST / PRICE CHANGE COMMANDS (supports decimals and stripped thousands)
        const explicitCostRegex = /\b(?:change|set|update|edit|make)\s+(?:the\s+)?(?:expense\s+|item\s+)?(?:cost|price|amount|money|value)\b(?:.*?\b(?:to|as|into)\s*|\s*)[$€£]?\s*(\d+(?:[.,]\d{1,2})?)(?!\d)\s*(?:dollars?|usd|dirhams?|mad|dhs?|euros?|eur|pounds?|gbp|bucks)?/i;
        const explicitCostMatch = working.match(explicitCostRegex);
        if (explicitCostMatch) {
            const normalizedCost = explicitCostMatch[1].replace(',', '.');
            if (!isNaN(parseFloat(normalizedCost)) && parseFloat(normalizedCost) > 0) {
                setExpenseCost(normalizedCost);
                hadExplicitFieldCommand = true;
            }
            working = working.replace(explicitCostMatch[0], ' ');
        }

        // 3. NEGATIVE / UNCHECK COMMANDS & POSITIVE CHECK COMMANDS
        const negWord = `(?:uncheck|un\\s+check|don'?t\\s+check|do\\s+not\\s+check|don'?t|do\\s+not|not|no|non|without|remove|disable|turn\\s+off|clear|cancel|never)`;
        const recWords = `(?:recurring\\s+monthly|monthly\\s+recurring|reoccurring\\s+monthly|career\\s+monthly|caring\\s+monthly|occurring\\s+monthly|recording\\s+monthly|every\\s+month|each\\s+month|recurring|reoccurring|re\\s+occurring|career|caring|occurring|monthly|mensuel|recurrente|شهري)`;
        const batchWords = `(?:batch(?:ed|ing)?\\s+at\\s+month\\s+end|at\\s+month\\s+end|month\\s+end\\s+batch(?:ed|ing)?|month\\s+end|batch(?:ed|ing)?|fin\\s+de\\s+mois|lote|دفعة)`;

        const uncheckRecurringRegex = new RegExp(`\\b${negWord}\\s+(?:the\\s+)?${recWords}(?:\\s+box|\\s+checkbox)?\\b|\\b(?:one\\s+time|single\\s+time)\\b`, 'gi');
        const uncheckBatchedRegex = new RegExp(`\\b${negWord}\\s+(?:the\\s+)?${batchWords}(?:\\s+box|\\s+checkbox)?\\b`, 'gi');

        const checkRecurringRegex = new RegExp(`\\b(?:(?:check|enable|mark|set|with|as)\\s+(?:the\\s+)?)?${recWords}(?:\\s+box|\\s+checkbox)?\\b`, 'gi');
        const checkBatchedRegex = new RegExp(`\\b(?:(?:check|enable|mark|set|with|as)\\s+(?:the\\s+)?)?${batchWords}(?:\\s+box|\\s+checkbox)?\\b`, 'gi');

        if (uncheckRecurringRegex.test(working)) {
            setIsRecurring(false);
            hadExplicitFieldCommand = true;
            working = working.replace(uncheckRecurringRegex, ' ');
        } else if (checkRecurringRegex.test(working)) {
            setIsRecurring(true);
            hadExplicitFieldCommand = true;
            working = working.replace(checkRecurringRegex, ' ');
        }

        if (uncheckBatchedRegex.test(working)) {
            setIsBatched(false);
            hadExplicitFieldCommand = true;
            working = working.replace(uncheckBatchedRegex, ' ');
        } else if (checkBatchedRegex.test(working)) {
            setIsBatched(true);
            hadExplicitFieldCommand = true;
            working = working.replace(checkBatchedRegex, ' ');
        }

        // 4. SMART CATEGORY MATCHER
        const phoneticAliases = {
            wants: ['wants', 'want', 'once', 'wands', 'ones', 'one', 'wont', 'waltz'],
            needs: ['needs', 'need', 'kneads', 'neat', 'knees', 'leads', 'meats'],
            savings: ['savings', 'saving', 'save', 'safe', 'shavings']
        };

        if (Array.isArray(categories) && categories.length > 0) {
            const sortedCats = [...categories].sort((a, b) => b.name.length - a.name.length);
            for (const cat of sortedCats) {
                const rawCatName = cat.name.trim().toLowerCase();
                const baseStem = rawCatName.replace(/s$/, '');
                const escapedExact = rawCatName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const escapedStem = baseStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                const aliasList = new Set([escapedExact, `${escapedStem}s?`]);
                if (phoneticAliases[rawCatName]) {
                    phoneticAliases[rawCatName].forEach(a => aliasList.add(a));
                } else if (phoneticAliases[`${baseStem}s`]) {
                    phoneticAliases[`${baseStem}s`].forEach(a => aliasList.add(a));
                }

                const variationsPattern = Array.from(aliasList).join('|');
                const catCommandOrPrepRegex = new RegExp(
                    `\\b(?:(?:change|set|update|move|switch)\\s+(?:the\\s+)?(?:category|bucket)\\s+(?:from\\s+.+?\\s+)?(?:to|into|as)\\s+|(?:in|under|into|for|to|from|category|bucket|and|on|dans|en|في)\\s+(?:the\\s+)?)(?:${variationsPattern})(?:\\s+category|\\s+bucket)?\\b`,
                    'gi'
                );
                const standaloneCatRegex = new RegExp(
                    `\\b(?:${escapedExact}|${escapedStem}s?)(?:\\s+category|\\s+bucket)?\\b`,
                    'gi'
                );

                if (catCommandOrPrepRegex.test(working)) {
                    setExpenseCategoryId(cat.id);
                    hadExplicitFieldCommand = true;
                    working = working.replace(catCommandOrPrepRegex, ' ');
                    break;
                } else if (standaloneCatRegex.test(working)) {
                    setExpenseCategoryId(cat.id);
                    working = working.replace(standaloneCatRegex, ' ');
                    break;
                }
            }
        }

        // 5. IF EXPLICIT NAME COMMAND WAS GIVEN, APPLY IT DIRECTLY
        if (explicitTargetName) {
            const cleanTarget = explicitTargetName
                .replace(/[.,]+/g, ' ')
                .replace(/\b(the|a|an|please|now)\b/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (cleanTarget) {
                setExpenseName(cleanTarget.charAt(0).toUpperCase() + cleanTarget.slice(1));
            }
            setVoiceFeedback({
                type: 'success',
                message: `${t('voice_captured', 'Heard')}: "${text}" — ${t('voice_review_prompt', 'Review fields below and click Save.')}`
            });
            return;
        }

        // 6. STANDARD PRICE & NAME EXTRACTION (Preserves decimals like $12.50 and full amounts like 1500)
        const spokenNumbers = {
            one: '1', two: '2', three: '3', four: '4', five: '5',
            six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
            eleven: '11', twelve: '12', fifteen: '15', twenty: '20',
            thirty: '30', forty: '40', fifty: '50', sixty: '60',
            seventy: '70', eighty: '80', ninety: '90', hundred: '100',
            thousand: '1000'
        };

        const amountRegex = /(?:[$€£]\s*)?(\d+(?:[.,]\d{1,2})?)(?!\d)\s*(?:dollars?|usd|dirhams?|mad|dhs?|euros?|eur|pounds?|gbp|bucks)?/i;
        const amountMatch = !explicitCostMatch ? working.match(amountRegex) : null;

        const cleanSegment = (seg) => seg
            .replace(/[$€£.,]/g, ' ')
            .replace(/\b(dollars?|usd|dirhams?|mad|dhs?|euros?|eur|pounds?|gbp|bucks|cost|costing|price|priced|amount|box|checkbox|check|uncheck)\b/gi, ' ')
            .replace(/\b(change|set|update|rename|edit|make|call|name|title|description|whatever|current|currently|right\s+now|now)\b/gi, ' ')
            .replace(/\b(i\s+just|i\s+have|i've|i|please|can\s+you|could\s+you)\b/gi, ' ')
            .replace(/\b(spent|paid|bought|buy|log|logged|add|added|purchased|purchase|put|record|save)\b/gi, ' ')
            .replace(/\b(in|under|into|for|on|at|to|from|with|by|of|the|a|an|my|category|bucket|is|was|it|and)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        let candidateNameSegment;

        if (amountMatch) {
            const normalizedAmount = amountMatch[1].replace(',', '.');
            const parsedNum = parseFloat(normalizedAmount);
            if (!isNaN(parsedNum) && parsedNum > 0) {
                setExpenseCost(normalizedAmount);
            }
            const beforePrice = working.slice(0, amountMatch.index).trim();
            const afterPrice = working.slice(amountMatch.index + amountMatch[0].length).trim();
            candidateNameSegment = cleanSegment(beforePrice) || cleanSegment(afterPrice);
        } else if (!hadExplicitFieldCommand) {
            for (const [word, digit] of Object.entries(spokenNumbers)) {
                const wordRegex = new RegExp(`\\b${word}\\b(?:\\s+(?:dollars?|usd|dirhams?|mad|dhs?|euros?|bucks))?`, 'i');
                if (wordRegex.test(working)) {
                    setExpenseCost(digit);
                    working = working.replace(wordRegex, ' ');
                    break;
                }
            }
            candidateNameSegment = cleanSegment(working);
        } else {
            candidateNameSegment = cleanSegment(working);
        }

        if (candidateNameSegment) {
            const formattedName = candidateNameSegment.charAt(0).toUpperCase() + candidateNameSegment.slice(1);
            setExpenseName(formattedName);
        }

        setVoiceFeedback({
            type: 'success',
            message: `${t('voice_captured', 'Heard')}: "${text}" — ${t('voice_review_prompt', 'Review fields below and click Save.')}`
        });
    };

    const stopAndProcessRecording = async () => {
        if (!isRecordingRef.current) return;
        const sampleRate = audioContextRef.current?.sampleRate || 16000;
        const chunks = [...audioChunksRef.current];
        audioChunksRef.current = [];

        await releaseAudioHardware();
        setIsListening(false);

        if (chunks.length === 0) return;

        try {
            const audioData = mergeAndResampleTo16kHz(chunks, sampleRate);

            if (audioData.length < 4800) {
                setVoiceFeedback({
                    type: 'error',
                    message: t('err_voice_short', 'Recording was too short. Click Voice Fill, speak, then click Stop Recording.')
                });
                return;
            }

            setIsTranscribing(true);
            setVoiceFeedback({
                type: 'listening',
                message: t('voice_processing', 'Transcribing your voice...')
            });

            const transcriber = await getLocalTranscriber();
            const output = await transcriber(audioData, {
                temperature: 0,
                chunk_length_s: 30,
                stride_length_s: 5
            });
            const transcript = (output?.text || '').trim();

            if (!transcript) {
                setVoiceFeedback({
                    type: 'error',
                    message: t('err_voice_empty', 'No speech detected. Please try speaking again.')
                });
                return;
            }

            parseVoiceExpense(transcript);
        } catch (err) {
            console.error('Local transcription error:', err);
            setVoiceFeedback({
                type: 'error',
                message: `Transcription failed: ${err.message || 'Please try again.'}`
            });
        } finally {
            setIsTranscribing(false);
        }
    };

    const toggleVoiceRecording = async () => {
        if (isReadOnly || isTranscribing) return;

        // Prevent overlapping microphone startup requests
        if (isStartingMicRef.current) {
            await cancelVoiceRecording();
            return;
        }

        if (isRecordingRef.current || isListening) {
            await stopAndProcessRecording();
            return;
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setVoiceFeedback({
                type: 'error',
                message: t('err_voice_unsupported', 'Microphone access is not supported in this browser.')
            });
            return;
        }

        const attemptId = ++micAttemptRef.current;
        isStartingMicRef.current = true;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // If unmounted or canceled while waiting for permission, stop tracks immediately
            if (micAttemptRef.current !== attemptId || !isStartingMicRef.current) {
                stream.getTracks().forEach(track => {
                    try { track.stop(); } catch { /* ignore */ }
                });
                return;
            }

            mediaStreamRef.current = stream;
            audioChunksRef.current = [];

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioCtx();
            audioContextRef.current = audioCtx;

            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (event) => {
                if (!isRecordingRef.current || micAttemptRef.current !== attemptId) return;
                const inputData = event.inputBuffer.getChannelData(0);
                audioChunksRef.current.push(new Float32Array(inputData));
            };

            source.connect(processor);
            processor.connect(audioCtx.destination);

            isStartingMicRef.current = false;
            isRecordingRef.current = true;
            setIsListening(true);
            setVoiceFeedback({
                type: 'listening',
                message: t('voice_recording_prompt', 'Recording... Speak now, then click "Stop Recording" when you are done.')
            });

            recordingTimeoutRef.current = setTimeout(() => {
                if (isRecordingRef.current && micAttemptRef.current === attemptId) {
                    stopAndProcessRecording();
                }
            }, 60000);
        } catch (err) {
            if (micAttemptRef.current === attemptId) {
                await releaseAudioHardware();
                setIsListening(false);
                setVoiceFeedback({
                    type: 'error',
                    message: err.name === 'NotAllowedError'
                        ? t('err_voice_denied', 'Microphone permission denied. Please allow microphone access in your browser.')
                        : `Microphone error: ${err.message || 'Check your input device.'}`
                });
            }
        }
    };

    // FIX: Removed unused `year` and `month` array to fix ESLint!
    const transactionMonth = new Date(`${selectedMonth}-01T00:00:00`).toLocaleString(
        i18n.resolvedLanguage || 'en',
        { month: 'short', year: 'numeric' }
    );

    // --- Dynamic Data-Driven Financial Conscience Engine ---
    const generateSmartInsights = () => {
        if (!categories || categories.length === 0) return null;

        const alerts = [];
        const totalPctAllocated = categories.reduce((sum, c) => sum + (Number(c.percentage) || 0), 0);
        const assetCats = categories.filter(c => c.type === 'asset');
        const expenseCats = categories.filter(c => c.type !== 'asset');

        // 1. Check total allocation balance across the user's custom categories
        if (Math.abs(100 - totalPctAllocated) >= 1) {
            const diff = Math.round(100 - totalPctAllocated);
            alerts.push({
                type: 'notice',
                text: diff > 0
                    ? `You have ${diff}% (${formatCurrency(parsedSalary * (diff / 100))}) of your income unallocated. Use "Smart Lock Board" or drag a category slider to put every dollar to work.`
                    : `Your categories currently total ${Math.round(totalPctAllocated)}%. Click "Smart Lock Board" to normalize them to 100%.`
            });
        }

        // 2. Analyze each of the user's actual expense categories for high burn rate or over-concentration
        if (parsedSalary > 0) {
            expenseCats.forEach(cat => {
                const catBudget = parsedSalary * ((cat.percentage || 0) / 100);
                const catSpent = monthlyExpenses
                    .filter(e => e.category_id === cat.id && !isExpenseSkippedForCurrentPeriod(e))
                    .reduce((s, e) => s + parseFloat(e.cost || 0), 0);
                const burnPct = catBudget > 0 ? (catSpent / catBudget) * 100 : 0;

                if (burnPct >= 90) {
                    alerts.push({
                        type: 'warning',
                        text: `High burn alert in "${cat.name}": You have used ${Math.round(burnPct)}% (${formatCurrency(catSpent)} of ${formatCurrency(catBudget)}) with ${formatCurrency(Math.max(0, catBudget - catSpent))} left.`
                    });
                } else if (cat.percentage > 60) {
                    alerts.push({
                        type: 'notice',
                        text: `"${cat.name}" holds ${Math.round(cat.percentage)}% (${formatCurrency(catBudget)}) of your total income—consider splitting or trimming it if you want more flexibility.`
                    });
                }
            });
        }

        // 3. Evaluate the user's actual Wealth Asset categories dynamically
        const assetPctTotal = assetCats.reduce((sum, c) => sum + (Number(c.percentage) || 0), 0);
        if (assetCats.length === 0) {
            alerts.push({
                type: 'tip',
                text: `You have ${expenseCats.length} spending categories (${expenseCats.map(c => c.name).join(', ')}) but no Wealth Asset category yet. Add an Asset category to automate month-end wealth sweeps.`
            });
        } else if (assetPctTotal < 15) {
            const assetNames = assetCats.map(c => `"${c.name}"`).join(' & ');
            alerts.push({
                type: 'tip',
                text: `Your wealth allocation across ${assetNames} is currently ${Math.round(assetPctTotal)}% (${formatCurrency(parsedSalary * (assetPctTotal / 100))}). Boosting it toward 20% would add ${formatCurrency(parsedSalary * ((20 - assetPctTotal) / 100))}/mo to your portfolio.`
            });
        }

        // 4. Highlight the single largest expense category or healthy pacing
        if (alerts.length === 0 && parsedSalary > 0) {
            const topCat = [...categories].sort((a, b) => (b.percentage || 0) - (a.percentage || 0))[0];
            alerts.push({
                type: 'success',
                text: `Your ${categories.length} categories (led by "${topCat.name}" at ${Math.round(topCat.percentage)}%) are well-balanced and pacing safely within budget (${formatCurrency(totalRemaining)} remaining).`
            });
        }

        return alerts;
    };

    const smartInsights = generateSmartInsights();
    return (
        <>
            {isPastMonth && !closedMonths.some(c => (typeof c === 'string' ? c : c.month) === selectedMonth) && (
                <div className="w-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-6 mb-8 text-center">
                    <h2 className="text-xl font-bold text-amber-700 dark:text-amber-400 mb-2">Month-End Action Required</h2>
                    <p className="text-amber-600 dark:text-amber-200/80 mb-6 max-w-2xl mx-auto text-sm">
                        Finalize the <strong>{selectedMonth}</strong> ledger to lock your history and transfer wealth.
                    </p>
                    <button
                        onClick={handleCloseMonth}
                        className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-white dark:text-zinc-950 font-bold rounded-md transition-all text-sm shadow-md"
                    >
                        Close {selectedMonth} & Transfer Wealth
                    </button>
                </div>
            )}

            <div className="mb-6 flex items-center justify-between">
                <div className={`bg-white dark:bg-zinc-900 p-4 rounded-lg border ${isReadOnly ? 'border-amber-300 dark:border-amber-500/30' : 'border-gray-200 dark:border-zinc-800'} w-full md:w-64`}>
                    <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-500 mb-2 uppercase tracking-wider">{t('budget_month')}</h2>
                    <input
                        type="month"
                        value={selectedMonth}
                        onChange={(e) => setSelectedMonth(e.target.value)}
                        className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-zinc-200 focus:outline-none focus:border-emerald-500 transition-all text-sm cursor-pointer"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-5 space-y-6">

                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 relative overflow-hidden">
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">{t('total_avail_cash')}</h2>
                            {!isReadOnly && handleAddMonthlyBoost && (
                                <button
                                    type="button"
                                    onClick={() => setShowBoostInput(prev => !prev)}
                                    className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 transition-colors"
                                >
                                    + {selectedMonth} Income Boost
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap items-baseline gap-2 mb-3">
                            <span className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight">{formatCurrency(totalRemaining)}</span>
                            <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">
                                {t('left_of')} {formatCurrency(parsedSalary)}
                            </span>
                            {currentMonthBoost > 0 && (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30">
                                    Base {formatCurrency(baseSalary)} + {formatCurrency(currentMonthBoost)} ({selectedMonth} only)
                                    {!isReadOnly && handleClearMonthlyBoost && (
                                        <button
                                            type="button"
                                            onClick={handleClearMonthlyBoost}
                                            title="Remove this month's extra income boost"
                                            className="hover:text-rose-600 dark:hover:text-rose-400 font-black ml-0.5"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </span>
                            )}
                        </div>
                        {showBoostInput && !isReadOnly && (
                            <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center gap-2">
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={boostAmountInput}
                                    onChange={(e) => setBoostAmountInput(e.target.value)}
                                    placeholder={`Extra income for ${selectedMonth} only (e.g. 500)`}
                                    className="w-full sm:flex-1 px-3 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500"
                                />
                                <div className="flex items-center gap-1.5 w-full sm:w-auto">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const val = parseFloat(boostAmountInput);
                                            if (!isNaN(val) && val > 0) {
                                                handleAddMonthlyBoost(val);
                                                setBoostAmountInput('');
                                                setShowBoostInput(false);
                                            }
                                        }}
                                        className="flex-1 sm:flex-initial px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                                    >
                                        Add to {selectedMonth}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowBoostInput(false)}
                                        className="px-2.5 py-1.5 rounded bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 text-xs font-bold"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                        <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 mb-3 overflow-hidden border border-gray-200 dark:border-zinc-800">
                            <div
                                className={`h-1.5 rounded-full transition-all duration-1000 ease-out ${globalPercentUsed > 85 ? 'bg-rose-500' : 'bg-emerald-500 dark:bg-zinc-400'}`}
                                style={{ width: `${globalPercentUsed}%` }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center text-xs font-medium text-gray-500 dark:text-zinc-500">
                            <span>{formatCurrency(totalSpent)} {t('spent')} / {formatCurrency(totalAutomatedAssets)} {t('saved')}</span>
                            <span className="flex items-baseline gap-1">
                                <span>{Math.round(globalPercentUsed)}%</span>
                                {Math.abs(globalPercentUsed - Math.round(globalPercentUsed)) >= 0.05 && (
                                    <span className="text-[10px] font-mono text-gray-400 dark:text-zinc-600">
                                        ({globalPercentUsed.toFixed(2)}%)
                                    </span>
                                )}
                                <span>{t('consumed')}</span>
                            </span>
                        </div>
                    </div>
                    {/* Financial Conscience Banner */}
                    {smartInsights && smartInsights.length > 0 && (
                        <div className="col-span-1 lg:col-span-12 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-500/20 rounded-lg p-4 mb-2 animate-fade-in">
                            <h3 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600 dark:text-emerald-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                                </svg>
                                {t('smart_insights')}
                            </h3>
                            <div className="flex flex-col gap-2">
                                {smartInsights.map((insight, idx) => (
                                    <div
                                        key={idx}
                                        className={`text-sm font-medium px-3 py-2 rounded-md border-l-4 ${insight.type === 'warning' ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-500 text-rose-700 dark:text-rose-300' :
                                            insight.type === 'notice' ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-500 text-amber-700 dark:text-amber-300' :
                                                insight.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300' :
                                                    'bg-blue-50 dark:bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-300'
                                            }`}
                                    >
                                        {insight.text}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {chartData.length > 0 && (
                        <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 flex flex-col items-center">
                            <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-4 w-full text-left">{t('budget_breakdown')}</h2>
                            <ResponsiveContainer width="100%" height={200}>
                                <PieChart>
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff',
                                            borderColor: theme === 'dark' ? '#27272a' : '#e5e7eb',
                                            borderRadius: '0.5rem',
                                            color: theme === 'dark' ? '#e4e4e7' : '#111827',
                                            fontSize: '12px'
                                        }}
                                        itemStyle={{ fontWeight: 'bold' }}
                                        formatter={(value) => formatCurrency(value)}
                                    />
                                    <Pie
                                        data={chartData}
                                        dataKey="value"
                                        nameKey="name"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        stroke="none"
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    <div className="space-y-4 mb-2 relative">
                        {!isReadOnly && (
                            <div className="flex justify-between items-center bg-gray-50 dark:bg-zinc-900 p-2 rounded-lg border border-gray-200 dark:border-zinc-800">
                                <button
                                    onClick={handleUnlockAll}
                                    disabled={lockedCategories.length === 0}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 border ${lockedCategories.length === 0
                                        ? 'border-transparent text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                                        : 'border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white shadow-sm'
                                        }`}
                                >
                                    {t('unlock_all')}
                                </button>
                                <button
                                    onClick={handleSmartLockAll}
                                    className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-md text-xs font-bold transition-all flex items-center gap-2 shadow-md"
                                >
                                    {t('smart_lock_board')}
                                </button>
                            </div>
                        )}

                        <div className="space-y-4 max-h-[550px] overflow-y-auto pr-2 custom-scrollbar pb-2">
                            {categories.map((cat) => {
                                const categoryBase = parsedSalary * (cat.percentage / 100);
                                const isAsset = cat.type === 'asset';
                                const spent = monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
                                const remaining = Math.max(0, categoryBase - spent);
                                const percentUsed = (isAsset && spent === 0) ? 100 : (categoryBase > 0 ? Math.min(100, (spent / categoryBase) * 100) : 0);

                                let healthColor = isAsset ? "bg-emerald-500" : "bg-emerald-500";
                                if (!isAsset && percentUsed > 75) healthColor = "bg-amber-500";
                                if (!isAsset && percentUsed >= 90) healthColor = "bg-rose-500";

                                const isDragging = dragState.id === cat.id;
                                const currentPercent = isDragging ? dragState.val : cat.percentage;
                                const isCatLocked = lockedCategories.includes(cat.id) || isReadOnly;
                                const catHex = hexColorMap[cat.color] || '#52525b';

                                return (
                                    <div
                                        key={cat.id}
                                        style={{ borderTopWidth: '3px', borderTopColor: catHex }}
                                        className={`p-5 rounded-lg border-x border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 relative transition-opacity ${isCatLocked && !isReadOnly ? 'opacity-60' : 'opacity-100'}`}
                                    >
                                        {!isReadOnly && (
                                            <div className="absolute top-3 right-4 flex gap-2">
                                                <button
                                                    onClick={() => setEditingCategory({ id: cat.id, name: cat.name, target_goal: cat.target_goal || 0 })}
                                                    className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 font-bold transition-colors text-xs"
                                                >
                                                    ✎
                                                </button>
                                                <button
                                                    aria-label={t('delete')}
                                                    onClick={() => handleDeleteCategory(cat.id, cat.percentage)}
                                                    className="text-gray-400 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 font-bold transition-colors text-xs"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        )}

                                        {editingCategory?.id === cat.id ? (
                                            <div className="flex flex-col gap-2 mb-3 pr-10">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={editingCategory.name}
                                                    onChange={e => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                                    className="px-3 py-1 bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 rounded-md w-full text-xs focus:outline-none"
                                                />
                                                <button
                                                    onClick={() => handleUpdateCategory(cat.id, editingCategory.name, editingCategory.target_goal)}
                                                    className="bg-gray-800 dark:bg-zinc-800 text-white px-3 py-1 rounded-md font-bold w-10 self-end text-xs"
                                                >
                                                    ✓
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2 mb-1">
                                                <h2 className="text-base font-semibold text-gray-900 dark:text-white">{cat.name}</h2>
                                                {isAsset && (
                                                    <span className="text-[9px] uppercase bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 px-1.5 py-0.5 rounded font-bold tracking-wider">
                                                        Asset
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <div className="flex items-baseline gap-2 mb-4">
                                            <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">{formatCurrency(remaining)}</p>
                                            <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">{isAsset && spent === 0 ? t('auto_saved').toLowerCase() : t('remaining').toLowerCase()}</span>                                        </div>

                                        {(!isAsset || spent > 0) && (
                                            <>
                                                <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 mb-2 overflow-hidden border border-gray-200 dark:border-zinc-800">
                                                    <div
                                                        className={`h-1.5 rounded-full ${healthColor} transition-all duration-700 ease-out`}
                                                        style={{ width: `${percentUsed}%` }}
                                                    ></div>
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-gray-500 dark:text-zinc-500 font-medium mb-5">
                                                    <span>{formatCurrency(spent)} {t('spent').toLowerCase()}</span>
                                                    <span className="flex items-baseline gap-1">
                                                        <span>{Math.round(percentUsed)}%</span>
                                                        {Math.abs(percentUsed - Math.round(percentUsed)) >= 0.05 && (
                                                            <span className="text-[10px] font-mono text-gray-400 dark:text-zinc-600">
                                                                ({percentUsed.toFixed(2)}%)
                                                            </span>
                                                        )}
                                                        <span>{t('used')}</span>
                                                    </span>
                                                </div>
                                            </>
                                        )}

                                        <div className="pt-4 border-t border-gray-100 dark:border-zinc-800/60">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-500 font-semibold">{t('allocation_label')}</span>
                                                    {!isReadOnly && (
                                                        <button
                                                            type="button"
                                                            aria-label={isCatLocked ? `Unlock ${cat.name}` : `Lock ${cat.name}`}
                                                            title={isCatLocked ? 'Locked (Click to unlock)' : 'Unlocked (Click to lock)'}
                                                            onClick={() => toggleIndividualLock(cat.id)}
                                                            className={`p-1.5 rounded-md border transition-all ${isCatLocked
                                                                ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/15 dark:border-emerald-500/30'
                                                                : 'text-gray-400 border-transparent hover:text-gray-700 hover:bg-gray-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-800'
                                                                }`}
                                                        >
                                                            {isCatLocked ? (
                                                                <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                                                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                                                                </svg>
                                                            ) : (
                                                                <svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                                                                    <path d="M14.5 1A4.5 4.5 0 0010 5.5V9H3a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-1.5V5.5a3 3 0 116 0v2.75a.75.75 0 001.5 0V5.5A4.5 4.5 0 0014.5 1z" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                                <span className="text-xs font-bold text-gray-700 dark:text-zinc-300 flex items-baseline gap-1">
                                                    <span>{Math.round(currentPercent)}%</span>
                                                    {Math.abs(currentPercent - Math.round(currentPercent)) >= 0.05 && (
                                                        <span className="text-[10px] font-mono font-normal text-gray-400 dark:text-zinc-500">
                                                            ({Number(currentPercent).toFixed(2)}%)
                                                        </span>
                                                    )}
                                                    <span className="text-gray-500 dark:text-zinc-500 font-normal ml-0.5">
                                                        ({formatCurrency(categoryBase)})
                                                    </span>
                                                </span>
                                            </div>

                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                value={currentPercent}
                                                disabled={isCatLocked}
                                                onChange={(e) => {
                                                    if (!isReadOnly && !isCatLocked) {
                                                        setDragState(prev => ({ ...prev, val: Number(e.target.value) }));
                                                    }
                                                }}
                                                onPointerDown={() => {
                                                    if (!isReadOnly && !isCatLocked) {
                                                        setDragState({ id: cat.id, val: cat.percentage });
                                                    }
                                                }}
                                                onPointerUp={() => {
                                                    if (!isReadOnly && dragState.id === cat.id && !isCatLocked) {
                                                        handleSliderChange(cat.id, dragState.val);
                                                        setDragState({ id: null, val: 0 });
                                                    }
                                                }}
                                                onKeyUp={(e) => {
                                                    if (!isReadOnly && !isCatLocked && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                                                        handleSliderChange(cat.id, Number(e.target.value));
                                                        setDragState({ id: null, val: 0 });
                                                    }
                                                }}
                                                className={`w-full accent-emerald-600 dark:accent-zinc-400 ${isCatLocked ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* NEW CATEGORY BUTTON & MODAL */}
                        {!isReadOnly && (
                            <>
                                <button
                                    onClick={() => setIsCategoryModalOpen(true)}
                                    className="w-full py-3 mt-4 rounded-lg border-2 border-dashed border-gray-300 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-emerald-500 hover:text-emerald-600 dark:hover:border-emerald-500 dark:hover:text-emerald-400 font-semibold transition-all flex items-center justify-center gap-2"
                                >
                                    + {t('create_new_category')}
                                </button>

                                {isCategoryModalOpen && (
                                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
                                        <div className="w-full max-w-md bg-white dark:bg-zinc-900 p-6 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-2xl">
                                            <div className="flex justify-between items-center mb-5">
                                                <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">{t('create_new_category')}</h3>
                                                <button aria-label={t('delete')} onClick={() => setIsCategoryModalOpen(false)} className="text-gray-400 hover:text-rose-500 text-lg font-bold">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>

                                            <div className="flex gap-2 mb-4">
                                                <button
                                                    onClick={() => setNewCategoryType('expense')}
                                                    className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${newCategoryType === 'expense'
                                                        ? 'bg-gray-800 dark:bg-zinc-700 text-white shadow'
                                                        : 'bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-500'
                                                        }`}
                                                >
                                                    {t('modal_expense')}
                                                </button>
                                                <button
                                                    onClick={() => setNewCategoryType('asset')}
                                                    className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all ${newCategoryType === 'asset'
                                                        ? 'bg-gray-800 dark:bg-zinc-700 text-white shadow'
                                                        : 'bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-500'
                                                        }`}
                                                >
                                                    {t('modal_wealth_asset')}
                                                </button>
                                            </div>

                                            <div className="space-y-3">
                                                <input
                                                    type="text"
                                                    value={newCategoryName}
                                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                                    placeholder={t('modal_name_placeholder')}
                                                    className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-emerald-500"
                                                />
                                                {newCategoryType === 'asset' && (
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={newCategoryGoal}
                                                        onChange={(e) => setNewCategoryGoal(e.target.value)}
                                                        placeholder={t('modal_goal_placeholder')}
                                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-emerald-500"
                                                    />
                                                )}
                                                <button
                                                    onClick={handleAddCategory}
                                                    className="w-full py-2.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold shadow-md transition-all mt-2"
                                                >
                                                    {t('add_category')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-7 space-y-6">
                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                            <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">Log Expense</h2>
                            <div className="flex items-center gap-3">
                                {!isReadOnly && (
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={toggleVoiceRecording}
                                            disabled={isTranscribing}
                                            aria-pressed={isListening}
                                            aria-label={isListening ? t('stop_voice_input', 'Stop recording and transcribe') : t('start_voice_input', 'Fill expense by voice')}
                                            className={`px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-600/30 disabled:opacity-60 ${isListening
                                                    ? 'bg-rose-600 hover:bg-rose-700 text-white animate-pulse shadow-sm'
                                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30'
                                                }`}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                                            </svg>
                                            {isTranscribing
                                                ? t('transcribing_btn', 'Transcribing...')
                                                : isListening
                                                    ? t('stop_recording_btn', 'Stop Recording')
                                                    : t('voice_fill_btn', 'Voice Fill')}
                                        </button>
                                        {isListening && (
                                            <button
                                                type="button"
                                                onClick={cancelVoiceRecording}
                                                aria-label={t('cancel_voice', 'Cancel recording')}
                                                className="px-2 py-1.5 rounded-md text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-300 transition-colors"
                                            >
                                                {t('cancel', 'Cancel')}
                                            </button>
                                        )}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { setActiveTab('occasions'); setPlannerSubTab('occasions'); }}
                                    className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                                >
                                    {t('logging_special_occasion')}
                                </button>
                            </div>
                        </div>

                        {voiceFeedback && !isReadOnly && (
                            <div
                                role="status"
                                aria-live="polite"
                                className={`mb-4 px-3 py-2 rounded-md text-xs font-medium flex items-center justify-between gap-2 border ${voiceFeedback.type === 'error'
                                        ? 'bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300'
                                        : voiceFeedback.type === 'listening'
                                            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'
                                            : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                                    }`}
                            >
                                <span>{voiceFeedback.message}</span>
                                <button
                                    type="button"
                                    onClick={() => setVoiceFeedback(null)}
                                    aria-label={t('dismiss', 'Dismiss')}
                                    className="text-current opacity-70 hover:opacity-100 font-bold px-1"
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                        {isReadOnly ? (
                            <div className="p-4 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-center">
                                <p className="text-gray-500 dark:text-zinc-400 text-sm">This month's ledger is locked and cannot be edited.</p>
                            </div>
                        ) : (
                            <form
                                onSubmit={async (e) => {
                                    const pendingFreq = isRecurring ? recurrenceType : null;
                                    const createdExp = await handleAddExpense(e, pendingFreq);
                                    if (pendingFreq && createdExp?.id) {
                                        updateExpenseMeta(createdExp.id, { recurrenceType: pendingFreq });
                                    }
                                }}
                                className="space-y-4"
                            >
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <input
                                        type="text"
                                        value={expenseName}
                                        onChange={(e) => setExpenseName(e.target.value)}
                                        placeholder={t('what_did_you_buy')}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                    <input
                                        type="number"
                                        step="0.01"
                                        value={expenseCost}
                                        onChange={(e) => setExpenseCost(e.target.value)}
                                        placeholder={t('cost_placeholder')}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <select
                                        value={expenseCategoryId}
                                        onChange={(e) => setExpenseCategoryId(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-emerald-500"
                                    >
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name} {cat.type === 'asset' ? '(Asset)' : ''}</option>)}
                                    </select>
                                    <input
                                        type="date"
                                        value={expenseDate}
                                        onChange={(e) => setExpenseDate(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-emerald-500"
                                        required
                                    />
                                </div>
                                <div className="flex flex-wrap items-center gap-6 pt-1 pb-2">
                                    <div className="flex items-center gap-2">
                                        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-zinc-400 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={isRecurring}
                                                onChange={(e) => setIsRecurring(e.target.checked)}
                                                className="rounded border-gray-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500 bg-transparent cursor-pointer"
                                            />
                                            {t('recurring_label', 'Recurring')}
                                        </label>
                                        {isRecurring && (
                                            <div
                                                role="group"
                                                aria-label="Recurrence frequency"
                                                className="inline-flex rounded-md p-0.5 bg-gray-100 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800"
                                            >
                                                {['daily', 'monthly', 'yearly'].map((freqOpt) => (
                                                    <button
                                                        key={freqOpt}
                                                        type="button"
                                                        onClick={() => setRecurrenceType(freqOpt)}
                                                        className={`px-2.5 py-1 rounded text-[11px] font-bold capitalize transition-all ${
                                                            recurrenceType === freqOpt
                                                                ? 'bg-emerald-700 text-white shadow-sm'
                                                                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white'
                                                        }`}
                                                    >
                                                        {freqOpt}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-zinc-400 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isBatched}
                                            onChange={(e) => setIsBatched(e.target.checked)}
                                            className="rounded border-gray-300 dark:border-zinc-700 text-emerald-600 focus:ring-emerald-500 bg-transparent cursor-pointer"
                                        />
                                        {t('batch_month_end')}
                                    </label>
                                </div>
                                <button
                                    type="submit"
                                    className="w-full py-2.5 px-4 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white font-bold transition-all text-sm shadow-md"
                                >
                                    {t('save_expense')}
                                </button>
                            </form>
                        )}
                    </div>

                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 min-h-[400px]">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-5 gap-4">
                            <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">
                                {t('transactions')} {selectedMonth ? transactionMonth : '—'}
                            </h3>
                            {monthlyExpenses.length > 0 && (
                                <div className="flex gap-2 w-full sm:w-auto">
                                    <input
                                        type="text"
                                        placeholder={t('search_placeholder')}
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full sm:w-40 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-emerald-500"
                                    />
                                    <select
                                        value={filterCategory}
                                        onChange={(e) => setFilterCategory(e.target.value)}
                                        className="w-full sm:w-40 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-emerald-500"
                                    >
                                        <option value="All">{t('all_categories')}</option>
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        {filteredExpenses.length === 0 ? (
                            <div className="h-48 flex items-center justify-center border border-gray-200 dark:border-zinc-800/50 border-dashed rounded-md">
                                <p className="text-gray-500 dark:text-zinc-500 text-sm text-center py-6">{t('no_expenses_match')}</p>
                            </div>
                        ) : (
                            <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                                {groupedExpenses.map((exp) => {
                                    const isExpanded = expandedTransactionId === exp.bundle_id;
                                    const bundleDetails = exp.bundle_id ? bundles.find(b => b.id === exp.bundle_id) : null;
                                    const bundleItems = bundleDetails?.items || [];
                                    const meta = expenseMetaMap[exp.id] || {};
                                    const freq = meta.recurrenceType || 'monthly';
                                    const isSkippedThisPeriod = isExpenseSkippedForCurrentPeriod(exp);
                                    const lastEditedDate = exp.last_edited_at || meta.lastEditedAt || null;
                                    const isEditingThis = editingExpense?.id === exp.id;

                                    return (
                                        <li
                                            key={exp.id}
                                            onClick={() => {
                                                if (exp.bundle_id) {
                                                    setExpandedTransactionId(isExpanded ? null : exp.bundle_id);
                                                }
                                            }}
                                            className={`p-3 rounded-md border flex flex-col group transition-all ${
                                                exp.bundle_id
                                                    ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-500/30 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-500/50'
                                                    : isSkippedThisPeriod
                                                    ? 'bg-gray-100/60 dark:bg-zinc-900/40 border-gray-200 dark:border-zinc-800/60 opacity-60'
                                                    : 'bg-gray-50 dark:bg-zinc-950 border-gray-100 dark:border-zinc-800'
                                            }`}
                                        >
                                            {isEditingThis ? (
                                                <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">
                                                            Editing Expense • Created {exp.expense_date} (Locked)
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingExpense(null)}
                                                            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-zinc-200 font-bold"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                                        <input
                                                            type="text"
                                                            value={editingExpense.name}
                                                            onChange={(e) => setEditingExpense({ ...editingExpense, name: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                                                            placeholder="Expense name"
                                                        />
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={editingExpense.cost}
                                                            onChange={(e) => setEditingExpense({ ...editingExpense, cost: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                                                            placeholder="Cost"
                                                        />
                                                        <select
                                                            value={editingExpense.category_id}
                                                            onChange={(e) => setEditingExpense({ ...editingExpense, category_id: e.target.value })}
                                                            className="px-2.5 py-1.5 rounded bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-xs text-gray-900 dark:text-white"
                                                        >
                                                            {categories.map(cat => (
                                                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                                        <div className="flex flex-wrap items-center gap-4">
                                                            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-zinc-400 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={Boolean(editingExpense.is_recurring)}
                                                                    onChange={(e) => setEditingExpense({ ...editingExpense, is_recurring: e.target.checked })}
                                                                />
                                                                Recurring
                                                            </label>
                                                            {editingExpense.is_recurring && (
                                                                <select
                                                                    value={editingExpense.recurrenceType || freq}
                                                                    onChange={(e) => setEditingExpense({ ...editingExpense, recurrenceType: e.target.value })}
                                                                    className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-zinc-800 border border-emerald-300 dark:border-zinc-700 text-xs font-bold"
                                                                >
                                                                    <option value="daily">Daily</option>
                                                                    <option value="monthly">Monthly</option>
                                                                    <option value="yearly">Yearly</option>
                                                                </select>
                                                            )}
                                                            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-zinc-400 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={Boolean(editingExpense.is_batched)}
                                                                    onChange={(e) => setEditingExpense({ ...editingExpense, is_batched: e.target.checked })}
                                                                />
                                                                Batched
                                                            </label>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={async () => {
                                                                const ok = await handleUpdateExpense(exp.id, editingExpense);
                                                                if (ok) {
                                                                    const todayStamp = getToday();
                                                                    updateExpenseMeta(exp.id, {
                                                                        recurrenceType: editingExpense.recurrenceType || freq,
                                                                        lastEditedAt: todayStamp
                                                                    });
                                                                }
                                                            }}
                                                            className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold"
                                                        >
                                                            Save Changes
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex justify-between items-center w-full gap-2">
                                                    <div className="flex flex-col">
                                                        <div className="text-gray-900 dark:text-zinc-200 font-medium text-sm flex flex-wrap items-center gap-2">
                                                            <span className={isSkippedThisPeriod ? 'line-through opacity-70' : ''}>{exp.name}</span>
                                                            {exp.bundle_id && (
                                                                <span className="text-[9px] uppercase font-bold text-purple-600 bg-purple-100 dark:text-purple-300 dark:bg-purple-500/20 px-1.5 py-0.5 rounded tracking-wider">
                                                                    Occasion Bundle
                                                                </span>
                                                            )}
                                                            {exp.is_recurring && (
                                                                <span className="text-[9px] uppercase font-bold text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-500/20 px-1.5 py-0.5 rounded tracking-wider">
                                                                    Recurring ({freq})
                                                                </span>
                                                            )}
                                                            {exp.is_batched && (
                                                                <span className="text-[9px] uppercase font-bold text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-500/20 px-1.5 py-0.5 rounded tracking-wider">
                                                                    Batched
                                                                </span>
                                                            )}
                                                            {exp.is_recurring && !isReadOnly && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        togglePeriodConfirmation(exp);
                                                                    }}
                                                                    title="Toggle whether you paid this recurring expense during this period"
                                                                    className={`text-[10px] px-2 py-0.5 rounded font-bold border transition-colors ${
                                                                        isSkippedThisPeriod
                                                                            ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300'
                                                                            : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
                                                                    }`}
                                                                >
                                                                    {isSkippedThisPeriod
                                                                        ? `Skipped (${freq === 'daily' ? 'Today' : freq === 'yearly' ? 'This Year' : 'This Month'})`
                                                                        : `✓ Confirmed (${freq === 'daily' ? 'Today' : freq === 'yearly' ? 'This Year' : 'This Month'})`}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <span className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 flex flex-wrap items-center gap-2">
                                                            <span>{isSkippedThisPeriod ? `${formatCurrency(0)} (Skipped)` : formatCurrency(exp.cost)}</span>
                                                            <span>• {exp.expense_date}</span>
                                                            {lastEditedDate && (
                                                                <span className="text-[10px] italic text-gray-400 dark:text-zinc-500">
                                                                    (Edited: {lastEditedDate})
                                                                </span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] uppercase px-2 py-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded text-gray-500 dark:text-zinc-400">
                                                            {exp.category}
                                                        </span>

                                                        {!isReadOnly && !exp.bundle_id && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    aria-label={t('edit', 'Edit expense')}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setEditingExpense({
                                                                            id: exp.id,
                                                                            name: exp.name,
                                                                            cost: exp.cost,
                                                                            category_id: exp.category_id,
                                                                            expense_date: exp.expense_date,
                                                                            is_recurring: Boolean(exp.is_recurring),
                                                                            is_batched: Boolean(exp.is_batched),
                                                                            recurrenceType: freq
                                                                        });
                                                                    }}
                                                                    className="opacity-70 hover:opacity-100 transition-opacity text-gray-400 hover:text-emerald-600 dark:text-zinc-500 dark:hover:text-emerald-400 p-1 font-bold text-xs"
                                                                >
                                                                    ✎
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    aria-label={t('delete')}
                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteExpense(exp.id); }}
                                                                    className="opacity-70 hover:opacity-100 transition-opacity text-gray-400 hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400 p-1 font-bold"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                                    </svg>
                                                                </button>
                                                            </>
                                                        )}

                                                        {exp.bundle_id && (
                                                            <span className="text-emerald-400 dark:text-emerald-500 font-bold text-xs ml-1 transition-transform">
                                                                {isExpanded ? '▲' : '▼'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {isExpanded && bundleItems.length > 0 && (
                                                <div className="mt-3 pt-3 border-t border-emerald-200/50 dark:border-emerald-500/30 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                                                    <p className="text-[10px] uppercase font-bold text-emerald-500 dark:text-emerald-400 mb-2">Itemized Receipts</p>
                                                    <ul className="space-y-1.5">
                                                        {bundleItems.map((item, idx) => (
                                                            <li key={idx} className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 text-xs px-3 py-2 rounded bg-white dark:bg-zinc-900/80 border border-emerald-50 dark:border-zinc-800">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="text-gray-800 dark:text-zinc-200 font-semibold">{item.name}</span>
                                                                    {item.allocations && Object.entries(item.allocations).map(([cId, amt]) => (
                                                                        <span key={cId} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-zinc-800 text-emerald-600 dark:text-zinc-400 font-medium">
                                                                            {categories.find(c => c.id === cId)?.name || 'Category'}: {formatCurrency(amt)}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                                <span className="font-mono font-bold text-gray-700 dark:text-zinc-300">{formatCurrency(item.cost)}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}