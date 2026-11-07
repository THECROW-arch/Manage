import { calculateProgressiveTax, getToday } from './constants';

function normalizeTypos(str) {
    return str
        .toLowerCase()
        .replace(/\bexpences\b/g, 'expenses')
        .replace(/\bexpence\b/g, 'expense')
        .replace(/\bremouve\b/g, 'remove')
        .replace(/\bremoove\b/g, 'remove')
        .replace(/\bdelet\b/g, 'delete')
        .replace(/\bdlt\b/g, 'delete')
        .replace(/\bcatagories\b/g, 'categories')
        .replace(/\bcatagory\b/g, 'category')
        .replace(/\bbudjet\b/g, 'budget')
        .replace(/\brecuring\b/g, 'recurring')
        .replace(/\breocurring\b/g, 'recurring')
        .replace(/\bsalery\b/g, 'salary')
        .replace(/\bcurency\b/g, 'currency')
        .replace(/\bcurrancy\b/g, 'currency')
        .replace(/\bportfolyo\b/g, 'portfolio')
        .replace(/\btransacions\b/g, 'transactions')
        .replace(/\bobjectiv\b/g, 'objective')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses a complete monetary token without accepting partial matches or truncating decimals.
 * Handles thousands separators ("1,000" -> 1000, "8,000" -> 8000, "2,000" -> 2000)
 * and decimal commas/dots ("1,5" -> 1.5, "12.50" -> 12.5).
 * Returns NaN if the token has >2 decimal places (e.g. "1000.567") or invalid grouping.
 */
export function parseMoneyAmount(rawNumberStr) {
    if (rawNumberStr === null || rawNumberStr === undefined) return NaN;
    const s = String(rawNumberStr).trim().replace(/^[$€£]\s*/, '');
    if (!s) return NaN;

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');

    if (hasComma && hasDot) {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma < lastDot) {
            // Format: 1,234.56
            if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return NaN;
            return Number(s.replace(/,/g, ''));
        } else {
            // Format: 1.234,56
            if (!/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return NaN;
            return Number(s.replace(/\./g, '').replace(',', '.'));
        }
    }

    if (hasComma) {
        // Thousands grouping: "1,000", "8,000", "240,000"
        if (/^\d{1,3}(,\d{3})+$/.test(s)) {
            return Number(s.replace(/,/g, ''));
        }
        // Decimal comma with 1 or 2 fractional digits: "1,5", "45,50"
        if (/^\d+,\d{1,2}$/.test(s)) {
            return Number(s.replace(',', '.'));
        }
        return NaN;
    }

    if (hasDot) {
        // Reject more than 2 decimal places (e.g. "1000.567" or ambiguous "1.200") instead of truncating
        if (!/^\d+\.\d{1,2}$/.test(s)) return NaN;
        return Number(s);
    }

    if (/^\d+$/.test(s)) {
        return Number(s);
    }

    return NaN;
}

export const MONEY_PARSER_TEST_CASES = [
    { input: '1,000', expected: 1000 },
    { input: '8,000', expected: 8000 },
    { input: '2,000', expected: 2000 },
    { input: '1,5', expected: 1.5 }
];

export function runMoneyParserSelfTest() {
    return MONEY_PARSER_TEST_CASES.every(({ input, expected }) => parseMoneyAmount(input) === expected);
}

// Captures the complete contiguous numeric token so partial prefixes are never extracted
const MONEY_TOKEN_REGEX = /[$€£]?\s*(\d+(?:[.,]\d+)*)(?!\d)/;

export async function processAIAgentTurn(rawInput, ctx) {
    const text = (rawInput || '').trim();
    if (!text) {
        return {
            reply: 'What would you like to check or do in your budget?',
            suggestions: ['Audit my budget', 'How many expenses do I have this month?', 'How much can I spend per day?']
        };
    }

    const lower = normalizeTypos(text);
    const isWhereOrHowQuestion = /^(?:where|how\s+do\s+i|how\s+can\s+i|can\s+you\s+tell\s+me\s+where|can\s+you\s+tell\s+me\s+how)\b/i.test(lower);

    const {
        parsedSalary = 0,
        setSalary,
        setCurrency,
        setCurrencyMode,
        setCustomCurrency,
        totalSpent = 0,
        totalRemaining = 0,
        totalAutomatedAssets = 0,
        categories = [],
        expenses = [],
        monthlyExpenses = [],
        lastAddedExpenseId = null,
        assetAdjustments = [],
        selectedMonth,
        setSelectedMonth,
        isReadOnly,
        formatCurrency,
        taxCountry,
        taxFilingStatus,
        theme,
        setTheme,
        setActiveTab,
        handleSmartLockAll,
        handleUnlockAll,
        handleSliderChange,
        handleDeleteExpense,
        handleUpdateExpense,
        handleDeleteCategory,
        handleUpdateCategory,
        lockedCategories = [],
        toggleIndividualLock,
        bundles = [],
        handleDeleteBundle,
        sandboxSheets = [],
        handleDeleteSandboxSheet,
        onDirectLogExpense,
        onPrefillExpense,
        onDirectCreateCategory,
        wealthObjectives = [],
        setWealthObjectives,
        handleAddMonthlyBoost,
        handleClearMonthlyBoost,
        onDirectCreateBundle,
        onDirectCreateSandbox
    } = ctx;

    const getExpenseDateForActiveMonth = () => {
        const today = getToday();
        if (selectedMonth && !today.startsWith(selectedMonth)) {
            return `${selectedMonth}-01`;
        }
        return today;
    };

    const findCategoryInText = (inputStr) => {
        if (!Array.isArray(categories) || categories.length === 0) return null;
        const cleanedLookup = String(inputStr || '').replace(
            /^(?:please\s+|can\s+you\s+)?(?:add|log|record|save|spent|paid|bought|fill|prefill)\b\s*/i,
            ''
        );
        const aliases = {
            wants: ['wants', 'want', 'once', 'entertainment', 'lifestyle'],
            needs: ['needs', 'need', 'bills', 'essentials'],
            savings: ['savings', 'saving', 'save', 'invest', 'investment']
        };
        const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);
        for (const cat of sorted) {
            const cName = cat.name.toLowerCase();
            const stem = cName.replace(/s$/, '');
            const list = [cName, stem, ...(aliases[cName] || []), ...(aliases[`${stem}s`] || [])];
            for (const word of list) {
                const escaped = escapeRegExp(word);
                if (new RegExp(`(?:^|\\W)${escaped}(?=$|\\W)`, 'i').test(cleanedLookup)) {
                    return cat;
                }
            }
        }
        return null;
    };

    const getCategoryStats = (cat) => {
        const allocated = parsedSalary * ((cat.percentage || 0) / 100);
        const spent = monthlyExpenses
            .filter(e => e.category_id === cat.id)
            .reduce((s, e) => s + parseFloat(e.cost || 0), 0);
        const remaining = Math.max(0, allocated - spent);
        return { allocated, spent, remaining };
    };

    // =========================================================================
    // 0. CONVERSATIONAL GREETINGS & THANKS
    // =========================================================================
    if (/^(?:hey\s+sterling|hi\s+sterling|sterling|hi+|hello+|hey+|good\s+(?:morning|afternoon|evening)|yo|sup|greetings)\b/i.test(lower) && lower.split(' ').length <= 4) {
        return {
            reply: `Hello! I'm **Sterling**, your MANAGED financial advisor. Your **${selectedMonth}** ledger has **${formatCurrency(totalRemaining)}** available across **${categories.length}** categories (${monthlyExpenses.length} transaction${monthlyExpenses.length === 1 ? '' : 's'} logged). How can I help?`,
            suggestions: [
                'How much can I spend per day?',
                'Audit my budget',
                'How many expenses do I have this month?'
            ]
        };
    }

    if (/^(thanks|thank\s+you|thx|awesome|great|perfect|cool)\b/i.test(lower) && lower.split(' ').length <= 5) {
        return {
            reply: 'Always happy to help! Let me know if you want to log an expense, adjust a category, or run a calculation.',
            suggestions: ['Audit my budget', 'How much can I spend per day?']
        };
    }

    // =========================================================================
    // 1. "WHERE / HOW DO I..." NAVIGATION & HELP QUESTIONS
    // =========================================================================
    if (isWhereOrHowQuestion) {
        if (/\b(dark|light|theme|mode|appearance)\b/i.test(lower)) {
            return {
                reply: `You can switch between **Light Mode** and **Dark Mode** inside the **Settings** tab (under **Appearance**).\n\nOr tell me *"Switch to light mode"* or *"Switch to dark mode"* and I'll toggle it for you right now!`,
                suggestions: [
                    theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
                    'Open Settings'
                ]
            };
        }
        if (/\b(currency|mad|dollar|euro|symbol)\b/i.test(lower)) {
            return {
                reply: `You can change your **Currency** in the **Settings** tab—or tell me *"Change my currency to MAD"* (or $, €, £) and I'll update it immediately!`,
                suggestions: ['Change my currency to MAD', 'Open Settings']
            };
        }
        if (/\b(salary|income|paycheck)\b/i.test(lower)) {
            return {
                reply: `You can update your monthly **Salary** in the **Settings** tab—or tell me *"Set my salary to 12000"* and I will update it right here!`,
                suggestions: ['Open Settings', 'Audit my budget']
            };
        }
        if (/\b(export|excel|csv|download|report)\b/i.test(lower)) {
            return {
                reply: `You can download your **Formal Audit** or **Visual Dashboard** Excel spreadsheets inside the **Settings** tab under **Data Export**.`,
                suggestions: ['Open Settings', 'Audit my budget']
            };
        }
    }

    // =========================================================================
    // 2. DELETE / REMOVE A WEALTH OBJECTIVE
    // =========================================================================
    if (/\b(delete|remove|erase|clear)\b.*\b(wealth\s+objective|objective|objectives|goal)\b/i.test(lower) && setWealthObjectives) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        if (!Array.isArray(wealthObjectives) || wealthObjectives.length === 0) {
            return {
                reply: 'You do not have any Wealth Objectives to remove right now.',
                suggestions: ['Create a wealth objective named Car Chevy for 240000', 'Open Portfolio']
            };
        }

        const isLast = /\b(last|latest|recent)\b/i.test(lower);
        let targetObj = isLast ? wealthObjectives[0] : null;

        if (!targetObj) {
            const sortedObjs = [...wealthObjectives].sort((a, b) => b.name.length - a.name.length);
            targetObj = sortedObjs.find(o => lower.includes(o.name.toLowerCase()));
        }

        if (!targetObj && wealthObjectives.length === 1) {
            targetObj = wealthObjectives[0];
        }

        if (!targetObj) {
            return {
                reply: `Which Wealth Objective would you like to delete? Your active objectives are: **${wealthObjectives.map(o => o.name).join(', ')}**.`,
                suggestions: wealthObjectives.slice(0, 3).map(o => `Delete the ${o.name} wealth objective`)
            };
        }

        setWealthObjectives(prev => prev.filter(o => o.id !== targetObj.id));
        return {
            reply: `Deleted the Wealth Objective **${targetObj.name}** (${formatCurrency(targetObj.targetAmount)} target) from your Portfolio.`,
            actionBadge: `Deleted Objective → ${targetObj.name}`,
            suggestions: ['Open Portfolio', 'Audit my budget']
        };
    }

    // =========================================================================
    // 3. DELETE / REMOVE A SANDBOX SHEET
    // =========================================================================
    if (/\b(delete|remove|erase)\b.*\b(sandbox|calculation\s+sheet|temp\s+sheet|sheet)\b/i.test(lower) && handleDeleteSandboxSheet) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        if (!Array.isArray(sandboxSheets) || sandboxSheets.length === 0) {
            return { reply: 'You do not have any Sandbox calculation sheets to delete.' };
        }

        const isLast = /\b(last|latest|recent)\b/i.test(lower);
        let targetSheet = isLast ? sandboxSheets[0] : null;

        if (!targetSheet) {
            const sortedSheets = [...sandboxSheets].sort((a, b) => b.title.length - a.title.length);
            targetSheet = sortedSheets.find(s => lower.includes(s.title.toLowerCase()));
        }
        if (!targetSheet && sandboxSheets.length === 1) {
            targetSheet = sandboxSheets[0];
        }

        if (!targetSheet) {
            return {
                reply: `Which Sandbox sheet should I delete? You currently have: **${sandboxSheets.map(s => s.title).join(', ')}**.`,
                suggestions: sandboxSheets.slice(0, 3).map(s => `Delete the ${s.title} sandbox sheet`)
            };
        }

        const ok = await handleDeleteSandboxSheet(targetSheet.id);
        if (!ok) {
            return { reply: `Failed to delete Sandbox Sheet **${targetSheet.title}**. Please try again.` };
        }
        return {
            reply: `Deleted Sandbox Sheet **${targetSheet.title}** (${formatCurrency(targetSheet.totalBudget)} budget).`,
            actionBadge: `Deleted Sandbox → ${targetSheet.title}`,
            suggestions: ['Open Occasions & Sandbox', 'Audit my budget']
        };
    }

    // =========================================================================
    // 4. DELETE / REMOVE A SPECIAL OCCASION BUNDLE
    // =========================================================================
    if (/\b(delete|remove|erase)\b.*\b(special\s+occasion|occasion|bundle)\b/i.test(lower) && handleDeleteBundle) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        if (!Array.isArray(bundles) || bundles.length === 0) {
            return { reply: 'You do not have any Special Occasion bundles to delete.' };
        }

        const isLast = /\b(last|latest|recent)\b/i.test(lower);
        let targetBundle = isLast ? bundles[0] : null;

        if (!targetBundle) {
            const sortedBundles = [...bundles].sort((a, b) => b.name.length - a.name.length);
            targetBundle = sortedBundles.find(b => lower.includes(b.name.toLowerCase()));
        }
        if (!targetBundle && bundles.length === 1) {
            targetBundle = bundles[0];
        }

        if (!targetBundle) {
            return {
                reply: `Which Special Occasion should I delete? Your active occasions are: **${bundles.map(b => b.name).join(', ')}**.`,
                suggestions: bundles.slice(0, 3).map(b => `Delete the ${b.name} special occasion`)
            };
        }

        const ok = await handleDeleteBundle(targetBundle.id);
        if (!ok) {
            return { reply: `Failed to delete Special Occasion **${targetBundle.name}**. Please try again.` };
        }
        return {
            reply: `Deleted Special Occasion **${targetBundle.name}** and released its reserved budget back to your categories.`,
            actionBadge: `Deleted Occasion → ${targetBundle.name}`,
            suggestions: ['Open Occasions & Sandbox', 'Audit my budget']
        };
    }

    // =========================================================================
    // 5. CREATE A SPECIAL OCCASION BUNDLE WITH MULTI-CATEGORY PULLS
    // =========================================================================
    if (/\b(create|make|add|new|start)\b.*\b(special\s+occasion|occasion|bundle)\b/i.test(lower)) {
        if (!onDirectCreateBundle) {
            return { reply: 'Special Occasion creation handler is not connected.' };
        }

        let occasionName = 'Special Occasion';
        const nameMatch = text.match(/\b(?:named|called|titled)\s+([a-zA-Z0-9\s'-]+?)(?=\s+(?:and\s+it|that\s+takes|taking|takes|pulling|pulls|with\b|from\b)|\s+\d|[,.]|$)/i);
        if (nameMatch && nameMatch[1]) {
            occasionName = nameMatch[1].trim();
        }

        const allocations = {};
        const splitSummary = [];
        const pairRegex = /[$€£]?\s*(\d+(?:[.,]\d+)*)(?!\d)\s*(?:dollars?|mad|dhs?|euros?)?\s*(?:from|in|out\s+of|off)\s+([a-zA-Z]+)\b/gi;
        let match;
        while ((match = pairRegex.exec(text)) !== null) {
            const amt = parseMoneyAmount(match[1]);
            if (isNaN(amt) || amt <= 0) {
                return {
                    reply: `Invalid allocation amount **"${match[1]}"**. Please provide a valid positive amount with at most 2 decimal places.`
                };
            }
            const catWord = match[2];
            const matchedCat = categories.find(c =>
                c.name.toLowerCase() === catWord.toLowerCase() ||
                c.name.toLowerCase().startsWith(catWord.toLowerCase().replace(/s$/, ''))
            );
            if (matchedCat) {
                allocations[matchedCat.id] = Number(((allocations[matchedCat.id] || 0) + amt).toFixed(2));
                splitSummary.push(`**${formatCurrency(amt)}** from **${matchedCat.name}**`);
            }
        }

        if (Object.keys(allocations).length === 0) {
            return {
                reply: `To create the **${occasionName}** occasion, tell me how much to reserve from your categories—for example: *"Create a special occasion named Trip and it takes 2000 from Wants and 1000 from Needs"*.`
            };
        }

        const res = await onDirectCreateBundle({ name: occasionName, allocations });
        if (!res.ok) {
            return {
                reply: res.error,
                actionBadge: 'Occasion Blocked → Pool Limit',
                suggestions: ['Audit my budget', 'How much is left in each category?']
            };
        }

        const totalReserved = Object.values(allocations).reduce((s, v) => s + v, 0);
        return {
            reply: `Created Special Occasion **${res.bundle.name}** with a total pool of **${formatCurrency(totalReserved)}** (${splitSummary.join(' + ')})!`,
            actionBadge: `Occasion Created → ${res.bundle.name} (${formatCurrency(totalReserved)})`,
            suggestions: ['Open Occasions & Sandbox', `Delete the ${res.bundle.name} special occasion`, 'Audit my budget']
        };
    }

    // =========================================================================
    // 6. CREATE A SANDBOX CALCULATION SHEET
    // =========================================================================
    if (/\b(create|make|add|new)\b.*\b(sandbox|calculation\s+sheet|temp\s+sheet)\b/i.test(lower)) {
        if (!onDirectCreateSandbox) {
            return { reply: 'Sandbox creation handler is not connected.' };
        }

        const nameMatch = text.match(/\b(?:named|called|titled)\s+([a-zA-Z0-9\s'-]+?)(?=\s+(?:with\b|having\b|budget\b|of\b|at\b|for\b)|\s+[$€£]?\d|[,.]|$)/i);
        const amtMatch = text.match(MONEY_TOKEN_REGEX);
        const rawTitle = nameMatch?.[1]?.trim() || 'Sandbox Plan';
        const sheetTitle = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
        const budgetAmt = amtMatch ? parseMoneyAmount(amtMatch[1]) : NaN;

        if (isNaN(budgetAmt) || budgetAmt <= 0) {
            return {
                reply: 'Please include a valid master budget amount (up to 2 decimal places), e.g., *"Create a sandbox sheet named Home office with a budget of 8000"*.'
            };
        }

        const res = await onDirectCreateSandbox({ title: sheetTitle, totalBudget: budgetAmt });
        if (!res.ok) return { reply: res.error };

        return {
            reply: `Created Sandbox Sheet **${sheetTitle}** with a master budget of **${formatCurrency(budgetAmt)}**!`,
            actionBadge: `Sandbox → ${sheetTitle} (${formatCurrency(budgetAmt)})`,
            suggestions: ['Open Occasions & Sandbox', `Delete the ${sheetTitle} sandbox sheet`, 'Audit my budget']
        };
    }

    // =========================================================================
    // 7. CREATE A WEALTH OBJECTIVE
    // =========================================================================
    if (/\b(create|make|add|new)\b.*\b(wealth\s+objective|objective)\b/i.test(lower) && setWealthObjectives) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        const nameMatch = text.match(/\b(?:named|called|titled)\s+([a-zA-Z0-9\s'-]+?)(?=\s+(?:for\b|with\b|costing\b|cost\b|target\b|at\b|pulling\b|and\s+it\b)|\s+[$€£]?\d|[,.]|$)/i);
        const rawObjTitle = nameMatch?.[1]?.trim() || 'Wealth Objective';
        const objTitle = rawObjTitle.charAt(0).toUpperCase() + rawObjTitle.slice(1);

        const rawTokens = [...text.matchAll(/[$€£]?\s*(\d+(?:[.,]\d+)*)(?!\d)/g)].map(m => m[1]);
        const targetCost = rawTokens.length > 0 ? parseMoneyAmount(rawTokens[0]) : NaN;

        if (isNaN(targetCost) || targetCost <= 0) {
            return { reply: 'Please include a valid target cost for your objective, e.g., *"Create a wealth objective named Car Chevy for 240000"*.' };
        }

        const autoPulls = {};
        const pairRegex = /[$€£]?\s*(\d+(?:[.,]\d+)*)(?!\d)\s*(?:from|in)\s+([a-zA-Z]+)\b/gi;
        let match;
        while ((match = pairRegex.exec(text)) !== null) {
            const amt = parseMoneyAmount(match[1]);
            if (isNaN(amt) || amt <= 0) {
                return { reply: `Invalid auto-pull amount **"${match[1]}"**. Please provide a valid positive amount.` };
            }
            const catWord = match[2];
            const matchedCat = categories.find(c => c.name.toLowerCase().startsWith(catWord.toLowerCase().replace(/s$/, '')));
            if (matchedCat) autoPulls[matchedCat.id] = amt;
        }

        const newObj = {
            id: crypto.randomUUID(),
            name: objTitle,
            targetAmount: targetCost,
            manualSaved: 0,
            autoPulls,
            appliedMonths: [],
            history: [],
            createdAt: getToday()
        };

        setWealthObjectives(prev => [newObj, ...prev]);
        return {
            reply: `Created Wealth Objective **${objTitle}** with a target of **${formatCurrency(targetCost)}** inside your **Portfolio** tab!`,
            actionBadge: `Objective → ${objTitle} (${formatCurrency(targetCost)})`,
            suggestions: ['Open Portfolio', `Delete the ${objTitle} wealth objective`, 'Audit my budget']
        };
    }

    // =========================================================================
    // 8. ONE-MONTH INCOME BOOST (Distinguishes gift expenses from income boosts!)
    // =========================================================================
    if (/\b(clear|remove|reset)\b.*\b(boost|bonus|extra\s+income|income\s+gift)\b/i.test(lower) && handleClearMonthlyBoost) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        handleClearMonthlyBoost();
        return {
            reply: `Cleared the temporary income boost for **${selectedMonth}**. Your monthly income is back to your base salary.`,
            actionBadge: `Reset ${selectedMonth} Boost`,
            suggestions: ['Audit my budget']
        };
    }

    const mentionsBoostWord = /\b(gift|bonus|boost|extra\s+income|extra\s+money)\b/i.test(lower);
    if (mentionsBoostWord && handleAddMonthlyBoost) {
        const hasExplicitIncomeContext =
            /\b(income\s+boost|salary\s+boost|boost\s+(?:my\s+)?(?:income|salary)|extra\s+income|extra\s+money|(?:to|into|for)\s+(?:my\s+|this\s+month'?s?\s+)?(?:income|salary|paycheck)|gifted\s+me)\b/i.test(lower) ||
            (/\b(?:boost|bonus|gift)\b/i.test(lower) && /\b(?:income|salary|paycheck)\b/i.test(lower));

        const hasExpensePurchaseVerb = /\b(spent|paid|bought|purchase|purchased|log|record|save|fill|prefill)\b/i.test(lower);
        const strippedForCatCheck = lower.replace(/^(?:please\s+|can\s+you\s+)?(?:add|log|record|save|spent|paid|bought|fill|prefill)\b\s*/i, '');
        const hasCategoryTarget = Boolean(findCategoryInText(strippedForCatCheck));
        const isClearGiftExpense = !hasExplicitIncomeContext && (hasExpensePurchaseVerb || hasCategoryTarget);

        if (!isClearGiftExpense) {
            if (isReadOnly) {
                return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
            }
            const amtMatch = text.match(MONEY_TOKEN_REGEX);
            const boostVal = amtMatch ? parseMoneyAmount(amtMatch[1]) : NaN;

            if (hasExplicitIncomeContext) {
                if (!isNaN(boostVal) && boostVal > 0) {
                    handleAddMonthlyBoost(boostVal);
                    return {
                        reply: `Added a temporary **+${formatCurrency(boostVal)}** income boost for **${selectedMonth} only**! Your total income for **${selectedMonth}** is now **${formatCurrency(parsedSalary + boostVal)}**, and next month will automatically revert to your base salary.`,
                        actionBadge: `+${formatCurrency(boostVal)} (${selectedMonth} Only)`,
                        suggestions: ["Clear this month's income boost", 'Audit my budget']
                    };
                }
            } else if (/\b(gift|bonus)\b/i.test(lower) && !isNaN(boostVal) && boostVal > 0) {
                // Ambiguous gift/bonus command: ask for clarification before altering income or expenses
                const defaultExpCat = categories.find(c => c.type !== 'asset')?.name || 'Wants';
                return {
                    reply: `Would you like me to add **${formatCurrency(boostVal)}** as a **temporary income boost** for **${selectedMonth}**, or log it as a **gift expense**?\n\n• For income: *"Add a ${boostVal} gift to my income for this month"*\n• For an expense: *"Log ${boostVal} for gift in ${defaultExpCat}"*`,
                    suggestions: [
                        `Add a ${boostVal} gift to my income for this month`,
                        `Log ${boostVal} for gift in ${defaultExpCat}`
                    ]
                };
            }
        }
    }

    // =========================================================================
    // 9. CREATE / DELETE / RENAME A CATEGORY (Strictly separated from expense commands!)
    // =========================================================================
    const isExplicitCreateCategory =
        /\b(?:create|add|make|new)\s+(?:a\s+)?(?:new\s+)?(?:wealth\s+asset\s+|asset\s+|expense\s+)?category\b/i.test(lower) &&
        !/\b(?:expense|transaction|item|purchase)\b/i.test(lower.split(/\bcategory\b/i)[0]);

    if (isExplicitCreateCategory) {
        if (!onDirectCreateCategory) {
            return { reply: 'Category creation handler is not connected.' };
        }

        const isAssetType = /\b(wealth|asset|saving|savings|investment|invest|portfolio)\b/i.test(lower);
        const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/i);
        const requestedPct = pctMatch ? parseFloat(pctMatch[1]) : 0;

        const goalMatch = text.match(/\b(?:goal|target)\s*(?:of|is|to|:)?\s*[$€£]?\s*(\d+(?:[.,]\d+)*)(?!\d)/i);
        const requestedGoal = goalMatch ? parseMoneyAmount(goalMatch[1]) : 0;

        let extractedName = '';
        const namedMatch = text.match(/\b(?:named|called|titled)\s+([a-zA-Z0-9\s&'+!-]+?)(?=\s*(?:,|\bit'?s\b|\bits\b|\bit\s+is\b|\bas\s+a\b|\bwhich\s+is\b|\btype\b|\bwealth\b|\basset\b|\bexpense\b|\bgive\s+it\b|\bwith\b|\bat\b|\d+\s*%|$))/i);
        if (namedMatch && namedMatch[1]) {
            extractedName = namedMatch[1].trim();
        } else {
            const afterCatMatch = text.match(/\bcategory\s+([a-zA-Z0-9\s&'+!-]+?)(?=\s*(?:,|\bit'?s\b|\bits\b|\bit\s+is\b|\bas\s+a\b|\bwhich\s+is\b|\btype\b|\bwealth\b|\basset\b|\bexpense\b|\bgive\s+it\b|\bwith\b|\bat\b|\d+\s*%|$))/i);
            if (afterCatMatch && afterCatMatch[1]) {
                extractedName = afterCatMatch[1].replace(/^(?:named|called|for|to)\s+/i, '').trim();
            }
        }

        if (!extractedName) {
            return {
                reply: 'What would you like to name the new category? Try saying: *"Create a new category named Savings, it\'s a wealth asset give it 25%"*.'
            };
        }

        const formattedCatName = extractedName.charAt(0).toUpperCase() + extractedName.slice(1);
        const res = await onDirectCreateCategory({
            name: formattedCatName,
            type: isAssetType ? 'asset' : 'expense',
            percentage: requestedPct,
            targetGoal: isNaN(requestedGoal) ? 0 : requestedGoal
        });

        if (!res.ok) {
            return {
                reply: res.error,
                actionBadge: 'Category Creation Failed',
                suggestions: ['Audit my budget']
            };
        }

        const finalPct = Math.round(res.category.percentage || 0);
        return {
            reply: `Created your new **${isAssetType ? 'Wealth Asset' : 'Expense'}** category **${res.category.name}** with **${finalPct}%** allocation (${formatCurrency(parsedSalary * (finalPct / 100))}/mo)!`,
            actionBadge: `Created → ${res.category.name} (${finalPct}%)`,
            suggestions: ['Smart lock my board', 'Audit my budget']
        };
    }

    // Only delete a category when the command explicitly targets a category and does NOT mention an expense/item
    const isExplicitDeleteCategory =
        /\b(?:delete|remove)\s+(?:the\s+)?(?:category\b|[a-z0-9\s&'+!-]+?\s+category\b)/i.test(lower) &&
        !/\b(?:expense|expenses|transaction|item|purchase|from\s+category|in\s+category|under\s+category)\b/i.test(lower);

    if (isExplicitDeleteCategory) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        const targetCat = findCategoryInText(lower);
        if (!targetCat) {
            return { reply: `Which category would you like to delete? Your current categories are: **${categories.map(c => c.name).join(', ')}**.` };
        }
        if (categories.length <= 1) {
            return { reply: 'You must keep at least one category in your budget, so I cannot delete your final category.' };
        }
        const ok = await handleDeleteCategory(targetCat.id, targetCat.percentage);
        if (!ok) {
            return { reply: `Failed to delete category **${targetCat.name}**. Please try again.` };
        }
        return {
            reply: `Deleted the **${targetCat.name}** category and redistributed its **${Math.round(targetCat.percentage)}%** allocation.`,
            actionBadge: `Deleted Category → ${targetCat.name}`,
            suggestions: ['Audit my budget', 'Smart lock my board']
        };
    }

    const renameCatMatch = text.match(/\b(?:rename|change)\s+(?:the\s+)?category\s+([a-zA-Z0-9\s&'+!-]+?)\s+to\s+([a-zA-Z0-9\s&'+!-]+)$/i);
    if (renameCatMatch && handleUpdateCategory) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        const targetCat = findCategoryInText(renameCatMatch[1]);
        const newCatName = renameCatMatch[2].trim();
        if (targetCat && newCatName) {
            const ok = await handleUpdateCategory(targetCat.id, newCatName, targetCat.target_goal || 0);
            if (!ok) {
                return { reply: `Failed to rename category **${targetCat.name}**. Please try again.` };
            }
            return {
                reply: `Renamed category **${targetCat.name}** to **${newCatName}**.`,
                actionBadge: `Renamed → ${newCatName}`,
                suggestions: ['Audit my budget']
            };
        }
    }

    // =========================================================================
    // 10. REMOVE / DELETE / UNDO AN EXPENSE
    // Distinguishes cross-month lastAddedExpenseId and verifies created_at timestamps
    // =========================================================================
    if (/\b(remove|delete|undo|erase|cancel)\b.*\b(expense|expenses|transaction|item|purchase|last|latest|recent)\b/i.test(lower) || /\b(remove|delete)\s+the\s+last\b/i.test(lower)) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        if (!handleDeleteExpense || monthlyExpenses.length === 0) {
            return { reply: `You don't have any expenses in **${selectedMonth}** to remove.` };
        }

        const isLastIntent = /\b(last|latest|recent|previous|just\s+added|i\s+added)\b/i.test(lower);
        let targetExp = null;

        if (isLastIntent) {
            if (lastAddedExpenseId) {
                targetExp = monthlyExpenses.find(e => String(e.id) === String(lastAddedExpenseId)) || null;
                if (!targetExp && Array.isArray(expenses) && expenses.length > 0) {
                    const otherMonthExp = expenses.find(e => String(e.id) === String(lastAddedExpenseId));
                    if (otherMonthExp) {
                        const otherMonth = (otherMonthExp.expense_date || '').slice(0, 7) || 'another month';
                        return {
                            reply: `Your last-added expense (**${otherMonthExp.name}** • ${formatCurrency(otherMonthExp.cost)}) was recorded in **${otherMonth}**, not **${selectedMonth}**. Switch to **${otherMonth}** to remove it, or tell me the exact name of an expense in **${selectedMonth}** (e.g., *"Remove ${monthlyExpenses[0].name}"*).`,
                            suggestions: [`Switch month to ${otherMonth}`, `Remove ${monthlyExpenses[0].name}`]
                        };
                    }
                }
            }

            if (!targetExp) {
                // Verify all monthlyExpenses have valid created_at timestamps before using creation-order fallback
                const allHaveValidCreatedAt = monthlyExpenses.every(
                    e => Boolean(e.created_at) && !Number.isNaN(Date.parse(e.created_at))
                );
                if (!allHaveValidCreatedAt && monthlyExpenses.length > 1) {
                    return {
                        reply: `Creation timestamps are still syncing for some expenses in **${selectedMonth}**. Please specify the expense name you want to remove (for example: *"Remove ${monthlyExpenses[0].name}"*).`,
                        suggestions: monthlyExpenses.slice(0, 3).map(e => `Remove ${e.name}`)
                    };
                }
                const byCreationOrder = [...monthlyExpenses].sort(
                    (a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)
                );
                targetExp = byCreationOrder[0];
            }
        } else {
            const sortedExps = [...monthlyExpenses].sort((a, b) => b.name.length - a.name.length);
            targetExp = sortedExps.find(e => lower.includes(e.name.toLowerCase()));
        }

        if (!targetExp) {
            return {
                reply: `Which expense would you like me to remove? Say *"Remove the last expense I added"* or *"Remove ${monthlyExpenses[0].name}"*.`,
                suggestions: ['Remove the last expense I added', 'How many expenses do I have this month?']
            };
        }

        const ok = await handleDeleteExpense(targetExp.id);
        if (!ok) {
            return { reply: `Failed to remove **${targetExp.name}**. Please try again.` };
        }
        return {
            reply: `Removed **${targetExp.name}** (${formatCurrency(targetExp.cost)}) from **${targetExp.category}**. That **${formatCurrency(targetExp.cost)}** is back in your available balance!`,
            actionBadge: `Removed → ${targetExp.name} (${formatCurrency(targetExp.cost)})`,
            suggestions: ['How many expenses do I have this month?', 'Audit my budget']
        };
    }

    // =========================================================================
    // 11. RENAME AN EXPENSE
    // =========================================================================
    const renameExpMatch = text.match(/\b(?:rename|change\s+the\s+name\s+of)\s+(?:the\s+)?(?:expense\s+)?(.+?)\s+to\s+([a-zA-Z0-9\s']+)$/i);
    if (renameExpMatch && handleUpdateExpense && !/\bcategory\b/i.test(lower)) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        }
        const searchName = renameExpMatch[1].trim().toLowerCase();
        const newName = renameExpMatch[2].trim();
        const targetExp = monthlyExpenses.find(e => e.name.toLowerCase().includes(searchName) || searchName.includes(e.name.toLowerCase()));
        if (targetExp && newName) {
            const ok = await handleUpdateExpense(targetExp.id, {
                ...targetExp,
                name: newName.charAt(0).toUpperCase() + newName.slice(1)
            });
            if (!ok) {
                return { reply: `Failed to update **${targetExp.name}**. Please try again.` };
            }
            return {
                reply: `Updated expense name from **${targetExp.name}** to **${newName.charAt(0).toUpperCase() + newName.slice(1)}**.`,
                actionBadge: `Edited → ${newName}`,
                suggestions: ['How many expenses do I have this month?', 'Audit my budget']
            };
        }
    }

    // =========================================================================
    // 12. CHANGE CURRENCY / SALARY / MONTH / THEME / TAB / LOCKS
    // =========================================================================
    if (/\b(currency)\b/i.test(lower) || /\b(?:change|set|switch|use)\s+(?:my\s+)?currency\b/i.test(lower)) {
        if (!setCurrency) return { reply: 'Currency setting handler is not connected.' };

        let newCurr = null;
        if (/\b(mad|dirhams?|dhs?)\b/i.test(lower)) newCurr = 'MAD';
        else if (/\b(usd|dollars?|\$)\b/i.test(lower) || text.includes('$')) newCurr = '$';
        else if (/\b(eur|euros?|€)\b/i.test(lower) || text.includes('€')) newCurr = '€';
        else if (/\b(gbp|pounds?|£)\b/i.test(lower) || text.includes('£')) newCurr = '£';
        else if (/\b(none|no\s+currency|blank)\b/i.test(lower)) newCurr = '';
        else {
            const customMatch = text.match(/\b(?:to|as|into)\s+([A-Za-z$€£¥]{1,5})\b/i);
            if (customMatch) newCurr = customMatch[1].toUpperCase();
        }

        if (newCurr !== null) {
            setCurrency(newCurr);
            if (setCurrencyMode && setCustomCurrency) {
                if (['$', '€', '£', 'MAD'].includes(newCurr)) setCurrencyMode(newCurr);
                else if (newCurr === '') setCurrencyMode('none');
                else {
                    setCurrencyMode('custom');
                    setCustomCurrency(newCurr);
                }
            }
            return {
                reply: `Changed your workspace currency to **${newCurr || 'None'}**.`,
                actionBadge: `Currency → ${newCurr || 'None'}`,
                suggestions: ['Audit my budget', 'How much can I spend per day?']
            };
        }
    }

    const salaryCmdMatch = text.match(/\b(?:set|change|update|make)\s+(?:my\s+)?(?:monthly\s+)?(?:salary|income|paycheck)\s+(?:to|as|at)?\s*[$€£]?\s*(\d+(?:[.,]\d+)*)(?!\d)/i);
    if (salaryCmdMatch && setSalary) {
        const newSal = parseMoneyAmount(salaryCmdMatch[1]);
        if (isNaN(newSal) || newSal < 0) {
            return { reply: 'Please enter a valid salary amount (with up to 2 decimal places).' };
        }
        setSalary(newSal.toString());
        return {
            reply: `Updated your base monthly salary to **${formatCurrency(newSal)}**!`,
            actionBadge: `Salary → ${formatCurrency(newSal)}`,
            suggestions: ['Audit my budget', 'How much can I spend per day?']
        };
    }

    const monthMatch = text.match(/\b(?:switch|go|change|set)\s+(?:month\s+)?to\s+(\d{4}-\d{2})\b/i);
    if (monthMatch && setSelectedMonth) {
        const monthNum = Number(monthMatch[1].slice(5));
        if (monthNum < 1 || monthNum > 12) {
            return { reply: 'Enter a month from 01 to 12 (for example: *"Switch month to 2026-11"*).' };
        }
        setSelectedMonth(monthMatch[1]);
        return {
            reply: `Switched your active budget view to **${monthMatch[1]}**.`,
            actionBadge: `Month → ${monthMatch[1]}`,
            suggestions: ['Audit my budget']
        };
    }

    if (/\b(?:from\s+light\s+to\s+dark|to\s+dark\s+mode|to\s+dark\s+theme|enable\s+dark|turn\s+on\s+dark|dark\s+mode)\b/i.test(lower) && !/\bto\s+light\b/i.test(lower)) {
        if (theme !== 'dark') setTheme('dark');
        return {
            reply: 'Switched your workspace to **Dark Mode**.',
            actionBadge: 'Theme → Dark',
            suggestions: ['Switch to light mode', 'Audit my budget']
        };
    }
    if (/\b(?:from\s+dark\s+to\s+light|to\s+light\s+mode|to\s+light\s+theme|enable\s+light|turn\s+on\s+light|light\s+mode)\b/i.test(lower)) {
        if (theme !== 'light') setTheme('light');
        return {
            reply: 'Switched your workspace to **Light Mode**.',
            actionBadge: 'Theme → Light',
            suggestions: ['Switch to dark mode', 'Audit my budget']
        };
    }

    const navMap = [
        { tab: 'taxes', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(tax|taxes|tax\s+center)\b/i, label: 'Tax Center' },
        { tab: 'portfolio', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(portfolio|wealth|assets|investments)\b/i, label: 'Portfolio' },
        { tab: 'occasions', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(occasions?|bundles?|sandbox|planner)\b/i, label: 'Occasions & Sandbox' },
        { tab: 'history', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(history|ledger|timeline)\b/i, label: 'History' },
        { tab: 'settings', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(settings|preferences|export)\b/i, label: 'Settings' },
        { tab: 'support', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(support|help|tickets?)\b/i, label: 'Support' },
        { tab: 'cashflow', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(cash\s*flow|dashboard|home|budget)\b/i, label: 'Cash Flow' }
    ];
    for (const nav of navMap) {
        if (nav.regex.test(lower)) {
            setActiveTab(nav.tab);
            return {
                reply: `Opened the **${nav.label}** tab for you.`,
                actionBadge: `Navigated → ${nav.label}`,
                suggestions: ['Audit my budget', 'How much can I spend per day?']
            };
        }
    }

    if (/\b(smart\s*lock|auto\s*balance|balance\s+my\s+board|lock\s+all|lock\s+board)\b/i.test(lower)) {
        if (isReadOnly) return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        handleSmartLockAll();
        return {
            reply: 'Executed **Smart Lock Board**—your categories are now balanced to 100% and locked.',
            actionBadge: 'Action → Smart Lock Board',
            suggestions: ['Unlock all categories', 'Audit my budget']
        };
    }
    if (/\b(unlock\s+all|unlock\s+categories|unlock\s+board)\b/i.test(lower)) {
        if (isReadOnly) return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        handleUnlockAll();
        return {
            reply: 'Unlocked all budget categories so you can adjust the allocation sliders.',
            actionBadge: 'Action → Unlock All',
            suggestions: ['Smart lock my board', 'Audit my budget']
        };
    }

    if (/^(?:please\s+)?(lock|unlock)\s+([a-zA-Z\s]+)$/i.test(lower) && toggleIndividualLock) {
        if (isReadOnly) return { reply: `The ledger for **${selectedMonth}** is closed and read-only.` };
        const isUnlock = /^unlock/i.test(lower);
        const targetCat = findCategoryInText(lower);
        if (targetCat) {
            const currentlyLocked = lockedCategories.includes(targetCat.id);
            if ((isUnlock && currentlyLocked) || (!isUnlock && !currentlyLocked)) {
                toggleIndividualLock(targetCat.id);
            }
            return {
                reply: `**${targetCat.name}** is now **${isUnlock ? 'Unlocked' : 'Locked'}**.`,
                actionBadge: `${isUnlock ? 'Unlocked' : 'Locked'} → ${targetCat.name}`,
                suggestions: ['Audit my budget']
            };
        }
    }

    const pctChangeMatch = text.match(/\b(?:set|change|move|adjust|make|give)\s+([a-z\s]+?)\s+(?:to|at)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (pctChangeMatch) {
        if (isReadOnly) return { reply: `Cannot adjust category percentages because **${selectedMonth}** is read-only.` };
        const targetCat = findCategoryInText(pctChangeMatch[1]);
        const newPct = parseFloat(pctChangeMatch[2]);
        if (targetCat && !isNaN(newPct) && newPct >= 0 && newPct <= 100) {
            handleSliderChange(targetCat.id, newPct);
            return {
                reply: `Adjusted **${targetCat.name}** allocation to **${newPct}%** (${formatCurrency(parsedSalary * (newPct / 100))}) and rebalanced your unlocked categories.`,
                actionBadge: `Allocation → ${targetCat.name} ${newPct}%`,
                suggestions: ['Smart lock my board', 'Audit my budget']
            };
        }
    }

    // =========================================================================
    // 13. LOG OR PRE-FILL AN EXPENSE (Allows category qualifiers like "category Needs")
    // =========================================================================
    const isLogIntent = /^(?:please\s+|can\s+you\s+)?(?:add|log|record|save|spent|paid|bought|fill|prefill)\b/i.test(lower);
    const hasNumber = /\d+/.test(lower);
    if (isLogIntent && hasNumber && !/\b(tax|afford|if\s+i|how\s+many|how\s+much|salary|currency|occasion|sandbox|objective)\b/i.test(lower)) {
        if (isReadOnly) {
            return { reply: `The ledger for **${selectedMonth}** is locked. Switch to the current open month to log expenses.` };
        }

        const isPrefillOnly = /^(?:please\s+|can\s+you\s+)?(?:fill|prefill)\b/i.test(lower);
        const recFlag = /\b(recurring|monthly|daily|yearly|every\s+month)\b/i.test(lower);
        const batchFlag = /\b(batch|batched|month\s+end)\b/i.test(lower);

        // Exclude leading logging verb (e.g. "save") before looking up category
        const categoryText = lower.replace(/^(?:please\s+|can\s+you\s+)?(?:add|log|record|save|spent|paid|bought|fill|prefill)\b\s*/i, '');
        const matchedCat = findCategoryInText(categoryText) || categories.find(c => c.type !== 'asset') || categories[0];
        const amtMatch = text.match(MONEY_TOKEN_REGEX);
        const costVal = amtMatch ? parseMoneyAmount(amtMatch[1]) : NaN;

        if (!matchedCat || isNaN(costVal) || costVal <= 0) {
            return {
                reply: 'Please include both an item name and a valid positive amount with at most 2 decimal places (for example: *"Log 45 for coffee in Wants"*).'
            };
        }

        const escapedCatName = escapeRegExp(matchedCat.name);
        let cleanItem = text
            .replace(amtMatch[0], ' ')
            .replace(new RegExp(`(^|\\W)${escapedCatName}(?=$|\\W)`, 'gi'), '$1 ')
            .replace(/\b(please|can\s+you|add|log|record|save|spent|paid|bought|fill|prefill|recurring|recuring|monthly|daily|yearly|every\s+month|batch|batched|at\s+month\s+end|month\s+end)\b/gi, ' ')
            .replace(/\b(expenses?|expences?|transactions?|items?|purchases?|named|called)\b/gi, ' ')
            .replace(/\b(dollars?|usd|dirhams?|mad|dhs?|euros?|eur|pounds?|gbp|bucks)\b/gi, ' ')
            .replace(/\b(in|under|into|for|on|at|to|from|with|of|category|bucket|a|an|the|my)\b/gi, ' ')
            .replace(/[.,!?;:$/€£]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        cleanItem = cleanItem
            ? cleanItem.charAt(0).toUpperCase() + cleanItem.slice(1)
            : 'Expense';

        if (isPrefillOnly && onPrefillExpense) {
            onPrefillExpense({
                name: cleanItem,
                cost: costVal.toString(),
                categoryId: matchedCat.id,
                isRecurring: recFlag,
                isBatched: batchFlag
            });
            return {
                reply: `Pre-filled the Log Expense form with **${cleanItem}** (${formatCurrency(costVal)}) under **${matchedCat.name}**.`,
                actionBadge: `Form Filled → ${cleanItem}`,
                suggestions: ['Audit my budget', 'How many expenses do I have this month?']
            };
        }

        if (onDirectLogExpense) {
            const result = await onDirectLogExpense({
                name: cleanItem,
                cost: costVal,
                categoryId: matchedCat.id,
                expenseDate: getExpenseDateForActiveMonth(),
                isRecurring: recFlag,
                isBatched: batchFlag
            });

            if (!result.ok) {
                return {
                    reply: result.error,
                    actionBadge: 'Blocked → Budget Ceiling',
                    suggestions: ['Audit my budget', 'How much is left in each category?']
                };
            }

            return {
                reply: `Logged **${cleanItem}** for **${formatCurrency(costVal)}** under **${matchedCat.name}**${recFlag ? ' (Recurring)' : ''}${batchFlag ? ' (Batched)' : ''}. You now have **${formatCurrency(result.newRemaining)}** left in **${matchedCat.name}**.`,
                actionBadge: `Saved → ${cleanItem} (${formatCurrency(costVal)})`,
                suggestions: ['Remove the last expense I added', 'How many expenses do I have this month?', 'Audit my budget']
            };
        }
    }

    // =========================================================================
    // 14. ANALYST ENGINE: DAILY SAFE-SPEND PACE
    // =========================================================================
    if (/\b(per\s+day|daily|a\s+day|safe\s+to\s+spend|burn\s+rate|pace)\b/i.test(lower)) {
        const now = new Date();
        const [selYear, selMonth] = (selectedMonth || getToday().slice(0, 7)).split('-').map(Number);
        const daysInMonth = new Date(selYear, selMonth, 0).getDate();
        const isCurrentMonth = now.getFullYear() === selYear && (now.getMonth() + 1) === selMonth;
        const daysLeft = isCurrentMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;

        const dailyTotal = totalRemaining / daysLeft;
        const expCats = categories.filter(c => c.type !== 'asset');
        const breakdownLines = expCats.map(c => {
            const { remaining } = getCategoryStats(c);
            return `• **${c.name}:** **${formatCurrency(remaining / daysLeft)}/day** *(${formatCurrency(remaining)} remaining for the next ${daysLeft} days)*`;
        }).join('\n');

        return {
            reply: `With **${daysLeft} day${daysLeft === 1 ? '' : 's'}** left in **${selectedMonth}**, you can safely spend **${formatCurrency(dailyTotal)} per day** without exceeding your budget.\n\n**Daily Allowance by Category:**\n${breakdownLines}`,
            actionBadge: `${formatCurrency(dailyTotal)} / day`,
            suggestions: ['Audit my budget', 'What are my biggest expenses?']
        };
    }

    // =========================================================================
    // 15. SPECIFIC QUESTION: RECURRING OR BATCHED EXPENSES
    // =========================================================================
    if (/\b(what|which|show|list|how\s+many)\b.*\b(recurring|batched)\b/i.test(lower)) {
        const checkBatched = /\bbatched\b/i.test(lower);
        const filtered = monthlyExpenses.filter(e => checkBatched ? e.is_batched : e.is_recurring);
        const label = checkBatched ? 'Batched' : 'Recurring';

        if (filtered.length === 0) {
            return {
                reply: `You currently have **0 ${label.toLowerCase()} expenses** in **${selectedMonth}**.`,
                actionBadge: `0 ${label} Expenses`,
                suggestions: ['How many expenses do I have this month?', 'Audit my budget']
            };
        }

        const total = filtered.reduce((s, e) => s + parseFloat(e.cost || 0), 0);
        const lines = filtered.map((e, i) => `${i + 1}. **${e.name}** — ${formatCurrency(e.cost)} *(${e.category})*`).join('\n');
        return {
            reply: `You have **${filtered.length} ${label} expense${filtered.length === 1 ? '' : 's'}** in **${selectedMonth}** totaling **${formatCurrency(total)}**:\n\n${lines}`,
            actionBadge: `${filtered.length} ${label} (${formatCurrency(total)})`,
            suggestions: ['Audit my budget', 'How much can I spend per day?']
        };
    }

    // =========================================================================
    // 16. SPECIFIC QUESTION: "HOW MANY EXPENSES / TRANSACTIONS DO I HAVE?"
    // =========================================================================
    if (/\b(how\s+many|count|number\s+of|list\s+my|what\s+are\s+my|show\s+my)\s+(?:expenses|transactions|items|purchases)\b/i.test(lower) || /\bexpenses\s+do\s+i\s+have\b/i.test(lower)) {
        const targetCat = findCategoryInText(lower);
        const list = targetCat
            ? monthlyExpenses.filter(e => e.category_id === targetCat.id)
            : monthlyExpenses;

        if (list.length === 0) {
            return {
                reply: targetCat
                    ? `You have **0 expenses** logged under **${targetCat.name}** in **${selectedMonth}**.`
                    : `You have **0 expenses** logged in **${selectedMonth}** so far.`,
                actionBadge: '0 Transactions',
                suggestions: ['Log 35 for coffee in Wants', 'Audit my budget']
            };
        }

        const totalAmt = list.reduce((s, e) => s + parseFloat(e.cost || 0), 0);
        const previewItems = list
            .slice(0, 6)
            .map((e, i) => `${i + 1}. **${e.name}** — ${formatCurrency(e.cost)} *(${e.category} • ${e.expense_date}${e.is_recurring ? ' • Recurring' : ''}${e.is_batched ? ' • Batched' : ''})*`)
            .join('\n');

        return {
            reply: `You have **${list.length} expense${list.length === 1 ? '' : 's'}**${targetCat ? ` in **${targetCat.name}**` : ''} for **${selectedMonth}**, totaling **${formatCurrency(totalAmt)}**:\n\n${previewItems}${list.length > 6 ? `\n\n*...and ${list.length - 6} more.*` : ''}`,
            actionBadge: `${list.length} Expense${list.length === 1 ? '' : 's'} (${formatCurrency(totalAmt)})`,
            suggestions: ['Remove the last expense I added', 'How much can I spend per day?', 'Audit my budget']
        };
    }

    // =========================================================================
    // 17. SPECIFIC QUESTION: "HOW MUCH DID I SPEND?" / "HOW MUCH IS LEFT IN X?"
    // =========================================================================
    if (/\b(how\s+much)\b.*\b(spend|spent|used|left|remaining|have\s+in)\b/i.test(lower)) {
        const targetCat = findCategoryInText(lower);
        if (targetCat) {
            const { allocated, spent, remaining } = getCategoryStats(targetCat);
            const count = monthlyExpenses.filter(e => e.category_id === targetCat.id).length;
            return {
                reply: `**${targetCat.name} (${selectedMonth}):**\n\n• **Allocated Budget:** ${formatCurrency(allocated)} (${Math.round(targetCat.percentage)}%)\n• **Spent So Far:** ${formatCurrency(spent)} across ${count} transaction${count === 1 ? '' : 's'}\n• **Remaining Available:** **${formatCurrency(remaining)}**`,
                actionBadge: `${targetCat.name}: ${formatCurrency(remaining)} left`,
                suggestions: [`Can I afford 100 in ${targetCat.name}?`, 'How much can I spend per day?']
            };
        }

        return {
            reply: `In **${selectedMonth}**, you have spent **${formatCurrency(totalSpent)}** across **${monthlyExpenses.length} transaction${monthlyExpenses.length === 1 ? '' : 's'}**, with **${formatCurrency(totalAutomatedAssets)}** allocated to Wealth Assets and **${formatCurrency(totalRemaining)}** in remaining cash.`,
            actionBadge: `Spent: ${formatCurrency(totalSpent)}`,
            suggestions: ['How much can I spend per day?', 'Audit my budget']
        };
    }

    // =========================================================================
    // 18. ANALYST ENGINE: AFFORDABILITY CHECK
    // =========================================================================
    if (/\b(can\s+i\s+afford|afford|do\s+i\s+have\s+enough\s+for|what\s+if\s+i\s+spend)\b/i.test(lower)) {
        const amtMatch = text.match(MONEY_TOKEN_REGEX);
        const testCost = amtMatch ? parseMoneyAmount(amtMatch[1]) : NaN;
        const targetCat = findCategoryInText(lower);

        if (isNaN(testCost) || testCost <= 0) {
            return {
                reply: `Tell me the amount and category you want to test—for example: *"Can I afford 350 in Wants?"*`
            };
        }

        if (!targetCat) {
            return {
                reply: `Repeat the question with the amount and a category name (for example: *"Can I afford ${formatCurrency(testCost)} in Wants?"*).`,
                suggestions: categories
                    .filter(c => c.type !== 'asset')
                    .slice(0, 3)
                    .map(c => `Can I afford ${testCost} in ${c.name}?`)
            };
        }

        const { remaining, allocated } = getCategoryStats(targetCat);
        if (testCost <= remaining) {
            const afterPurchase = remaining - testCost;
            const pctOfRemaining = remaining > 0 ? Math.round((testCost / remaining) * 100) : 100;
            return {
                reply: `**Yes, you can afford it!**\n\n• **${targetCat.name} Available:** ${formatCurrency(remaining)} (of ${formatCurrency(allocated)})\n• **Purchase Amount:** ${formatCurrency(testCost)} (${pctOfRemaining}% of your remaining ${targetCat.name} pool)\n• **Left After Purchase:** ${formatCurrency(afterPurchase)}`,
                actionBadge: 'Affordability → Approved',
                suggestions: [`Log ${testCost} in ${targetCat.name}`, 'How much can I spend per day?']
            };
        } else {
            const shortfall = testCost - remaining;
            return {
                reply: `**Not inside ${targetCat.name} right now.**\n\n• **${targetCat.name} Available:** ${formatCurrency(remaining)}\n• **Purchase Amount:** ${formatCurrency(testCost)}\n• **Shortfall:** You are short by **${formatCurrency(shortfall)}** in ${targetCat.name}.`,
                actionBadge: 'Affordability → Exceeds Pool',
                suggestions: ['Audit my budget', 'Open Occasions & Sandbox']
            };
        }
    }

    // =========================================================================
    // 19. ANALYST ENGINE: TOP / BIGGEST EXPENSES
    // =========================================================================
    if (/\b(biggest|largest|top|highest|most\s+expensive)\s+(expenses?|purchases?|transactions?|spending)\b/i.test(lower)) {
        if (monthlyExpenses.length === 0) {
            return { reply: `You haven't logged any expenses in **${selectedMonth}** yet.` };
        }
        const sorted = [...monthlyExpenses]
            .sort((a, b) => parseFloat(b.cost) - parseFloat(a.cost))
            .slice(0, 5);
        const listStr = sorted
            .map((e, i) => `${i + 1}. **${e.name}** — ${formatCurrency(e.cost)} *(${e.category || 'Category'} • ${e.expense_date})*`)
            .join('\n');

        return {
            reply: `Here are your **Top ${sorted.length} Expenses** for **${selectedMonth}**:\n\n${listStr}`,
            actionBadge: `Top ${sorted.length} Transactions`,
            suggestions: ['Audit my budget', 'How much can I spend per day?']
        };
    }

    // =========================================================================
    // 20. ANALYST ENGINE: SAVINGS / PORTFOLIO GOAL PROJECTION & OBJECTIVES
    // Uses completed contributions only for Wealth Objectives
    // =========================================================================
    if (/\b(goal|goals|target|portfolio|wealth|net\s+worth|when\s+will\s+i\s+reach|objectives?)\b/i.test(lower)) {
        const assetCats = categories.filter(c => c.type === 'asset');
        const sections = [];

        if (assetCats.length > 0) {
            const catLines = assetCats.map(cat => {
                const monthlySweep = Math.max(0, parsedSalary * ((cat.percentage || 0) / 100));
                const lifetimeSaved = assetAdjustments
                    .filter(a => a.category_id === cat.id)
                    .reduce((s, a) => s + parseFloat(a.amount || 0), 0);
                const goal = parseFloat(cat.target_goal) || 0;

                if (goal <= 0) {
                    return `• **${cat.name}:** ${formatCurrency(lifetimeSaved)} accumulated (+${formatCurrency(monthlySweep)}/mo sweep)`;
                }
                const remainingToGoal = Math.max(0, goal - lifetimeSaved);
                if (remainingToGoal === 0) {
                    return `• **${cat.name}:** Goal of **${formatCurrency(goal)}** reached!`;
                }
                const monthsNeeded = monthlySweep > 0 ? Math.ceil(remainingToGoal / monthlySweep) : null;
                return `• **${cat.name}:** ${formatCurrency(lifetimeSaved)} / ${formatCurrency(goal)} (${monthsNeeded ? `~**${monthsNeeded} months** left at ${formatCurrency(monthlySweep)}/mo` : 'Increase % to project'})`;
            }).join('\n');
            sections.push(`**Portfolio Asset Categories:**\n${catLines}`);
        }

        if (Array.isArray(wealthObjectives) && wealthObjectives.length > 0) {
            const objLines = wealthObjectives.map(o => {
                const autoMo = Object.values(o.autoPulls || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                // Count only completed contributions (history / manualSaved), never unexecuted autoPull config
                const completedFunded = Array.isArray(o.history) && o.history.length > 0
                    ? o.history.reduce((s, h) => s + (parseFloat(h.amount) || 0), 0)
                    : (parseFloat(o.manualSaved) || 0);
                const remainingObj = Math.max(0, (parseFloat(o.targetAmount) || 0) - completedFunded);
                return `• **${o.name}:** ${formatCurrency(completedFunded)} funded of ${formatCurrency(o.targetAmount)} (${formatCurrency(remainingObj)} remaining • ${autoMo > 0 ? `${formatCurrency(autoMo)}/mo auto-pull rule` : 'Manual funding'})`;
            }).join('\n');
            sections.push(`**Wealth Objectives:**\n${objLines}`);
        }

        if (sections.length === 0) {
            return {
                reply: 'You have no Wealth Asset categories or Wealth Objectives yet. Try saying: *"Create a wealth objective named Car Chevy for 240000"*.',
                suggestions: ['Create a wealth objective named Car Chevy for 240000', 'Audit my budget']
            };
        }

        return {
            reply: sections.join('\n\n'),
            actionBadge: 'Wealth & Objectives Forecast',
            suggestions: ['Open Portfolio', 'Audit my budget']
        };
    }

    // =========================================================================
    // 21. ANALYST ENGINE: ACCURATE PROGRESSIVE TAX ESTIMATOR (Reads rawRes.owed first)
    // =========================================================================
    if (/\b(tax|taxes)\b/i.test(lower)) {
        const withoutYear = text.replace(/\b20\d{2}\b/g, ' ');
        const amtMatch = withoutYear.match(MONEY_TOKEN_REGEX);
        const annualIncome = amtMatch ? parseMoneyAmount(amtMatch[1]) : (parsedSalary * 12);

        if (isNaN(annualIncome) || annualIncome <= 0) {
            return {
                reply: 'Enter your monthly salary in **Settings** or ask me *"Estimate tax on 120000"* so I can calculate your progressive tax!',
                suggestions: ['Estimate tax on 120000', 'Open Tax Center']
            };
        }

        const rawRes = calculateProgressiveTax(annualIncome, taxCountry || 'US', taxFilingStatus || 'single');

        let totalTax = 0;
        let netIncome = annualIncome;
        let effectiveRate = 0;

        if (typeof rawRes === 'number') {
            totalTax = rawRes;
            netIncome = Math.max(0, annualIncome - totalTax);
            effectiveRate = annualIncome > 0 ? (totalTax / annualIncome) * 100 : 0;
        } else if (rawRes && typeof rawRes === 'object') {
            const bracketSum = Array.isArray(rawRes.breakdown || rawRes.brackets)
                ? (rawRes.breakdown || rawRes.brackets).reduce((s, b) => s + Number(b.tax ?? b.taxOwed ?? b.amount ?? 0), 0)
                : 0;
            const rawNet = rawRes.netIncome ?? rawRes.netPay ?? rawRes.afterTaxIncome ?? rawRes.takeHome ?? rawRes.net;
            const derivedFromNet = rawNet !== undefined ? Math.max(0, annualIncome - Number(rawNet)) : 0;

            totalTax = Number(
                rawRes.owed ??
                rawRes.totalTax ??
                rawRes.taxOwed ??
                rawRes.tax ??
                rawRes.estimatedTax ??
                rawRes.annualTax ??
                rawRes.taxAmount ??
                (bracketSum > 0 ? bracketSum : derivedFromNet)
            );
            netIncome = rawNet !== undefined ? Number(rawNet) : Math.max(0, annualIncome - totalTax);
            effectiveRate = Number(
                rawRes.effectiveRate ??
                rawRes.effectiveTaxRate ??
                rawRes.rate ??
                (annualIncome > 0 ? (totalTax / annualIncome) * 100 : 0)
            );
        }

        return {
            reply: `**Tax Estimate (${taxCountry || 'US'} • ${(taxFilingStatus || 'single').toUpperCase()}):**\n\n• **Annual Gross Income:** ${formatCurrency(annualIncome)}\n• **Estimated Annual Tax:** ${formatCurrency(totalTax)} (**${effectiveRate.toFixed(1)}%** effective rate)\n• **Annual Net Take-Home:** ${formatCurrency(netIncome)}\n• **Monthly Net Take-Home:** **${formatCurrency(netIncome / 12)}/mo**`,
            actionBadge: `Tax: ${formatCurrency(totalTax)} (${effectiveRate.toFixed(1)}%)`,
            suggestions: ['Open Tax Center', 'Audit my budget']
        };
    }

    // =========================================================================
    // 22. ANALYST ENGINE: FULL BUDGET AUDIT / CATEGORY BREAKDOWN
    // =========================================================================
    if (/\b(audit|summary|overview|status|how\s+am\s+i\s+doing|how\s+is\s+my\s+budget|left|remaining|categories|breakdown|report|expenses|salary|income)\b/i.test(lower)) {
        const catLines = categories.map(c => {
            const { allocated, spent, remaining } = getCategoryStats(c);
            const pctUsed = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
            return `• **${c.name}** (${Math.round(c.percentage || 0)}%${c.type === 'asset' ? ' • Asset' : ''}): **${formatCurrency(remaining)}** left of ${formatCurrency(allocated)} *(${pctUsed}% used)*`;
        }).join('\n');

        return {
            reply: `**Financial Audit for ${selectedMonth}:**\n\n• **Monthly Income:** ${formatCurrency(parsedSalary)}\n• **Total Spent:** ${formatCurrency(totalSpent)} (${monthlyExpenses.length} transaction${monthlyExpenses.length === 1 ? '' : 's'})\n• **Auto-Saved to Assets:** ${formatCurrency(totalAutomatedAssets)}\n• **Available Cash Remaining:** **${formatCurrency(totalRemaining)}**\n\n**Category Breakdown:**\n${catLines}`,
            actionBadge: `${formatCurrency(totalRemaining)} Available`,
            suggestions: ['How much can I spend per day?', 'How many expenses do I have this month?', 'What are my biggest expenses?']
        };
    }

    // =========================================================================
    // 23. DEFAULT HELPFUL GUIDE
    // =========================================================================
    return {
        reply: `I'm **Sterling**, and I can execute actions or analyze your numbers! Try telling me:\n\n• **Expenses:** *"Add waffle 16 in Wants"*, *"Remove the last expense I added"*\n• **Planners & Goals:** *"Create a sandbox sheet named Home office with a budget of 8000"*, *"Delete the Car chevy wealth objective"*\n• **Analysis:** *"How much can I spend per day?"*, *"Estimate tax on 120000"*, *"Audit my budget"*`,
        suggestions: [
            'How much can I spend per day?',
            'Estimate tax on 120000',
            'Audit my budget'
        ]
    };
}