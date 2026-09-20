const fs = require('fs');
let file = fs.readFileSync('src/pages/Commission.tsx', 'utf8');

// 1. Imports
file = file.replace(
    "import IncentivesPayoutModal from '../modals/IncentivesPayoutModal';",
    "import IncentivesPayoutModal from '../modals/IncentivesPayoutModal';\nimport BonusPayoutModal from '../modals/BonusPayoutModal';"
);

// 2. Tab Type
file = file.replace(
    "useState<'earnings' | 'payouts' | 'incentives'>('payouts');",
    "useState<'earnings' | 'payouts' | 'incentives' | 'bonus'>('payouts');"
);

// 3. Visible Columns
file = file.replace(
    "const [visibleColumnsIncentives, setVisibleColumnsIncentives] = useState<string[]>(incentivesColumns.map(c => c.key));",
    "const [visibleColumnsIncentives, setVisibleColumnsIncentives] = useState<string[]>(incentivesColumns.map(c => c.key));\n    const [visibleColumnsBonus, setVisibleColumnsBonus] = useState<string[]>(incentivesColumns.map(c => c.key));"
);

// 4. Modal States
file = file.replace(
    "const [showIncentiveModal, setShowIncentiveModal] = useState(false);",
    "const [showIncentiveModal, setShowIncentiveModal] = useState(false);\n    const [showBonusModal, setShowBonusModal] = useState(false);"
);

// 5. Column Order State
let columnOrderIncentivesStr = `const [columnOrderIncentives, setColumnOrderIncentives] = useState<string[]>(() => {
        const saved = localStorage.getItem('commissionIncentivesColumnOrder');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (!parsed.includes('type')) {
                parsed.splice(2, 0, 'type');
            }
            return parsed;
        }
        return incentivesColumns.map(c => c.key);
    });`;
let columnOrderBonusStr = `
    const [columnOrderBonus, setColumnOrderBonus] = useState<string[]>(() => {
        const saved = localStorage.getItem('commissionBonusColumnOrder');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (!parsed.includes('type')) {
                parsed.splice(2, 0, 'type');
            }
            return parsed;
        }
        return incentivesColumns.map(c => c.key);
    });`;
file = file.replace(columnOrderIncentivesStr, columnOrderIncentivesStr + columnOrderBonusStr);

// 6. HandleToggleColumn
let handleToggleColumnStr = `    const handleToggleColumn = (columnKey: string) => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else {
            setVisibleColumnsIncentives(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        }
    };`;
let newHandleToggleColumnStr = `    const handleToggleColumn = (columnKey: string) => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        } else {
            setVisibleColumnsBonus(prev =>
                prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]
            );
        }
    };`;
file = file.replace(handleToggleColumnStr, newHandleToggleColumnStr);

// 7. HandleSelectAllColumns
let handleSelectAllColumnsStr = `    const handleSelectAllColumns = () => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(earningsColumns.map(c => c.key));
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(payoutColumns.map(c => c.key));
        } else {
            setVisibleColumnsIncentives(incentivesColumns.map(c => c.key));
        }
    };`;
let newHandleSelectAllColumnsStr = `    const handleSelectAllColumns = () => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(earningsColumns.map(c => c.key));
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(payoutColumns.map(c => c.key));
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives(incentivesColumns.map(c => c.key));
        } else {
            setVisibleColumnsBonus(incentivesColumns.map(c => c.key));
        }
    };`;
file = file.replace(handleSelectAllColumnsStr, newHandleSelectAllColumnsStr);

// 8. HandleDeselectAllColumns
let handleDeselectAllColumnsStr = `    const handleDeselectAllColumns = () => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings([]);
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts([]);
        } else {
            setVisibleColumnsIncentives([]);
        }
    };`;
let newHandleDeselectAllColumnsStr = `    const handleDeselectAllColumns = () => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings([]);
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts([]);
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives([]);
        } else {
            setVisibleColumnsBonus([]);
        }
    };`;
