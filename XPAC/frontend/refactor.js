const fs = require('fs');
let file = fs.readFileSync('src/pages/Commission.tsx', 'utf8');

file = file.replace(/import IncentivesPayoutModal from '\.\.\/modals\/IncentivesPayoutModal';/, 
  "import IncentivesPayoutModal from '../modals/IncentivesPayoutModal';\nimport BonusPayoutModal from '../modals/BonusPayoutModal';");

file = file.replace(/useState\<'earnings' \| 'payouts' \| 'incentives'\>/g, 
  "useState<'earnings' | 'payouts' | 'incentives' | 'bonus'>");

file = file.replace(/const \[visibleColumnsIncentives, setVisibleColumnsIncentives\] = useState\<string\[\]\>\(incentivesColumns\.map\(c =\> c\.key\)\);/, 
  "const [visibleColumnsIncentives, setVisibleColumnsIncentives] = useState<string[]>(incentivesColumns.map(c => c.key));\n    const [visibleColumnsBonus, setVisibleColumnsBonus] = useState<string[]>(incentivesColumns.map(c => c.key));");

file = file.replace(/const \[columnOrderIncentives, setColumnOrderIncentives\] = useState\<string\[\]\>\(\(\) =\> \{\n.*?return parsed;\n        \}\n        return incentivesColumns\.map\(c =\> c\.key\);\n    \}\);/s,
  match => match + "\n\n    const [columnOrderBonus, setColumnOrderBonus] = useState<string[]>(() => {\n        const saved = localStorage.getItem('commissionBonusColumnOrder');\n        if (saved) {\n            const parsed = JSON.parse(saved);\n            if (!parsed.includes('type')) {\n                parsed.splice(2, 0, 'type');\n            }\n            return parsed;\n        }\n        return incentivesColumns.map(c => c.key);\n    });");

file = file.replace(/const \[showIncentiveModal, setShowIncentiveModal\] = useState\(false\);/, 
  "const [showIncentiveModal, setShowIncentiveModal] = useState(false);\n    const [showBonusModal, setShowBonusModal] = useState(false);");

file = file.replace(/handleToggleColumn = \(columnKey: string\) =\> \{\n        if \(activeTab === 'earnings'\) \{\n            setVisibleColumnsEarnings\(prev =\>\n                prev\.includes\(columnKey\) \? prev\.filter\(k =\> k !== columnKey\) : \[\.\.\.prev, columnKey\]\n            \);\n        \} else if \(activeTab === 'payouts'\) \{\n            setVisibleColumnsPayouts\(prev =\>\n                prev\.includes\(columnKey\) \? prev\.filter\(k =\> k !== columnKey\) : \[\.\.\.prev, columnKey\]\n            \);\n        \} else \{\n            setVisibleColumnsIncentives\(prev =\>\n                prev\.includes\(columnKey\) \? prev\.filter\(k =\> k !== columnKey\) : \[\.\.\.prev, columnKey\]\n            \);\n        \}\n    \};/,
  `handleToggleColumn = (columnKey: string) => {
        if (activeTab === 'earnings') {
            setVisibleColumnsEarnings(prev => prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]);
        } else if (activeTab === 'payouts') {
            setVisibleColumnsPayouts(prev => prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]);
        } else if (activeTab === 'incentives') {
            setVisibleColumnsIncentives(prev => prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]);
        } else {
            setVisibleColumnsBonus(prev => prev.includes(columnKey) ? prev.filter(k => k !== columnKey) : [...prev, columnKey]);
        }
    };`);

file = file.replace(/handleSelectAllColumns = \(\) =\> \{\n        if \(activeTab === 'earnings'\) \{\n            setVisibleColumnsEarnings\(earningsColumns\.map\(c =\> c\.key\)\);\n        \} else if \(activeTab === 'payouts'\) \{\n            setVisibleColumnsPayouts\(payoutColumns\.map\(c =\> c\.key\)\);\n        \} else \{\n            setVisibleColumnsIncentives\(incentivesColumns\.map\(c =\> c\.key\)\);\n        \}\n    \};/,
  `handleSelectAllColumns = () => {
        if (activeTab === 'earnings') setVisibleColumnsEarnings(earningsColumns.map(c => c.key));
        else if (activeTab === 'payouts') setVisibleColumnsPayouts(payoutColumns.map(c => c.key));
        else if (activeTab === 'incentives') setVisibleColumnsIncentives(incentivesColumns.map(c => c.key));
        else setVisibleColumnsBonus(incentivesColumns.map(c => c.key));
    };`);

