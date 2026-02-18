'use client';

interface Tab {
  id: string;
  label: string;
  badge?: string;
}

interface NavTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function NavTabs({ tabs, activeTab, onTabChange }: NavTabsProps) {
  return (
    <div className="flex flex-wrap items-center overflow-x-auto px-3 sm:px-0 gap-1 sm:gap-2 w-full justify-between">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex flex-col items-center gap-0.5 sm:gap-1 font-semibold text-xs sm:text-sm whitespace-nowrap px-3 sm:px-4 py-1 sm:py-1.5 rounded transition-colors ${
            activeTab === tab.id
              ? 'bg-green-500 text-white dark:bg-green-600'
              : 'text-foreground hover:bg-muted dark:hover:bg-muted'
          }`}
        >
          <span>{tab.label}</span>
          {tab.badge && (
            <span className="text-xs font-normal">
              🔔 {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