file = file.replace(handleDeselectAllColumnsStr, newHandleDeselectAllColumnsStr);

// 9. HandleExport Cols
file = file.replace(
    /const currentCols = activeTab === 'earnings'\s*\? earningsColumns\s*: activeTab === 'payouts'\s*\? payoutColumns\s*: incentivesColumns;/,
    "const currentCols = activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : incentivesColumns;"
);

file = file.replace(
    /const visibleCols = activeTab === 'earnings'\s*\? visibleColumnsEarnings\s*: activeTab === 'payouts'\s*\? visibleColumnsPayouts\s*: visibleColumnsIncentives;/,
    "const visibleCols = activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus;"
);

file = file.replace(
    /const currentOrder = activeTab === 'earnings'\s*\? columnOrderEarnings\s*: activeTab === 'payouts'\s*\? columnOrderPayouts\s*: columnOrderIncentives;/g,
    "const currentOrder = activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus;"
);

file = file.replace(
    /const currentWidth = columnWidths\[columnKey\] \|\| \(activeTab === 'earnings'\s*\? earningsColumns\.find\(c => c\.key === columnKey\)\?\.minWidth\s*: activeTab === 'payouts'\s*\? payoutColumns\.find\(c => c\.key === columnKey\)\?\.minWidth\s*: incentivesColumns\.find\(c => c\.key === columnKey\)\?\.minWidth\) \|\| 150;/,
    "const currentWidth = columnWidths[columnKey] || (activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : incentivesColumns).find(c => c.key === columnKey)?.minWidth || 150;"
);

let dropOrderStr = `        const currentOrder = activeTab === 'earnings' 
            ? [...columnOrderEarnings] 
            : activeTab === 'payouts' 
                ? [...columnOrderPayouts] 
                : [...columnOrderIncentives];`;
let newDropOrderStr = `        const currentOrder = activeTab === 'earnings' ? [...columnOrderEarnings] : activeTab === 'payouts' ? [...columnOrderPayouts] : activeTab === 'incentives' ? [...columnOrderIncentives] : [...columnOrderBonus];`;
file = file.replace(dropOrderStr, newDropOrderStr);

let setOrderStr = `        if (activeTab === 'earnings') {
            setColumnOrderEarnings(currentOrder);
            localStorage.setItem('commissionEarningsColumnOrder', JSON.stringify(currentOrder));
        } else if (activeTab === 'payouts') {
            setColumnOrderPayouts(currentOrder);
            localStorage.setItem('commissionPayoutColumnOrder', JSON.stringify(currentOrder));
        } else {
            setColumnOrderIncentives(currentOrder);
            localStorage.setItem('commissionIncentivesColumnOrder', JSON.stringify(currentOrder));
        }`;
let newSetOrderStr = `        if (activeTab === 'earnings') {
            setColumnOrderEarnings(currentOrder);
            localStorage.setItem('commissionEarningsColumnOrder', JSON.stringify(currentOrder));
        } else if (activeTab === 'payouts') {
            setColumnOrderPayouts(currentOrder);
            localStorage.setItem('commissionPayoutColumnOrder', JSON.stringify(currentOrder));
        } else if (activeTab === 'incentives') {
            setColumnOrderIncentives(currentOrder);
            localStorage.setItem('commissionIncentivesColumnOrder', JSON.stringify(currentOrder));
        } else {
            setColumnOrderBonus(currentOrder);
            localStorage.setItem('commissionBonusColumnOrder', JSON.stringify(currentOrder));
        }`;
file = file.replace(setOrderStr, newSetOrderStr);

// 12. HandleOpenPayout
let handleOpenPayoutStr = `        if (activeTab === 'incentives') {
            setShowIncentiveModal(true);
        } else {
            setShowPayoutModal(true);
        }`;
let newHandleOpenPayoutStr = `        if (activeTab === 'incentives') {
            setShowIncentiveModal(true);
        } else if (activeTab === 'bonus') {
            setShowBonusModal(true);
        } else {
            setShowPayoutModal(true);
        }`;