file = file.replace(/handleDeselectAllColumns = \(\) =\> \{\n        if \(activeTab === 'earnings'\) \{\n            setVisibleColumnsEarnings\(\[\]\);\n        \} else if \(activeTab === 'payouts'\) \{\n            setVisibleColumnsPayouts\(\[\]\);\n        \} else \{\n            setVisibleColumnsIncentives\(\[\]\);\n        \}\n    \};/,
  `handleDeselectAllColumns = () => {
        if (activeTab === 'earnings') setVisibleColumnsEarnings([]);
        else if (activeTab === 'payouts') setVisibleColumnsPayouts([]);
        else if (activeTab === 'incentives') setVisibleColumnsIncentives([]);
        else setVisibleColumnsBonus([]);
    };`);

file = file.replace(/const currentCols = activeTab === 'earnings'\n            \? earningsColumns\n            : activeTab === 'payouts'\n                \? payoutColumns\n                : incentivesColumns;/,
  `const currentCols = activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : incentivesColumns;`);

file = file.replace(/const visibleCols = activeTab === 'earnings'\n            \? visibleColumnsEarnings\n            : activeTab === 'payouts'\n                \? visibleColumnsPayouts\n                : visibleColumnsIncentives;/,
  `const visibleCols = activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus;`);

file = file.replace(/const currentOrder = activeTab === 'earnings'\n            \? columnOrderEarnings\n            : activeTab === 'payouts'\n                \? columnOrderPayouts\n                : columnOrderIncentives;/,
  `const currentOrder = activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus;`);

file = file.replace(/const currentWidth = columnWidths\[columnKey\] \|\| \(activeTab === 'earnings'\n            \? earningsColumns\.find\(c =\> c\.key === columnKey\)\?\.minWidth\n            : activeTab === 'payouts'\n                \? payoutColumns\.find\(c =\> c\.key === columnKey\)\?\.minWidth\n                : incentivesColumns\.find\(c =\> c\.key === columnKey\)\?\.minWidth\) \|\| 150;/,
  `const currentWidth = columnWidths[columnKey] || (activeTab === 'earnings' ? earningsColumns : activeTab === 'payouts' ? payoutColumns : incentivesColumns).find(c => c.key === columnKey)?.minWidth || 150;`);

file = file.replace(/const currentOrder = activeTab === 'earnings'\n            \? \[\.\.\.columnOrderEarnings\]\n            : activeTab === 'payouts'\n                \? \[\.\.\.columnOrderPayouts\]\n                : \[\.\.\.columnOrderIncentives\];/g,
  `const currentOrder = activeTab === 'earnings' ? [...columnOrderEarnings] : activeTab === 'payouts' ? [...columnOrderPayouts] : activeTab === 'incentives' ? [...columnOrderIncentives] : [...columnOrderBonus];`);

file = file.replace(/if \(activeTab === 'earnings'\) \{\n            setColumnOrderEarnings\(currentOrder\);\n            localStorage\.setItem\('commissionEarningsColumnOrder', JSON\.stringify\(currentOrder\)\);\n        \} else if \(activeTab === 'payouts'\) \{\n            setColumnOrderPayouts\(currentOrder\);\n            localStorage\.setItem\('commissionPayoutColumnOrder', JSON\.stringify\(currentOrder\)\);\n        \} else \{\n            setColumnOrderIncentives\(currentOrder\);\n            localStorage\.setItem\('commissionIncentivesColumnOrder', JSON\.stringify\(currentOrder\)\);\n        \}/,
  `if (activeTab === 'earnings') { setColumnOrderEarnings(currentOrder); localStorage.setItem('commissionEarningsColumnOrder', JSON.stringify(currentOrder)); } else if (activeTab === 'payouts') { setColumnOrderPayouts(currentOrder); localStorage.setItem('commissionPayoutColumnOrder', JSON.stringify(currentOrder)); } else if (activeTab === 'incentives') { setColumnOrderIncentives(currentOrder); localStorage.setItem('commissionIncentivesColumnOrder', JSON.stringify(currentOrder)); } else { setColumnOrderBonus(currentOrder); localStorage.setItem('commissionBonusColumnOrder', JSON.stringify(currentOrder)); }`);

