import i18n from '../i18n';
import { calculateProgressiveTax, getToday } from './constants';

/**
 * Normalizes common user spelling typos and maps French, Spanish, and Arabic
 * natural-language commands into canonical intent tokens so all 23 handlers work across languages.
 * @param {string} str - Raw user input string.
 * @returns {string} Lowercased, normalized string.
 */
function normalizeTypos(str) {
    return String(str || '')
        .toLowerCase()
        // Common English typos
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
        // Multilingual Suggestion & Command Phrases -> Canonical Intent Phrases
        .replace(/combien de dépenses ai-je ce mois-ci\s*\??|cuántos gastos tengo este mes\s*\??|كم عدد مصاريفي هذا الشهر\s*[؟?]?/g, 'how many expenses do i have this month')
        .replace(/auditer mon budget|auditar mi presupuesto|مراجعة ميزانيتي|فحص ميزانيتي/g, 'audit my budget')
        .replace(/combien puis-je dépenser par jour\s*\??|cuánto puedo gastar por día\s*\??|كم يمكنني أن أنفق في اليوم\s*[؟?]?/g, 'how much can i spend per day')
        .replace(/quand atteindrai-je mon objectif d'épargne\s*\??|cuándo alcanzaré mi meta de ahorro\s*\??|متى سأصل إلى هدف الادخار\s*[؟?]?/g, 'when will i reach my savings goal')
        .replace(/quelles sont mes plus grosses dépenses\s*\??|cuáles son mis mayores gastos\s*\??|ما هي أكبر مصاريفي\s*[؟?]?/g, 'what are my biggest expenses')
        .replace(/supprimer la dernière dépense|eliminar el último gasto|حذف آخر مصروف/g, 'remove the last expense i added')
        .replace(/ouvrir le portefeuille|abrir portafolio|فتح المحفظة/g, 'open portfolio')
        .replace(/ouvrir les paramètres|abrir configuración|فتح الإعدادات/g, 'open settings')
        .replace(/ouvrir le centre fiscal|abrir centro de impuestos|فتح مركز الضرائب/g, 'open tax center')
        .replace(/ouvrir occasions et sandbox|abrir ocasiones y sandbox|فتح المناسبات والتجارب/g, 'open occasions & sandbox')
        .replace(/estimer mes impôts|estimar mis impuestos|حساب ضرائبي|تقدير الضرائب/g, 'estimate tax')
        .replace(/vérifier les frais récurrents|revisar gastos recurrentes|مراجعة المصاريف المتكررة/g, 'show recurring expenses')
        .replace(/passer en mode sombre|cambiar a modo oscuro|الوضع الداكن/g, 'switch to dark mode')
        .replace(/passer en mode clair|cambiar a modo claro|الوضع الفاتح/g, 'switch to light mode')
        .replace(/verrouiller mon tableau|bloquear mi tablero|قفل اللوحة الذكي/g, 'smart lock my board')
        .replace(/déverrouiller toutes les catégories|desbloquear todas las categorías|إلغاء قفل جميع الفئات/g, 'unlock all categories')
        .replace(/^(?:bonjour|salut|bonsoir|hola|buenos días|buenas tardes|مرحبا|أهلا|السلام عليكم)(?=$|\s|[^\p{L}\p{N}])/iu, 'hello')
        .replace(/^(?:merci|gracias|شكرا|شكراً)(?=$|\s|[^\p{L}\p{N}])/iu, 'thanks')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Escapes special regular expression metacharacters in a literal string.
 * @param {string} str - Input string to escape.
 * @returns {string} Escaped regex-safe string.
 */
function escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses a complete monetary token without accepting partial matches or truncating decimals.
 * Supports thousands separators ("1,000" -> 1000), decimal commas/dots ("1,5" -> 1.5),
 * and shorthand k/m suffixes ("120k" -> 120000, "1.5k" -> 1500, "2m" -> 2000000).
 * @param {string|number} rawNumberStr - Raw numeric token captured from user input.
 * @returns {number} Parsed numeric amount or NaN if invalid.
 */
export function parseMoneyAmount(rawNumberStr) {
    if (rawNumberStr === null || rawNumberStr === undefined) return NaN;
    let s = String(rawNumberStr).trim().replace(/^[$€£]\s*/, '');
    if (!s) return NaN;

    let multiplier = 1;
    const suffixMatch = s.match(/^(.+?)\s*([km])\b$/i);
    if (suffixMatch) {
        s = suffixMatch[1].trim();
        multiplier = suffixMatch[2].toLowerCase() === 'm' ? 1000000 : 1000;
    }

    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    let baseValue = NaN;

    if (hasComma && hasDot) {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        if (lastComma < lastDot) {
            if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return NaN;
            baseValue = Number(s.replace(/,/g, ''));
        } else {
            if (!/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) return NaN;
            baseValue = Number(s.replace(/\./g, '').replace(',', '.'));
        }
    } else if (hasComma) {
        if (/^\d{1,3}(,\d{3})+$/.test(s)) {
            baseValue = Number(s.replace(/,/g, ''));
        } else if (/^\d+,\d{1,2}$/.test(s)) {
            baseValue = Number(s.replace(',', '.'));
        } else {
            return NaN;
        }
    } else if (hasDot) {
        if (!/^\d+\.\d{1,2}$/.test(s)) return NaN;
        baseValue = Number(s);
    } else if (/^\d+$/.test(s)) {
        baseValue = Number(s);
    }

    if (Number.isNaN(baseValue)) return NaN;
    return Number((baseValue * multiplier).toFixed(2));
}

export const MONEY_PARSER_TEST_CASES = [
    { input: '1,000', expected: 1000 },
    { input: '8,000', expected: 8000 },
    { input: '2,000', expected: 2000 },
    { input: '1,5', expected: 1.5 },
    { input: '120k', expected: 120000 },
    { input: '1.5k', expected: 1500 }
];

/**
 * Runs a self-test on parseMoneyAmount against canonical thousands, decimal, and suffix cases.
 * @returns {boolean} True when all test cases pass.
 */
export function runMoneyParserSelfTest() {
    return MONEY_PARSER_TEST_CASES.every(({ input, expected }) => parseMoneyAmount(input) === expected);
}

// Captures the complete contiguous numeric token including optional k/m shorthand suffix
const MONEY_TOKEN_REGEX = /[$€£]?\s*(\d+(?:[.,]\d+)*(?:\s*[km]\b)?)(?!\d)/i;

// Leading logging verbs in EN, FR, ES, AR with Unicode-aware trailing boundary
const LOG_VERB_PREFIX_REGEX = /^(?:please\s+|can\s+you\s+)?(?:add|log|record|save|spent|paid|bought|fill|prefill|ajouter|enregistrer|registrar|añadir|إضافة|تسجيل|سجل|أضف)(?=$|\s|[^\p{L}\p{N}])\s*/iu;

// Daily safe-spend / burn-rate question detector
const DAILY_PACE_REGEX = /(?<![\p{L}\p{N}])(per\s+day|daily\s+allowance|safe\s+to\s+spend|burn\s+rate|pace|spend\s+per\s+day|spend\s+a\s+day|spend\s+daily|par\s+jour|por\s+día|في\s+اليوم)(?![\p{L}\p{N}])/iu;

// Multilingual purchase affordability detector (excludes daily-spend pace questions)
const AFFORDABILITY_REGEX = /(?<![\p{L}\p{N}])(can\s+i\s+afford|afford|can\s+i\s+spend(?!\s+(?:per|a|each)\s+day)|do\s+i\s+have\s+enough(?:\s+for)?|enough\s+for|what\s+if\s+i\s+(?:spend|spent|buy|bought|pay|paid)|if\s+i\s+(?:spend|spent|buy|bought|pay|paid)|puis-je\s+me\s+permettre|me\s+permettre|puis-je\s+dépenser(?!\s+par\s+jour)|ai-je\s+assez(?:\s+pour)?|puedo\s+permitirme|permitirme|puedo\s+gastar(?!\s+por\s+día)|tengo\s+suficiente(?:\s+para)?|هل\s+يمكنني\s+تحمل|هل\s+أستطيع\s+تحمل|هل\s+يمكنني\s+إنفاق(?!\s+في\s+اليوم)|هل\s+لدي\s+ما\s+يكفي)(?![\p{L}\p{N}])/iu;

/**
 * Processes a conversational or action turn for the Sterling AI Financial Assistant.
 * Uses centralized translations from src/i18n.js via i18n.t(...).
 * @param {string} rawInput - The user's chat or voice transcript prompt.
 * @param {object} ctx - Workspace state and action callbacks passed from App.
 * @returns {Promise<{reply: string, actionBadge?: string, suggestions?: string[]}>} Assistant response payload.
 */
export async function processAIAgentTurn(rawInput, ctx) {
    const t = (key, options) => i18n.t(key, options);

    const text = (rawInput || '').trim();
    if (!text) {
        return {
            reply: t('ai_empty_prompt'),
            suggestions: [t('ai_sug_audit'), t('ai_sug_how_many_exp'), t('ai_sug_daily_spend')]
        };
    }

    const lower = normalizeTypos(text);
    const isWhereOrHowQuestion = /^(?:where|how\s+do\s+i|how\s+can\s+i|can\s+you\s+tell\s+me\s+where|can\s+you\s+tell\s+me\s+how|où|comment\s+puis-je|dónde|cómo\s+puedo|أين|كيف)(?=$|\s|[^\p{L}\p{N}])/iu.test(lower);

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
        getCategoryAvailablePool,
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
        onCreateWealthObjective,
        currentMonthBoost = 0,
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
        const cleanedLookup = String(inputStr || '').replace(LOG_VERB_PREFIX_REGEX, '');
        const aliases = {
            wants: ['wants', 'want', 'once', 'entertainment', 'lifestyle', 'envies', 'envie', 'loisirs', 'deseos', 'deseo', 'رغبات'],
            needs: ['needs', 'need', 'bills', 'essentials', 'besoins', 'besoin', 'necesidades', 'necesidad', 'احتياجات'],
            savings: ['savings', 'saving', 'save', 'invest', 'investment', 'épargne', 'epargne', 'ahorros', 'ahorro', 'ادخار']
        };
        const sorted = [...categories].sort((a, b) => b.name.length - a.name.length);
        for (const cat of sorted) {
            const cName = cat.name.toLowerCase();
            const stem = cName.replace(/s$/, '');
            const list = [cName, stem, ...(aliases[cName] || []), ...(aliases[`${stem}s`] || [])];
            for (const word of list) {
                const escaped = escapeRegExp(word);
                if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(cleanedLookup)) {
                    return cat;
                }
            }
        }
        return null;
    };

    /**
     * Resolves a category token captured after an allocation connector without allowing
     * empty or 1-character stems to false-match the first category.
     */
    const resolveCategoryToken = (catWord) => {
        const cleanWord = String(catWord || '').trim().toLowerCase();
        if (!cleanWord) return null;
        const stem = cleanWord.replace(/s$/, '');
        return (
            categories.find(
                (c) =>
                    c.name.toLowerCase() === cleanWord ||
                    (stem.length >= 2 && c.name.toLowerCase().startsWith(stem))
            ) || findCategoryInText(cleanWord)
        );
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
            reply: t('ai_greeting_reply', {
                month: selectedMonth,
                remaining: formatCurrency(totalRemaining),
                catCount: categories.length,
                expCount: monthlyExpenses.length
            }),
            suggestions: [t('ai_sug_daily_spend'), t('ai_sug_audit'), t('ai_sug_how_many_exp')]
        };
    }

    if (/^(thanks|thank\s+you|thx|awesome|great|perfect|cool)\b/i.test(lower) && lower.split(' ').length <= 5) {
        return {
            reply: t('ai_thanks_reply'),
            suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
        };
    }

    // =========================================================================
    // 1. "WHERE / HOW DO I..." NAVIGATION & HELP QUESTIONS
    // =========================================================================
    if (isWhereOrHowQuestion) {
        if (/(?<![\p{L}\p{N}])(dark|light|theme|mode|appearance|sombre|clair|oscuro|claro)(?![\p{L}\p{N}])/iu.test(lower)) {
            return {
                reply: `You can switch between **Light Mode** and **Dark Mode** inside the **Settings** tab (under **Appearance**).\n\nOr tell me *"Switch to light mode"* or *"Switch to dark mode"* and I'll toggle it for you right now!`,
                suggestions: [
                    theme === 'dark' ? t('ai_sug_switch_light') : t('ai_sug_switch_dark'),
                    t('ai_sug_open_settings')
                ]
            };
        }
        if (/(?<![\p{L}\p{N}])(currency|mad|dollar|euro|symbol|devise|moneda|عملة)(?![\p{L}\p{N}])/iu.test(lower)) {
            return {
                reply: `You can change your **Currency** in the **Settings** tab—or tell me *"Change my currency to MAD"* (or $, €, £) and I'll update it immediately!`,
                suggestions: ['Change my currency to MAD', t('ai_sug_open_settings')]
            };
        }
        if (/(?<![\p{L}\p{N}])(salary|income|paycheck|boost|bonus|extra\s+income|salaire|revenu|salario|راتب)(?![\p{L}\p{N}])/iu.test(lower)) {
            return {
                reply: `You can update your base **Salary** in the **Settings** tab, or click **+ Income Boost** on the **Cash Flow** tab to add temporary extra income for **${selectedMonth}** only!`,
                suggestions: [t('ai_sug_open_settings'), t('ai_sug_audit')]
            };
        }
        if (/(?<![\p{L}\p{N}])(export|excel|csv|download|report|exporter|exportar|تصدير)(?![\p{L}\p{N}])/iu.test(lower)) {
            return {
                reply: `You can download your **Formal Audit** or **Visual Dashboard** Excel spreadsheets inside the **Settings** tab under **Data Export**.`,
                suggestions: [t('ai_sug_open_settings'), t('ai_sug_audit')]
            };
        }
    }

    // =========================================================================
    // 2. DELETE / REMOVE A WEALTH OBJECTIVE
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(delete|remove|erase|clear|supprimer|eliminar|حذف)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(wealth\s+objective|objective|objectives|goal|objectif|objetivo|هدف)(?![\p{L}\p{N}])/iu.test(lower) && setWealthObjectives) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }
        if (!Array.isArray(wealthObjectives) || wealthObjectives.length === 0) {
            return {
                reply: 'You do not have any Wealth Objectives to remove right now.',
                suggestions: ['Create a wealth objective named Car Chevy for 240000', t('ai_sug_open_portfolio')]
            };
        }

        const isLast = /(?<![\p{L}\p{N}])(last|latest|recent|dernier|último|الأخير)(?![\p{L}\p{N}])/iu.test(lower);
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
            suggestions: [t('ai_sug_open_portfolio'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 3. DELETE / REMOVE A SANDBOX SHEET
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(delete|remove|erase|supprimer|eliminar|حذف)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(sandbox|calculation\s+sheet|temp\s+sheet|sheet)(?![\p{L}\p{N}])/iu.test(lower) && handleDeleteSandboxSheet) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }
        if (!Array.isArray(sandboxSheets) || sandboxSheets.length === 0) {
            return { reply: 'You do not have any Sandbox calculation sheets to delete.' };
        }

        const isLast = /(?<![\p{L}\p{N}])(last|latest|recent|dernier|último|الأخير)(?![\p{L}\p{N}])/iu.test(lower);
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
            suggestions: [t('ai_sug_open_occasions'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 4. DELETE / REMOVE A SPECIAL OCCASION BUNDLE
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(delete|remove|erase|supprimer|eliminar|حذف)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(special\s+occasion|occasion\s+spéciale|occasions?|ocasión|ocasion|bundle|مناسبة)(?![\p{L}\p{N}])/iu.test(lower) && handleDeleteBundle) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }
        if (!Array.isArray(bundles) || bundles.length === 0) {
            return { reply: 'You do not have any Special Occasion bundles to delete.' };
        }

        const isLast = /(?<![\p{L}\p{N}])(last|latest|recent|dernier|último|الأخير)(?![\p{L}\p{N}])/iu.test(lower);
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
            suggestions: [t('ai_sug_open_occasions'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 5. CREATE A SPECIAL OCCASION BUNDLE WITH MULTI-CATEGORY PULLS (EN, FR, ES, AR)
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(create|make|add|new|start|créer|crée|creer|ajouter|nouvelle|crear|añadir|nueva|إنشاء|أنشئ|إضافة|أضف)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(special\s+occasion|occasion\s+spéciale|occasions?|ocasión\s+especial|ocasión|ocasion|bundle|مناسبة\s+خاصة|مناسبة)(?![\p{L}\p{N}])/iu.test(lower)) {
        if (!onDirectCreateBundle) {
            return { reply: 'Special Occasion creation handler is not connected.' };
        }

        let occasionName = 'Special Occasion';
        const nameMatch = text.match(
            /(?<![\p{L}\p{N}])(?:named|called|titled|nommée?|appelée?|intitulée?|llamad[oa]|titulad[oa]|باسم|بعنوان|اسمها|اسمه)\s+([\p{L}\p{N}\s'-]+?)(?=\s+(?:and\s+it|that\s+takes|taking|takes|pulling|pulls|with|from|et\s+qui|qui\s+prend|prenant|prend|avec|des|du|de|dans|sur|y\s+que|tomando|toma|con|من|و)|\s+[$€£]?\d|[,.]|$)/iu
        );
        if (nameMatch && nameMatch[1]) {
            occasionName = nameMatch[1].trim();
        } else {
            const afterOccasionMatch = text.match(
                /(?<![\p{L}\p{N}])(?:special\s+occasion|occasion\s+spéciale|occasion|ocasión\s+especial|ocasión|ocasion|bundle|مناسبة\s+خاصة|مناسبة)\s+([\p{L}\p{N}\s'-]+?)(?=\s+(?:and\s+it|that\s+takes|taking|takes|pulling|pulls|with|from|et\s+qui|qui\s+prend|prenant|prend|avec|des|du|de|dans|sur|y\s+que|tomando|toma|con|من|و)|\s+[$€£]?\d|[,.]|$)/iu
            );
            if (afterOccasionMatch && afterOccasionMatch[1]) {
                const candidate = afterOccasionMatch[1]
                    .replace(/^(?:named|called|titled|nommée?|appelée?|intitulée?|llamad[oa]|titulad[oa]|باسم|بعنوان)\s+/iu, '')
                    .trim();
                if (candidate) occasionName = candidate;
            }
        }

        const allocations = {};
        const splitSummary = [];
        // Require trailing whitespace after word connectors (ordered longest-first: des/du/del before de) so "des envies" never splits into "de" + "s"
        const pairRegex = /[$€£]?\s*(\d+(?:[.,]\d+)*(?:\s*[km]\b)?)(?!\d)\s*(?:dollars?|usd|mad|dhs?|dirhams?|euros?|eur|pounds?|gbp|درهم|دولار|يورو)?\s*(?:d'\s*|(?:from|out\s+of|de\s+la\s+catégorie|de\s+la\s+categoría|من\s+فئة|dans|des|del|sur|off|du|de|in|en|من|في)\s+)([\p{L}\p{N}_-]+)(?![\p{L}\p{N}])/giu;
        let match;
        while ((match = pairRegex.exec(text)) !== null) {
            const amt = parseMoneyAmount(match[1]);
            if (isNaN(amt) || amt <= 0) {
                return {
                    reply: `Invalid allocation amount **"${match[1]}"**. Please provide a valid positive amount with at most 2 decimal places.`
                };
            }
            const matchedCat = resolveCategoryToken(match[2]);
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
                suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
            };
        }

        const totalReserved = Object.values(allocations).reduce((s, v) => s + v, 0);
        return {
            reply: `Created Special Occasion **${res.bundle.name}** with a total pool of **${formatCurrency(totalReserved)}** (${splitSummary.join(' + ')})!`,
            actionBadge: `Occasion Created → ${res.bundle.name} (${formatCurrency(totalReserved)})`,
            suggestions: [t('ai_sug_open_occasions'), `Delete the ${res.bundle.name} special occasion`, t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 6. CREATE A SANDBOX CALCULATION SHEET
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(create|make|add|new|créer|crée|creer|crear|إنشاء|أنشئ)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(sandbox|calculation\s+sheet|temp\s+sheet)(?![\p{L}\p{N}])/iu.test(lower)) {
        if (!onDirectCreateSandbox) {
            return { reply: 'Sandbox creation handler is not connected.' };
        }

        const nameMatch = text.match(/(?<![\p{L}\p{N}])(?:named|called|titled|nommée?|appelée?|llamad[oa]|باسم)\s+([\p{L}\p{N}\s'-]+?)(?=\s+(?:with|having|budget|of|at|for|avec|con|بميزانية)|\s+[$€£]?\d|[,.]|$)/iu);
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
            suggestions: [t('ai_sug_open_occasions'), `Delete the ${sheetTitle} sandbox sheet`, t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 7. CREATE A WEALTH OBJECTIVE (Uses shared onCreateWealthObjective Pro gate)
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(create|make|add|new|créer|crée|creer|crear|إنشاء|أنشئ)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(wealth\s+objective|objective|objectif|objetivo|هدف)(?![\p{L}\p{N}])/iu.test(lower) && (onCreateWealthObjective || setWealthObjectives)) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }
        const nameMatch = text.match(/(?<![\p{L}\p{N}])(?:named|called|titled|nommée?|appelée?|llamad[oa]|باسم)\s+([\p{L}\p{N}\s'-]+?)(?=\s+(?:for|with|costing|cost|target|at|pulling|and\s+it|pour|avec|des|du|de|por|con|بقيمة|بهدف)|\s+[$€£]?\d|[,.]|$)/iu);
        const rawObjTitle = nameMatch?.[1]?.trim() || 'Wealth Objective';
        const objTitle = rawObjTitle.charAt(0).toUpperCase() + rawObjTitle.slice(1);

        const rawTokens = [...text.matchAll(/[$€£]?\s*(\d+(?:[.,]\d+)*(?:\s*[km]\b)?)(?!\d)/gi)].map(m => m[1]);
        const targetCost = rawTokens.length > 0 ? parseMoneyAmount(rawTokens[0]) : NaN;

        if (isNaN(targetCost) || targetCost <= 0) {
            return { reply: 'Please include a valid target cost for your objective, e.g., *"Create a wealth objective named Car Chevy for 240000"*.' };
        }

        const autoPulls = {};
        const pairRegex = /[$€£]?\s*(\d+(?:[.,]\d+)*(?:\s*[km]\b)?)(?!\d)\s*(?:d'\s*|(?:from|dans|des|del|du|de|in|en|من|في)\s+)([\p{L}\p{N}_-]+)(?![\p{L}\p{N}])/giu;
        let match;
        while ((match = pairRegex.exec(text)) !== null) {
            const amt = parseMoneyAmount(match[1]);
            if (isNaN(amt) || amt <= 0) {
                return { reply: `Invalid auto-pull amount **"${match[1]}"**. Please provide a valid positive amount.` };
            }
            const matchedCat = resolveCategoryToken(match[2]);
            if (matchedCat) autoPulls[matchedCat.id] = amt;
        }

        if (onCreateWealthObjective) {
            const res = onCreateWealthObjective({
                name: objTitle,
                targetAmount: targetCost,
                autoPulls
            });
            if (!res.ok) {
                const badgeByCode = {
                    pro_limit: 'Blocked → Pro Tier Limit',
                    read_only: 'Blocked → Read-Only Month',
                    invalid: 'Invalid Objective Input'
                };
                return {
                    reply: res.error,
                    actionBadge: badgeByCode[res.code] || 'Objective Creation Blocked',
                    suggestions: [t('ai_sug_open_portfolio'), t('ai_sug_audit')]
                };
            }
        } else {
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
        }

        return {
            reply: `Created Wealth Objective **${objTitle}** with a target of **${formatCurrency(targetCost)}** inside your **Portfolio** tab!`,
            actionBadge: `Objective → ${objTitle} (${formatCurrency(targetCost)})`,
            suggestions: [t('ai_sug_open_portfolio'), `Delete the ${objTitle} wealth objective`, t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 8. ONE-MONTH INCOME BOOST
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(clear|remove|reset|supprimer|eliminar|إزالة)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(boost|bonus|extra\s+income|income\s+gift)(?![\p{L}\p{N}])/iu.test(lower) && handleClearMonthlyBoost) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }
        handleClearMonthlyBoost();
        return {
            reply: `Cleared the temporary income boost for **${selectedMonth}**. Your monthly income is back to your base salary.`,
            actionBadge: `Reset ${selectedMonth} Boost`,
            suggestions: [t('ai_sug_audit')]
        };
    }

    const mentionsBoostWord = /\b(gift|bonus|boost|extra\s+income|extra\s+money)\b/i.test(lower);
    if (mentionsBoostWord && handleAddMonthlyBoost && !AFFORDABILITY_REGEX.test(lower)) {
        const isDirectBoostCommand = /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:add|boost|apply|give|include|put|log|record|set|increase)\b/i.test(lower);
        const isQuestionAboutBoost =
            !isDirectBoostCommand &&
            (/[?؟]$/.test(text) ||
                /^(?:what|how|why|where|when|who|which|is|are|do|did|does|have|has|can\s+i|should\s+i|would\s+i|will\s+i|if\s+i|what\s+if)\b/i.test(lower) ||
                /\b(?:how\s+much|what\s+is|do\s+i\s+have)\b/i.test(lower));

        if (isQuestionAboutBoost) {
            return {
                reply:
                    currentMonthBoost > 0
                        ? `You currently have a temporary **+${formatCurrency(currentMonthBoost)}** income boost active for **${selectedMonth}**, bringing your total **${selectedMonth}** income to **${formatCurrency(parsedSalary)}**.`
                        : `You currently have **${formatCurrency(0)}** in extra income boosts for **${selectedMonth}** (your active income is **${formatCurrency(parsedSalary)}**). To add one, say: *"Add a 500 gift to my income for this month"*.`,
                actionBadge: `Boost (${selectedMonth}): ${formatCurrency(currentMonthBoost)}`,
                suggestions: [
                    'Add a 500 gift to my income for this month',
                    t('ai_sug_audit')
                ]
            };
        } else {
            const hasExplicitIncomeContext =
                /\b(income\s+boost|salary\s+boost|boost\s+(?:my\s+)?(?:income|salary)|extra\s+income|extra\s+money|(?:to|into|for)\s+(?:my\s+|this\s+month'?s?\s+)?(?:income|salary|paycheck)|gifted\s+me)\b/i.test(lower) ||
                (/\b(?:boost|bonus|gift)\b/i.test(lower) && /\b(?:income|salary|paycheck)\b/i.test(lower));

            const hasExpensePurchaseVerb = /\b(spent|paid|bought|purchase|purchased|log|record|save|fill|prefill)\b/i.test(lower);
            const strippedForCatCheck = lower.replace(LOG_VERB_PREFIX_REGEX, '');
            const hasCategoryTarget = Boolean(findCategoryInText(strippedForCatCheck));
            const isClearGiftExpense = !hasExplicitIncomeContext && (hasExpensePurchaseVerb || hasCategoryTarget);

            if (!isClearGiftExpense) {
                if (isReadOnly) {
                    return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
                }
                const amtMatch = text.match(MONEY_TOKEN_REGEX);
                const boostVal = amtMatch ? parseMoneyAmount(amtMatch[1]) : NaN;

                if (hasExplicitIncomeContext) {
                    if (!isNaN(boostVal) && boostVal > 0) {
                        handleAddMonthlyBoost(boostVal);
                        return {
                            reply: `Added a temporary **+${formatCurrency(boostVal)}** income boost for **${selectedMonth} only**! Your total income for **${selectedMonth}** is now **${formatCurrency(parsedSalary + boostVal)}**, and next month will automatically revert to your base salary.`,
                            actionBadge: `+${formatCurrency(boostVal)} (${selectedMonth} Only)`,
                            suggestions: ["Clear this month's income boost", t('ai_sug_audit')]
                        };
                    }
                } else if (/\b(gift|bonus)\b/i.test(lower) && !isNaN(boostVal) && boostVal > 0) {
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
    }

    // =========================================================================
    // 9. CREATE / DELETE / RENAME A CATEGORY
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

        const goalMatch = text.match(/\b(?:goal|target)\s*(?:of|is|to|:)?\s*[$€£]?\s*(\d+(?:[.,]\d+)*(?:\s*[km]\b)?)(?!\d)/i);
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
                suggestions: [t('ai_sug_audit')]
            };
        }

        const finalPct = Math.round(res.category.percentage || 0);
        return {
            reply: `Created your new **${isAssetType ? 'Wealth Asset' : 'Expense'}** category **${res.category.name}** with **${finalPct}%** allocation (${formatCurrency(parsedSalary * (finalPct / 100))}/mo)!`,
            actionBadge: `Created → ${res.category.name} (${finalPct}%)`,
            suggestions: [t('ai_sug_smart_lock'), t('ai_sug_audit')]
        };
    }

    const isExplicitDeleteCategory =
        /\b(?:delete|remove)\s+(?:the\s+)?(?:category\b|[a-z0-9\s&'+!-]+?\s+category\b)/i.test(lower) &&
        !/\b(?:expense|expenses|transaction|item|purchase|from\s+category|in\s+category|under\s+category)\b/i.test(lower);

    if (isExplicitDeleteCategory) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
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
            suggestions: [t('ai_sug_audit'), t('ai_sug_smart_lock')]
        };
    }

    const renameCatMatch = text.match(/\b(?:rename|change)\s+(?:the\s+)?category\s+([a-zA-Z0-9\s&'+!-]+?)\s+to\s+([a-zA-Z0-9\s&'+!-]+)$/i);
    if (renameCatMatch && handleUpdateCategory) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
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
                suggestions: [t('ai_sug_audit')]
            };
        }
    }

    // =========================================================================
    // 10. REMOVE / DELETE / UNDO AN EXPENSE
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(remove|delete|undo|erase|cancel|supprimer|eliminar|حذف)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(expense|expenses|transaction|item|purchase|last|latest|recent|dépense|gasto|مصروف)(?![\p{L}\p{N}])/iu.test(lower) || /\b(remove|delete)\s+the\s+last\b/i.test(lower)) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }
        if (!handleDeleteExpense || monthlyExpenses.length === 0) {
            return { reply: `You don't have any expenses in **${selectedMonth}** to remove.` };
        }

        const isLastIntent = /(?<![\p{L}\p{N}])(last|latest|recent|previous|just\s+added|i\s+added|dernière|último|آخر)(?![\p{L}\p{N}])/iu.test(lower);
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
                suggestions: [t('ai_sug_remove_last'), t('ai_sug_how_many_exp')]
            };
        }

        const ok = await handleDeleteExpense(targetExp.id);
        if (!ok) {
            return { reply: `Failed to remove **${targetExp.name}**. Please try again.` };
        }
        return {
            reply: `Removed **${targetExp.name}** (${formatCurrency(targetExp.cost)}) from **${targetExp.category}**. That **${formatCurrency(targetExp.cost)}** is back in your available balance!`,
            actionBadge: `Removed → ${targetExp.name} (${formatCurrency(targetExp.cost)})`,
            suggestions: [t('ai_sug_how_many_exp'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 11. RENAME AN EXPENSE
    // =========================================================================
    const renameExpMatch = text.match(/\b(?:rename|change\s+the\s+name\s+of)\s+(?:the\s+)?(?:expense\s+)?(.+?)\s+to\s+([a-zA-Z0-9\s']+)$/i);
    if (renameExpMatch && handleUpdateExpense && !/\bcategory\b/i.test(lower)) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
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
                suggestions: [t('ai_sug_how_many_exp'), t('ai_sug_audit')]
            };
        }
    }

    // =========================================================================
    // 12. CHANGE CURRENCY / SALARY / MONTH / THEME / TAB / LOCKS
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(currency|devise|moneda|عملة)(?![\p{L}\p{N}])/iu.test(lower) || /\b(?:change|set|switch|use)\s+(?:my\s+)?currency\b/i.test(lower)) {
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
                suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
            };
        }
    }

    const salaryCmdMatch = text.match(/\b(?:set|change|update|make)\s+(?:my\s+)?(?:monthly\s+)?(?:salary|income|paycheck)\s+(?:to|as|at)?\s*[$€£]?\s*(\d+(?:[.,]\d+)*(?:\s*[km]\b)?)(?!\d)/i);
    if (salaryCmdMatch && setSalary) {
        const newSal = parseMoneyAmount(salaryCmdMatch[1]);
        if (isNaN(newSal) || newSal < 0) {
            return { reply: 'Please enter a valid salary amount (with up to 2 decimal places).' };
        }
        setSalary(newSal.toString());
        return {
            reply: `Updated your base monthly salary to **${formatCurrency(newSal)}**!`,
            actionBadge: `Salary → ${formatCurrency(newSal)}`,
            suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
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
            suggestions: [t('ai_sug_audit')]
        };
    }

    if (/\b(?:from\s+light\s+to\s+dark|to\s+dark\s+mode|to\s+dark\s+theme|enable\s+dark|turn\s+on\s+dark|dark\s+mode)\b/i.test(lower) && !/\bto\s+light\b/i.test(lower)) {
        if (theme !== 'dark') setTheme('dark');
        return {
            reply: 'Switched your workspace to **Dark Mode**.',
            actionBadge: 'Theme → Dark',
            suggestions: [t('ai_sug_switch_light'), t('ai_sug_audit')]
        };
    }
    if (/\b(?:from\s+dark\s+to\s+light|to\s+light\s+mode|to\s+light\s+theme|enable\s+light|turn\s+on\s+light|light\s+mode)\b/i.test(lower)) {
        if (theme !== 'light') setTheme('light');
        return {
            reply: 'Switched your workspace to **Light Mode**.',
            actionBadge: 'Theme → Light',
            suggestions: [t('ai_sug_switch_dark'), t('ai_sug_audit')]
        };
    }

    const navMap = [
        { tab: 'taxes', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(tax|taxes|tax\s+center)\b/i, label: 'Tax Center' },
        { tab: 'portfolio', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(portfolio|wealth|assets|investments)\b/i, label: 'Portfolio' },
        { tab: 'occasions', regex: /\b(open|go\s+to|show|switch\s+to|take\s+me\s+to)\s+(?:the\s+)?(occasions?|bundles?|sandbox|planner|occasions\s+&\s+sandbox)\b/i, label: 'Occasions & Sandbox' },
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
                suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
            };
        }
    }

    if (/\b(smart\s*lock|auto\s*balance|balance\s+my\s+board|lock\s+all|lock\s+board)\b/i.test(lower)) {
        if (isReadOnly) return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        handleSmartLockAll();
        return {
            reply: 'Executed **Smart Lock Board**—your categories are now balanced to 100% and locked.',
            actionBadge: 'Action → Smart Lock Board',
            suggestions: [t('ai_sug_unlock_all'), t('ai_sug_audit')]
        };
    }
    if (/\b(unlock\s+all|unlock\s+categories|unlock\s+board)\b/i.test(lower)) {
        if (isReadOnly) return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        handleUnlockAll();
        return {
            reply: 'Unlocked all budget categories so you can adjust the allocation sliders.',
            actionBadge: 'Action → Unlock All',
            suggestions: [t('ai_sug_smart_lock'), t('ai_sug_audit')]
        };
    }

    if (/^(?:please\s+)?(lock|unlock)\s+([a-zA-Z\s]+)$/i.test(lower) && toggleIndividualLock) {
        if (isReadOnly) return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
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
                suggestions: [t('ai_sug_audit')]
            };
        }
    }

    const pctChangeMatch = text.match(/\b(?:set|change|move|adjust|make|give)\s+([a-z\s]+?)\s+(?:to|at)?\s*(\d+(?:\.\d+)?)\s*%/i);
    if (pctChangeMatch) {
        if (isReadOnly) return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        const targetCat = findCategoryInText(pctChangeMatch[1]);
        const newPct = parseFloat(pctChangeMatch[2]);
        if (targetCat && !isNaN(newPct) && newPct >= 0 && newPct <= 100) {
            handleSliderChange(targetCat.id, newPct);
            return {
                reply: `Adjusted **${targetCat.name}** allocation to **${newPct}%** (${formatCurrency(parsedSalary * (newPct / 100))}) and rebalanced your unlocked categories.`,
                actionBadge: `Allocation → ${targetCat.name} ${newPct}%`,
                suggestions: [t('ai_sug_smart_lock'), t('ai_sug_audit')]
            };
        }
    }

    // =========================================================================
    // 13. ANALYST ENGINE: DAILY SAFE-SPEND PACE (Evaluated BEFORE Affordability & Log Expense)
    // =========================================================================
    if (DAILY_PACE_REGEX.test(lower) && !LOG_VERB_PREFIX_REGEX.test(lower)) {
        const now = new Date();
        const [selYear, selMonth] = (selectedMonth || getToday().slice(0, 7)).split('-').map(Number);
        const daysInMonth = new Date(selYear, selMonth, 0).getDate();
        const isCurrentMonth = now.getFullYear() === selYear && (now.getMonth() + 1) === selMonth;
        const daysLeft = isCurrentMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;

        const dailyTotal = totalRemaining / daysLeft;
        const expCats = categories.filter(c => c.type !== 'asset');
        const breakdownLines = expCats.map(c => {
            const { remaining } = getCategoryStats(c);
            return t('ai_daily_line', {
                name: c.name,
                perDay: formatCurrency(remaining / daysLeft),
                remaining: formatCurrency(remaining),
                days: daysLeft
            });
        }).join('\n');

        return {
            reply: t('ai_daily_reply', {
                daysLeft,
                month: selectedMonth,
                dailyTotal: formatCurrency(dailyTotal),
                lines: breakdownLines
            }),
            actionBadge: `${formatCurrency(dailyTotal)} / day`,
            suggestions: [t('ai_sug_audit'), t('ai_sug_biggest_exp')]
        };
    }

    // =========================================================================
    // 14. ANALYST ENGINE: AFFORDABILITY CHECK (Uses getCategoryAvailablePool so reserved bundles are subtracted)
    // =========================================================================
    if (AFFORDABILITY_REGEX.test(lower) && !DAILY_PACE_REGEX.test(lower)) {
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

        const { remaining: rawRemaining, allocated } = getCategoryStats(targetCat);
        const reservedInOpenBundles = (Array.isArray(bundles) ? bundles : [])
            .filter(b => b.month === selectedMonth && b.status === 'open')
            .reduce((sum, b) => sum + (parseFloat(b.target_budget?.[targetCat.id]) || 0), 0);
        const remaining = typeof getCategoryAvailablePool === 'function'
            ? Math.max(0, Number(getCategoryAvailablePool(targetCat.id)) || 0)
            : Math.max(0, rawRemaining - reservedInOpenBundles);

        if (testCost <= remaining) {
            const afterPurchase = remaining - testCost;
            const pctOfRemaining = remaining > 0 ? Math.round((testCost / remaining) * 100) : 100;
            return {
                reply: `**Yes, you can afford it!**\n\n• **${targetCat.name} Available:** ${formatCurrency(remaining)} (of ${formatCurrency(allocated)})\n• **Purchase Amount:** ${formatCurrency(testCost)} (${pctOfRemaining}% of your remaining ${targetCat.name} pool)\n• **Left After Purchase:** ${formatCurrency(afterPurchase)}`,
                actionBadge: 'Affordability → Approved',
                suggestions: [`Log ${testCost} in ${targetCat.name}`, t('ai_sug_daily_spend')]
            };
        } else {
            const shortfall = testCost - remaining;
            return {
                reply: `**Not inside ${targetCat.name} right now.**\n\n• **${targetCat.name} Available:** ${formatCurrency(remaining)}\n• **Purchase Amount:** ${formatCurrency(testCost)}\n• **Shortfall:** You are short by **${formatCurrency(shortfall)}** in ${targetCat.name}.`,
                actionBadge: 'Affordability → Exceeds Pool',
                suggestions: [t('ai_sug_audit'), t('ai_sug_open_occasions')]
            };
        }
    }

    // =========================================================================
    // 15. LOG OR PRE-FILL AN EXPENSE (Supports EN, FR, ES, AR + Daily/Monthly/Yearly recurrence)
    // =========================================================================
    const isLogIntent = LOG_VERB_PREFIX_REGEX.test(lower);
    const hasNumber = /\d+/.test(lower);
    const isQuestionForm = /[?؟]\s*$/.test(text);
    if (
        isLogIntent &&
        hasNumber &&
        !isQuestionForm &&
        !AFFORDABILITY_REGEX.test(lower) &&
        !/(?<![\p{L}\p{N}])(tax|if\s+i|how\s+many|how\s+much|salary|currency|occasion|sandbox|objective|impôts?|impuestos?|ضرائب|ضريبة)(?![\p{L}\p{N}])/iu.test(lower)
    ) {
        if (isReadOnly) {
            return { reply: t('ai_read_only_msg', { month: selectedMonth }) };
        }

        const isPrefillOnly = /^(?:please\s+|can\s+you\s+)?(?:fill|prefill)(?=$|\s|[^\p{L}\p{N}])/iu.test(lower);
        const isDailyRec = /(?<![\p{L}\p{N}])(daily|every\s+day|quotidien(?:ne)?|journali(?:er|ère)|chaque\s+jour|tous\s+les\s+jours|diario|diariamente|cada\s+día|يومي|يوميا|يومياً|كل\s+يوم)(?![\p{L}\p{N}])/iu.test(lower);
        const isYearlyRec = /(?<![\p{L}\p{N}])(yearly|annual|annually|every\s+year|annuel(?:le)?|chaque\s+année|tous\s+les\s+ans|anual|anualmente|cada\s+año|سنوي|سنويا|سنوياً|كل\s+سنة|كل\s+عام)(?![\p{L}\p{N}])/iu.test(lower);
        const isMonthlyRec = /(?<![\p{L}\p{N}])(recurring|monthly|every\s+month|récurrent(?:e)?|mensuel(?:le)?|chaque\s+mois|recurrente|mensual|cada\s+mes|متكرر|متكررة|شهري|شهريا|شهرياً|كل\s+شهر)(?![\p{L}\p{N}])/iu.test(lower);
        const recFlag = isDailyRec || isYearlyRec || isMonthlyRec;
        const recurrenceType = isDailyRec ? 'daily' : isYearlyRec ? 'yearly' : 'monthly';
        const batchFlag = /(?<![\p{L}\p{N}])(batch|batched|month\s+end|groupé|lote|دفعة)(?![\p{L}\p{N}])/iu.test(lower);

        const categoryText = lower.replace(LOG_VERB_PREFIX_REGEX, '');
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
            .replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapedCatName}(?![\\p{L}\\p{N}])`, 'giu'), ' ')
            .replace(/(?<![\p{L}\p{N}])(please|can\s+you|add|log|record|save|spent|paid|bought|fill|prefill|ajouter|enregistrer|registrar|añadir|إضافة|تسجيل|سجل|أضف|recurring|recuring|monthly|daily|yearly|annual|annually|every\s+day|every\s+month|every\s+year|récurrent(?:e)?|mensuel(?:le)?|quotidien(?:ne)?|journali(?:er|ère)|annuel(?:le)?|chaque\s+jour|chaque\s+mois|chaque\s+année|tous\s+les\s+jours|tous\s+les\s+ans|recurrente|mensual|diario|diariamente|anual|anualmente|cada\s+día|cada\s+mes|cada\s+año|متكرر|متكررة|شهري|شهريا|شهرياً|يومي|يوميا|يومياً|سنوي|سنويا|سنوياً|كل\s+يوم|كل\s+شهر|كل\s+سنة|كل\s+عام|batch|batched|at\s+month\s+end|month\s+end|groupé|lote|دفعة)(?![\p{L}\p{N}])/giu, ' ')
            .replace(/(?<![\p{L}\p{N}])(expenses?|expences?|transactions?|items?|purchases?|named|called|dépenses?|gastos?|مصروف|مصاريف)(?![\p{L}\p{N}])/giu, ' ')
            .replace(/(?<![\p{L}\p{N}])(dollars?|usd|dirhams?|mad|dhs?|euros?|eur|pounds?|gbp|bucks|درهم|دولار|يورو)(?![\p{L}\p{N}])/giu, ' ')
            .replace(/(?<![\p{L}\p{N}])(in|under|into|for|on|at|to|from|with|of|dans|en|para|por|في|من|إلى|على|category|bucket|a|an|the|my)(?![\p{L}\p{N}])/giu, ' ')
            .replace(/[.,!?;:$/€£،؟]+/g, ' ')
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
                recurrenceType: recFlag ? recurrenceType : 'monthly',
                isBatched: batchFlag
            });
            return {
                reply: `Pre-filled the Log Expense form with **${cleanItem}** (${formatCurrency(costVal)}) under **${matchedCat.name}**.`,
                actionBadge: `Form Filled → ${cleanItem}`,
                suggestions: [t('ai_sug_audit'), t('ai_sug_how_many_exp')]
            };
        }

        if (onDirectLogExpense) {
            const result = await onDirectLogExpense({
                name: cleanItem,
                cost: costVal,
                categoryId: matchedCat.id,
                expenseDate: getExpenseDateForActiveMonth(),
                isRecurring: recFlag,
                recurrenceType: recFlag ? recurrenceType : 'monthly',
                isBatched: batchFlag
            });

            if (!result.ok) {
                return {
                    reply: result.error,
                    actionBadge: 'Blocked → Budget Ceiling',
                    suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
                };
            }

            return {
                reply: `Logged **${cleanItem}** for **${formatCurrency(costVal)}** under **${matchedCat.name}**${recFlag ? ` (Recurring • ${recurrenceType})` : ''}${batchFlag ? ' (Batched)' : ''}. You now have **${formatCurrency(result.newRemaining)}** left in **${matchedCat.name}**.`,
                actionBadge: `Saved → ${cleanItem} (${formatCurrency(costVal)})`,
                suggestions: [t('ai_sug_remove_last'), t('ai_sug_how_many_exp'), t('ai_sug_audit')]
            };
        }
    }

    // =========================================================================
    // 16. SPECIFIC QUESTION: RECURRING OR BATCHED EXPENSES
    // =========================================================================
    if (/\b(what|which|show|list|how\s+many)\b.*\b(recurring|batched)\b/i.test(lower)) {
        const checkBatched = /\bbatched\b/i.test(lower);
        const filtered = monthlyExpenses.filter(e => checkBatched ? e.is_batched : e.is_recurring);
        const label = checkBatched ? 'Batched' : 'Recurring';

        if (filtered.length === 0) {
            return {
                reply: `You currently have **0 ${label.toLowerCase()} expenses** in **${selectedMonth}**.`,
                actionBadge: `0 ${label} Expenses`,
                suggestions: [t('ai_sug_how_many_exp'), t('ai_sug_audit')]
            };
        }

        const total = filtered.reduce((s, e) => s + parseFloat(e.cost || 0), 0);
        const lines = filtered.map((e, i) => `${i + 1}. **${e.name}** — ${formatCurrency(e.cost)} *(${e.category})*`).join('\n');
        return {
            reply: `You have **${filtered.length} ${label} expense${filtered.length === 1 ? '' : 's'}** in **${selectedMonth}** totaling **${formatCurrency(total)}**:\n\n${lines}`,
            actionBadge: `${filtered.length} ${label} (${formatCurrency(total)})`,
            suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
        };
    }

    // =========================================================================
    // 17. SPECIFIC QUESTION: "HOW MANY EXPENSES / TRANSACTIONS DO I HAVE?"
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
                suggestions: ['Log 35 for coffee in Wants', t('ai_sug_audit')]
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
            suggestions: [t('ai_sug_remove_last'), t('ai_sug_daily_spend'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 18. SPECIFIC QUESTION: "HOW MUCH DID I SPEND?" / "HOW MUCH IS LEFT IN X?"
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(how\s+much|combien|cuánto|كم)(?![\p{L}\p{N}]).*(?<![\p{L}\p{N}])(spend|spent|used|left|remaining|have\s+in|dépensé|restant|gastado|queda|أنفقت|متبقي)(?![\p{L}\p{N}])/iu.test(lower)) {
        const targetCat = findCategoryInText(lower);
        if (targetCat) {
            const { allocated, spent, remaining } = getCategoryStats(targetCat);
            const count = monthlyExpenses.filter(e => e.category_id === targetCat.id).length;
            return {
                reply: `**${targetCat.name} (${selectedMonth}):**\n\n• **Allocated Budget:** ${formatCurrency(allocated)} (${Math.round(targetCat.percentage)}%)\n• **Spent So Far:** ${formatCurrency(spent)} across ${count} transaction${count === 1 ? '' : 's'}\n• **Remaining Available:** **${formatCurrency(remaining)}**`,
                actionBadge: `${targetCat.name}: ${formatCurrency(remaining)} left`,
                suggestions: [`Can I afford 100 in ${targetCat.name}?`, t('ai_sug_daily_spend')]
            };
        }

        return {
            reply: `In **${selectedMonth}**, you have spent **${formatCurrency(totalSpent)}** across **${monthlyExpenses.length} transaction${monthlyExpenses.length === 1 ? '' : 's'}**, with **${formatCurrency(totalAutomatedAssets)}** allocated to Wealth Assets and **${formatCurrency(totalRemaining)}** in remaining cash.`,
            actionBadge: `Spent: ${formatCurrency(totalSpent)}`,
            suggestions: [t('ai_sug_daily_spend'), t('ai_sug_audit')]
        };
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
            suggestions: [t('ai_sug_audit'), t('ai_sug_daily_spend')]
        };
    }

    // =========================================================================
    // 20. ANALYST ENGINE: SAVINGS / PORTFOLIO GOAL PROJECTION & OBJECTIVES
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
                suggestions: ['Create a wealth objective named Car Chevy for 240000', t('ai_sug_audit')]
            };
        }

        return {
            reply: sections.join('\n\n'),
            actionBadge: 'Wealth & Objectives Forecast',
            suggestions: [t('ai_sug_open_portfolio'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 21. ANALYST ENGINE: ACCURATE PROGRESSIVE TAX ESTIMATOR
    // =========================================================================
    if (/(?<![\p{L}\p{N}])(tax|taxes|impôts?|impuestos?|ضرائب|ضريبة)(?![\p{L}\p{N}])/iu.test(lower)) {
        const withoutYear = text.replace(/\b20\d{2}\b/g, ' ');
        const amtMatch = withoutYear.match(MONEY_TOKEN_REGEX);
        const annualIncome = amtMatch ? parseMoneyAmount(amtMatch[1]) : (parsedSalary * 12);

        if (isNaN(annualIncome) || annualIncome <= 0) {
            return {
                reply: 'Enter your monthly salary in **Settings** or ask me *"Estimate tax on 120000"* so I can calculate your progressive tax!',
                suggestions: [t('ai_sug_tax_120k'), t('ai_sug_open_tax')]
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
            suggestions: [t('ai_sug_open_tax'), t('ai_sug_audit')]
        };
    }

    // =========================================================================
    // 22. ANALYST ENGINE: FULL BUDGET AUDIT / CATEGORY BREAKDOWN
    // =========================================================================
    if (/\b(audit|summary|overview|status|how\s+am\s+i\s+doing|how\s+is\s+my\s+budget|left|remaining|categories|breakdown|report|expenses|salary|income)\b/i.test(lower)) {
        const catLines = categories.map(c => {
            const { allocated, spent, remaining } = getCategoryStats(c);
            const pctUsed = allocated > 0 ? Math.round((spent / allocated) * 100) : 0;
            return t('ai_audit_line', {
                name: c.name,
                pct: Math.round(c.percentage || 0),
                assetTag: c.type === 'asset' ? t('ai_audit_asset_tag') : '',
                remaining: formatCurrency(remaining),
                allocated: formatCurrency(allocated),
                pctUsed
            });
        }).join('\n');

        return {
            reply: t('ai_audit_reply', {
                month: selectedMonth,
                salary: formatCurrency(parsedSalary),
                spent: formatCurrency(totalSpent),
                count: monthlyExpenses.length,
                saved: formatCurrency(totalAutomatedAssets),
                remaining: formatCurrency(totalRemaining),
                lines: catLines
            }),
            actionBadge: t('ai_audit_badge', { remaining: formatCurrency(totalRemaining) }),
            suggestions: [t('ai_sug_daily_spend'), t('ai_sug_how_many_exp'), t('ai_sug_biggest_exp')]
        };
    }

    // =========================================================================
    // 23. DEFAULT HELPFUL GUIDE
    // =========================================================================
    return {
        reply: t('ai_default_guide'),
        suggestions: [
            t('ai_sug_daily_spend'),
            t('ai_sug_tax_120k'),
            t('ai_sug_audit')
        ]
    };
}