file = file.replace(handleOpenPayoutStr, newHandleOpenPayoutStr);

// 13. SortedData filtering
let sortedDataStr = `        const rawData = activeTab === 'earnings' 
            ? data 
            : activeTab === 'payouts'
                ? payoutHistory.filter((item: any) => !item.type || item.type === 'commission')
                : payoutHistory.filter((item: any) => item.type === 'incentives' || item.type === 'incentives_payout');`;
let newSortedDataStr = `        const rawData = activeTab === 'earnings' ? data : activeTab === 'payouts' ? payoutHistory.filter((item: any) => !item.type || item.type === 'commission') : activeTab === 'incentives' ? payoutHistory.filter((item: any) => item.type === 'incentives' || item.type === 'incentives_payout') : payoutHistory.filter((item: any) => item.type === 'bonus' || item.type === 'bonus_payout');`;
file = file.replace(sortedDataStr, newSortedDataStr);

// 14. Title rendering
file = file.replace(
    "{activeTab === 'incentives' ? 'INCENTIVES/BONUS' : 'COMMISSIONS'}",
    "{activeTab === 'incentives' ? 'INCENTIVES' : activeTab === 'bonus' ? 'BONUS' : 'COMMISSIONS'}"
);
file = file.replace(
    "{activeTab === 'incentives' ? 'INCENTIVES/BONUS' : 'COMMISSIONS'}",
    "{activeTab === 'incentives' ? 'INCENTIVES' : activeTab === 'bonus' ? 'BONUS' : 'COMMISSIONS'}"
);
file = file.replace(
    ">COMMISSIONS</h2>",
    ">{activeTab === 'incentives' ? 'INCENTIVES' : activeTab === 'bonus' ? 'BONUS' : 'COMMISSIONS'}</h2>"
);

// 15. Sidebar items
file = file.replace(
    '<SidebarItem id="incentives" label="Incentives/Bonus" icon={Gift} />',
    '<SidebarItem id="incentives" label="Incentives History" icon={Gift} />\n                        <SidebarItem id="bonus" label="Bonus History" icon={Gift} />'
);
file = file.replace(
    '<SidebarItem id="incentives" label="Incentives History" icon={Gift} />',
    '<SidebarItem id="incentives" label="Incentives History" icon={Gift} />\n                        <SidebarItem id="bonus" label="Bonus History" icon={Gift} />'
);


// 16. Table headers and body maps
file = file.replace(/\(activeTab === 'earnings' \? columnOrderEarnings : activeTab === 'payouts' \? columnOrderPayouts : columnOrderIncentives\)/g, "(activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus)");
file = file.replace(/\(activeTab === 'earnings'\s*\?\s*visibleColumnsEarnings\s*:\s*activeTab === 'payouts'\s*\?\s*visibleColumnsPayouts\s*:\s*visibleColumnsIncentives\)/g, "(activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus)");

// 17. Modal component add
let modalStr = `            {/* Incentives Payout Modal */}
            <IncentivesPayoutModal
                isOpen={showIncentiveModal}
                onClose={() => setShowIncentiveModal(false)}
                onSuccess={() => {
                    setShowIncentiveModal(false);
                    handleRefresh();
                }}
                agentId={payoutAgent?.id}
                agentName={payoutAgent?.team_name}
            />`;
let bonusModalStr = `
            {/* Bonus Payout Modal */}
            <BonusPayoutModal
                isOpen={showBonusModal}
                onClose={() => setShowBonusModal(false)}
                onSuccess={() => {
                    setShowBonusModal(false);
                    handleRefresh();
                }}
                agentId={payoutAgent?.id}
                agentName={payoutAgent?.team_name}
            />`;
file = file.replace(modalStr, modalStr + bonusModalStr);

fs.writeFileSync('src/pages/Commission.tsx', file);
console.log('Done script');