file = file.replace(/if \(activeTab === 'incentives'\) \{\n            setShowIncentiveModal\(true\);\n        \} else \{\n            setShowPayoutModal\(true\);\n        \}/,
  `if (activeTab === 'incentives') setShowIncentiveModal(true); else if (activeTab === 'bonus') setShowBonusModal(true); else setShowPayoutModal(true);`);

file = file.replace(/const rawData = activeTab === 'earnings'\n            \? data\n            : activeTab === 'payouts'\n                \? payoutHistory\.filter\(\(item: any\) =\> !item\.type \|\| item\.type === 'commission'\)\n                : payoutHistory\.filter\(\(item: any\) =\> item\.type === 'incentives' \|\| item\.type === 'incentives_payout'\);/,
  `const rawData = activeTab === 'earnings' ? data : activeTab === 'payouts' ? payoutHistory.filter((item: any) => !item.type || item.type === 'commission') : activeTab === 'incentives' ? payoutHistory.filter((item: any) => item.type === 'incentives' || item.type === 'incentives_payout') : payoutHistory.filter((item: any) => item.type === 'bonus' || item.type === 'bonus_payout');`);

file = file.replace(/\<h2 className=\{`text-lg font-semibold \$\{isDarkMode \? 'text-white' : 'text-gray-900'\}`\}\>COMMISSIONS\<\/h2\>/,
  `<h2 className={\`text-lg font-semibold uppercase \${isDarkMode ? 'text-white' : 'text-gray-900'}\`}>\n                            {activeTab === 'incentives' ? 'INCENTIVES/BONUS' : activeTab === 'bonus' ? 'BONUS' : 'COMMISSIONS'}\n                        </h2>`);

file = file.replace(/\<SidebarItem id="incentives" label="Incentives\/Bonus" icon=\{Gift\} \/\>/,
  `<SidebarItem id="incentives" label="Incentives History" icon={Gift} />\n                        <SidebarItem id="bonus" label="Bonus History" icon={Gift} />`);

file = file.replace(/\(activeTab === 'earnings' \? visibleColumnsEarnings : activeTab === 'payouts' \? visibleColumnsPayouts : visibleColumnsIncentives\)/g,
  `(activeTab === 'earnings' ? visibleColumnsEarnings : activeTab === 'payouts' ? visibleColumnsPayouts : activeTab === 'incentives' ? visibleColumnsIncentives : visibleColumnsBonus)`);

file = file.replace(/\(activeTab === 'earnings' \? columnOrderEarnings : activeTab === 'payouts' \? columnOrderPayouts : columnOrderIncentives\)/g,
  `(activeTab === 'earnings' ? columnOrderEarnings : activeTab === 'payouts' ? columnOrderPayouts : activeTab === 'incentives' ? columnOrderIncentives : columnOrderBonus)`);

file = file.replace(/\<IncentivesPayoutModal([\s\S]*?)onSuccess=\{\(\) =\> \{\n                    setShowIncentiveModal\(false\);\n                    handleRefresh\(\);\n                \}\}\n                agentId=\{payoutAgent\?\.id\}\n                agentName=\{payoutAgent\?\.team_name\}\n            \/\>/,
  match => match + "\n\n            {showBonusModal && (\n                <BonusPayoutModal\n                    isOpen={showBonusModal}\n                    onClose={() => setShowBonusModal(false)}\n                    onSuccess={() => {\n                        fetchCommissions(true);\n                        setShowBonusModal(false);\n                    }}\n                    agentId={payoutAgent?.id}\n                    agentName={payoutAgent?.team_name}\n                />\n            )}");

fs.writeFileSync('src/pages/Commission.tsx', file);
console.log('done');
