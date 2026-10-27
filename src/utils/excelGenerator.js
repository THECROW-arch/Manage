import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { getToday, getCurrentMonth } from './constants';

export const generateFormalAudit = async (data) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Salary Allocator SaaS';
    const { targetPeriod, exportScope, currency, parsedSalary, periodSpent, cumulativeMonthSpent, monthlyAssetsAllocated, trueMonthRemaining, categories = [], groupedScopedExps, scopedExps, cumulativeMonthExps, scopedAdjs, closedMonths = [] } = reportData;
    // Dynamic scope labeling (Full Month vs Month-to-Date vs Single Day)
    const todayStr = getToday();
    const currentMonthStr = getCurrentMonth();
    const scopeText = data.exportScope === 'day'
        ? `Single Day (${data.targetPeriod})`
        : (data.targetPeriod === currentMonthStr)
            ? `Month-to-Date (${data.targetPeriod}-01 to ${todayStr})`
            : `Full Month (${data.targetPeriod})`;
    // Look for a frozen snapshot if this month was already closed!
    const periodMonth = data.targetPeriod.substring(0, 7);
    const closedMonthObj = closedMonths?.find(c => (typeof c === 'string' ? c : c.month) === periodMonth);
    const activeCategories = (closedMonthObj && Array.isArray(closedMonthObj.category_snapshot) && closedMonthObj.category_snapshot.length > 0)
        ? closedMonthObj.category_snapshot
        : categories;
    // --- SHEET 1: EXECUTIVE SUMMARY & CATEGORIES ---
    const summarySheet = wb.addWorksheet('Summary & Categories');

    // Expand column widths to fit the new Notes section
    summarySheet.columns = [
        { header: '', key: 'name', width: 35 },
        { header: '', key: 'type', width: 15 },
        { header: '', key: 'alloc', width: 15 },
        { header: '', key: 'budget', width: 15 },
        { header: '', key: 'spentScope', width: 15 },
        { header: '', key: 'spentMtd', width: 15 },
        { header: '', key: 'rem', width: 15 },
        { header: '', key: 'util', width: 25 }, // Widened to hold "Notes"
    ];

    summarySheet.addRow(['OFFICIAL FINANCIAL AUDIT REPORT']).font = { size: 16, bold: true };
    summarySheet.addRow([`Report Scope: ${scopeText}`]);
    summarySheet.addRow([]);

    summarySheet.addRow(['EXECUTIVE CASH FLOW SUMMARY']).font = { bold: true, size: 12 };

    // Add the Metric | Amount | Notes header
    const execHeader = summarySheet.addRow(['Metric', 'Amount', 'Notes']);
    execHeader.font = { bold: true };
    execHeader.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };

    // Helper to format the currency column in the summary block
    const formatAmt = (row) => {
        row.getCell(2).numFmt = `"${data.currency}" #,##0.00;[Red]-"${data.currency}" #,##0.00`;
    };

    const row1 = summarySheet.addRow(['Monthly Net Salary Baseline', data.parsedSalary, '100% Allocation Base']);
    formatAmt(row1);

    const periodLabel = data.exportScope === 'day' ? `Spent on ${data.targetPeriod}` : `Total Period Expenses`;
    const row2 = summarySheet.addRow([periodLabel, -data.periodSpent, `${data.groupedScopedExps.length} ledger entries`]);
    formatAmt(row2);

    // Dynamically insert Cumulative MTD row if looking at a single day
    if (data.exportScope === 'day') {
        const row2b = summarySheet.addRow([`Cumulative Month-to-Date Spent (Up to ${data.targetPeriod})`, -data.cumulativeMonthSpent, "Includes prior days in this month"]);
        formatAmt(row2b);
    }

    const totalAssetPerc = activeCategories.filter(c => c.type === 'asset').reduce((s, c) => s + c.percentage, 0);
    const row3 = summarySheet.addRow(['Automated Monthly Savings Allocation', data.monthlyAssetsAllocated, `${Math.round(totalAssetPerc)}% of salary`]);
    formatAmt(row3);

    const remPerc = data.parsedSalary > 0 ? ((data.trueMonthRemaining / data.parsedSalary) * 100).toFixed(1) : 0;
    const row4 = summarySheet.addRow(['True Remaining Monthly Cash', data.trueMonthRemaining, `${remPerc}% of salary left`]);
    formatAmt(row4);

    summarySheet.addRow([]);
    summarySheet.addRow([]);

    // Format the category headers
    const catHeader = summarySheet.addRow(['Category Name', 'Type', 'Allocation %', 'Monthly Budget', 'Spent (Period)', 'Spent (MTD)', 'Remaining', 'Utilization %']);
    catHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    catHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };

    activeCategories.forEach(cat => {
        const catBudget = data.parsedSalary * (cat.percentage / 100);
        const spentInScope = data.scopedExps.filter(e => e.category_id === cat.id).reduce((s, e) => s + parseFloat(e.cost), 0);
        const spentMtd = data.cumulativeMonthExps.filter(e => e.category_id === cat.id).reduce((s, e) => s + parseFloat(e.cost), 0);
        const rem = Math.max(0, catBudget - spentMtd);
        const util = catBudget > 0 ? (spentMtd / catBudget) : 0;

        const row = summarySheet.addRow([
            cat.name,
            cat.type === 'asset' ? 'Wealth Asset' : 'Expense',
            (cat.percentage / 100),
            catBudget,
            spentInScope,
            spentMtd,
            rem,
            util
        ]);

        row.getCell(3).numFmt = '0.0%';
        row.getCell(8).numFmt = '0.0%';
        [4, 5, 6, 7].forEach(colIndex => {
            row.getCell(colIndex).numFmt = `"${data.currency}" #,##0.00`;
        });
    });

    // --- SHEET 2: TRANSACTION LEDGER ---
    const ledgerSheet = wb.addWorksheet('Transaction Ledger');
    ledgerSheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Entry Type', key: 'type', width: 25 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Description / Item', key: 'description', width: 45 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Funding Breakdown', key: 'breakdown', width: 40 },
    ];

    ledgerSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ledgerSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };

    // Apply Auto-Filter to the Ledger Header Row!
    ledgerSheet.autoFilter = 'A1:F1';

    const sortedGrouped = [...data.groupedScopedExps].sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));

    sortedGrouped.forEach(entry => {
        if (entry.bundle_id) {
            ledgerSheet.addRow({
                date: entry.expense_date,
                type: 'Special Occasion (Master)',
                category: 'Multiple',
                description: `${entry.name} (${entry.items.length} items)`,
                amount: -entry.cost,
                breakdown: entry.categorySplits.join(" | ")
            }).font = { bold: true };

            entry.items.forEach(item => {
                const itemCategoryBreakdown = Object.entries(item.allocations || {})
                    .filter(([, amt]) => parseFloat(amt) > 0)
                    .map(([cId, amt]) => `${activeCategories.find(c => c.id === cId)?.name || 'Category'}: ${parseFloat(amt).toFixed(2)}`)
                    .join(" | ");

                const itemRow = ledgerSheet.addRow({
                    date: entry.expense_date,
                    type: '  ↳ Occasion Receipt Item',
                    category: '-',
                    description: `   • ${item.name}`,
                    amount: -item.cost,
                    breakdown: itemCategoryBreakdown
                });
                itemRow.font = { italic: true, color: { argb: 'FF4B5563' } };
            });
        } else {
            ledgerSheet.addRow({
                date: entry.expense_date,
                type: 'Standard Expense',
                category: entry.category,
                description: entry.name,
                amount: -entry.cost,
                breakdown: `${entry.category}: ${parseFloat(entry.cost).toFixed(2)}`
            });
        }
    });

    // Red minus formatting for negative numbers
    ledgerSheet.getColumn('amount').numFmt = `"${data.currency}" #,##0.00;[Red]-"${data.currency}" #,##0.00`;

    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Audit_Ledger_${data.targetPeriod}.xlsx`);
};

export const generateVisualDashboard = async (data) => {
    const wb = new ExcelJS.Workbook();
    // Turn off gridlines to make it look like a dashboard UI
    const sheet = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
    const { targetPeriod, exportScope, currency, parsedSalary, periodSpent, cumulativeMonthSpent, monthlyAssetsAllocated, trueMonthRemaining, categories = [], groupedScopedExps, scopedExps, cumulativeMonthExps, scopedAdjs, closedMonths = [] } = reportData;
    const todayStr = getToday();
    const currentMonthStr = getCurrentMonth();
    const scopeText = data.exportScope === 'day'
        ? `Single Day (${data.targetPeriod})`
        : (data.targetPeriod === currentMonthStr)
            ? `Month-to-Date (${data.targetPeriod}-01 to ${todayStr})`
            : `Full Month (${data.targetPeriod})`;
    // Look for a frozen snapshot if this month was already closed!
    const periodMonth = data.targetPeriod.substring(0, 7);
    const closedMonthObj = closedMonths?.find(c => (typeof c === 'string' ? c : c.month) === periodMonth);
    const activeCategories = (closedMonthObj && Array.isArray(closedMonthObj.category_snapshot) && closedMonthObj.category_snapshot.length > 0)
        ? closedMonthObj.category_snapshot
        : categories;
    // Paint background a soft UI gray (slate-50)
    for (let i = 1; i <= 200; i++) {
        sheet.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }

    // --- 1. DASHBOARD HEADER ---
    sheet.mergeCells('B2:E3');
    const title = sheet.getCell('B2');
    title.value = `PERSONAL FINANCIAL DASHBOARD`;
    title.font = { size: 22, bold: true, color: { argb: 'FF0F172A' } };
    title.alignment = { vertical: 'middle' };

    sheet.getCell('B4').value = `Period: ${scopeText}   |   Currency: ${data.currency}`;
    sheet.getCell('B4').font = { size: 12, italic: true, color: { argb: 'FF64748B' } };

    // --- 2. EXECUTIVE METRIC BLOCKS ---
    const summaries = [
        { label: 'NET INCOME', value: data.parsedSalary, color: 'FF3B82F6' }, // Blue
        { label: 'TOTAL SPENT', value: data.cumulativeMonthSpent, color: 'FFEF4444' }, // Red
        { label: 'SAVED / ASSETS', value: data.monthlyAssetsAllocated, color: 'FF10B981' }, // Green
        { label: 'REMAINING CASH', value: data.trueMonthRemaining, color: 'FF8B5CF6' }, // Purple
    ];

    summaries.forEach((sum, idx) => {
        const colCode = 66 + (idx * 2);
        const colLetter = String.fromCharCode(colCode);
        const nextLetter = String.fromCharCode(colCode + 1);

        sheet.mergeCells(`${colLetter}6:${nextLetter}6`);
        sheet.mergeCells(`${colLetter}7:${nextLetter}7`);

        const labelCell = sheet.getCell(`${colLetter}6`);
        labelCell.value = sum.label;
        labelCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sum.color } };
        labelCell.alignment = { horizontal: 'center', vertical: 'middle' };

        const valCell = sheet.getCell(`${colLetter}7`);
        valCell.value = sum.value;
        valCell.numFmt = `"${data.currency}" #,##0.00`;
        valCell.font = { size: 16, bold: true, color: { argb: 'FF0F172A' } };
        valCell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
        valCell.border = {
            bottom: { style: 'medium', color: { argb: sum.color } },
            left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
    });

    // --- 3. SIDE-BY-SIDE CATEGORY TABLES ---
    let startCol = 2; // Start rendering categories at column B
    const startRow = 10;

    activeCategories.forEach((cat) => {
        const c1 = sheet.getColumn(startCol).letter;     // Item Name
        const c2 = sheet.getColumn(startCol + 1).letter; // Date
        const c3 = sheet.getColumn(startCol + 2).letter; // Amount 

        // Category Header Bar
        sheet.mergeCells(`${c1}${startRow}:${c3}${startRow}`);
        const header = sheet.getCell(`${c1}${startRow}`);
        header.value = cat.name.toUpperCase();
        header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };

        // Emerald for Assets, Indigo for Expenses
        const headerColor = cat.type === 'asset' ? 'FF10B981' : 'FF6366F1';
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: headerColor } };
        header.alignment = { horizontal: 'center', vertical: 'middle' };

        // Table Column Headers
        const subHeaders = [`${c1}${startRow + 1}`, `${c2}${startRow + 1}`, `${c3}${startRow + 1}`];
        sheet.getCell(subHeaders[0]).value = 'Item';
        sheet.getCell(subHeaders[1]).value = 'Date';
        sheet.getCell(subHeaders[2]).value = 'Amount';

        subHeaders.forEach(cell => {
            const cellRef = sheet.getCell(cell);
            cellRef.font = { bold: true, size: 10, color: { argb: 'FF475569' } };
            cellRef.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
            cellRef.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        });

        let currentRow = startRow + 2;
        const catBudget = data.parsedSalary * (cat.percentage / 100);
        const catExps = data.scopedExps.filter(e => e.category_id === cat.id);

        // Calculate money spent prior to this export scope for accurate running totals!
        const priorMtdExps = data.cumulativeMonthExps.filter(e => e.category_id === cat.id && !catExps.includes(e));
        let runningSpent = priorMtdExps.reduce((s, e) => s + parseFloat(e.cost), 0);

        catExps.forEach(exp => {
            let itemName = exp.name;
            if (exp.bundle_id) {
                const bundle = data.groupedScopedExps.find(b => b.bundle_id === exp.bundle_id);
                if (bundle) itemName = `✨ ${bundle.name.replace('✨ ', '')} (Split)`;
            }

            const itemCost = parseFloat(exp.cost);
            runningSpent += itemCost;
            const isOverBudget = catBudget > 0 && runningSpent > catBudget;

            sheet.getCell(`${c1}${currentRow}`).value = itemName;
            sheet.getCell(`${c1}${currentRow}`).font = { size: 10, color: { argb: isOverBudget ? 'FFDC2626' : 'FF334155' } };
            sheet.getCell(`${c1}${currentRow}`).alignment = { wrapText: true, vertical: 'top' }; // <--- ADD THIS LINE

            sheet.getCell(`${c2}${currentRow}`).value = exp.expense_date.slice(5);
            sheet.getCell(`${c2}${currentRow}`).font = { size: 10, color: { argb: isOverBudget ? 'FFEF4444' : 'FF94A3B8' } };

            const amtCell = sheet.getCell(`${c3}${currentRow}`);
            amtCell.value = itemCost;
            amtCell.numFmt = `"${data.currency}" #,##0.00`;
            amtCell.font = { size: 10, color: { argb: isOverBudget ? 'FFDC2626' : 'FF0F172A' }, bold: isOverBudget };

            // Highlight the entire row soft red if it breaks the budget ceiling
            if (isOverBudget) {
                [`${c1}${currentRow}`, `${c2}${currentRow}`, `${c3}${currentRow}`].forEach(cell => {
                    sheet.getCell(cell).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                });
            }

            currentRow++;
        });

        currentRow++; // Blank spacing row

        const catSpent = data.cumulativeMonthExps.filter(e => e.category_id === cat.id).reduce((s, e) => s + parseFloat(e.cost), 0);
        const catRem = Math.max(0, catBudget - catSpent);

        const writeTotal = (row, label, val, isRed, isGreen, isSpentRow) => {
            sheet.getCell(`${c1}${row}`).value = label;
            sheet.getCell(`${c1}${row}`).font = { bold: true, size: 10, color: { argb: 'FF64748B' } };

            sheet.mergeCells(`${c2}${row}:${c3}${row}`);
            const vCell = sheet.getCell(`${c2}${row}`);
            vCell.value = val;
            vCell.numFmt = `"${data.currency}" #,##0.00`;

            let color = 'FF0F172A';
            if (isRed) color = 'FFEF4444';
            if (isGreen) color = 'FF10B981';
            vCell.font = { bold: true, size: 11, color: { argb: color } };
            vCell.alignment = { horizontal: 'right' };
        };

        writeTotal(currentRow, 'BUDGET:', catBudget, false, false, false);
        writeTotal(currentRow + 1, 'SPENT (MTD):', catSpent, true, false, true);
        writeTotal(currentRow + 2, 'REMAINING:', catRem, false, true, false);

        // Set strict column widths so the side-by-side tables look identical
        sheet.getColumn(startCol).width = 32;
        sheet.getColumn(startCol + 1).width = 12;
        sheet.getColumn(startCol + 2).width = 15;

        // Add a narrow spacer column between categories
        sheet.getColumn(startCol + 3).width = 4;
        startCol += 4; // Shift 4 columns to the right for the next Category block
    });

    const buffer = await wb.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `Visual_Dashboard_${data.targetPeriod}.xlsx`);
};