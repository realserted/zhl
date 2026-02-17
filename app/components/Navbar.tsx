'use client';

import { useState, useRef, useEffect } from 'react';
import NavLogo from './NavLogo';
import NavTabs from './NavTabs';
import NavActions from './NavActions';
import NavUserProfile from './NavUserProfile';
import { ThemeToggle } from './ThemeToggle';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { Project } from '../../lib/types/project';

interface NavbarProps {
  projects: Project[];
  selectedProject: Project | null;
  onProjectChange: (project: Project) => void;
  onTabChange?: (tabId: string) => void;
}

export default function Navbar({ projects, selectedProject, onProjectChange, onTabChange }: NavbarProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(event.target as Node)
      ) {
        if (openDropdown === 'project') setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  const tabs = [
    { id: 'overview', label: 'OVERVIEW', badge: '3 Alerts' },
    { id: 'taskers', label: 'TASKERS', badge: '2 due soon' },
    { id: 'unitdata', label: 'UNIT DATA', badge: '2 Issues' },
    { id: 'files', label: 'FILES' },
    { id: 'accounts', label: 'ACCOUNTS' },
    { id: 'financial', label: 'FINANCIAL', badge: '2 Issues' },
    { id: 'templates', label: 'TEMPLATES' },
    { id: 'meetings', label: 'MEETINGS & AVAILABILITY' },
    { id: 'issues', label: 'TENANT ISSUES' },
    { id: 'logs', label: 'USER LOGS' },
    { id: 'admin', label: 'ADMIN PANEL' },
    { id: 'settings', label: 'SETTINGS' },
  ];

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    onTabChange?.(tabId);
  };

  return (
    <nav className="sticky top-0 z-50 w-full bg-background border-b border-border dark:border-border">
      {/* Back Button */}
      <div className="px-3 sm:px-6 py-2 border-b border-border">
        <a
          href="https://presaling.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-foreground hover:text-accent transition-colors"
        >
          <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline">Back to PRESALING</span>
          <span className="sm:hidden">Back</span>
        </a>
      </div>

      {/* Top Navigation Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-border gap-3 sm:gap-0">
        <NavLogo />

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8 w-full sm:w-auto">
          {/* Project and Projects Dropdowns */}
          <div className="flex gap-4 sm:gap-8 items-center">
            {/* Project Label */}
            <span className="text-xs sm:text-sm font-semibold text-foreground whitespace-nowrap">Project</span>

            {/* Projects Dropdown */}
            <div className="relative" ref={projectDropdownRef}>
              <button
                onClick={() =>
                  setOpenDropdown(openDropdown === 'project' ? null : 'project')
                }
                className="text-xs sm:text-sm font-semibold text-foreground hover:text-accent transition-colors flex items-center gap-2"
              >
                {selectedProject?.name ?? 'Select Project'}
                <ChevronDown
                  className={`h-3 w-3 sm:h-4 sm:w-4 transition-transform ${
                    openDropdown === 'project' ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {openDropdown === 'project' && (
                <div className="absolute top-full left-0 mt-2 w-32 sm:w-48 bg-background border border-input rounded-lg shadow-lg z-50">
                  {projects.length === 0 ? (
                    <div className="px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-muted-foreground">
                      No projects yet
                    </div>
                  ) : (
                    projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => {
                          onProjectChange(project);
                          setOpenDropdown(null);
                        }}
                        className={`w-full text-left px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm hover:bg-muted transition-colors ${
                          selectedProject?.id === project.id
                            ? 'bg-muted font-semibold text-accent'
                            : ''
                        }`}
                      >
                        {project.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Status and Actions */}
          <div className="hidden sm:block">
            <NavActions projectStatus={selectedProject?.status} />
          </div>
        </div>

        {/* Right Section: Theme Toggle and User Profile */}
        <div className="flex items-center gap-2 sm:gap-4 ml-auto sm:ml-0 sm:border-l sm:border-border sm:pl-6">
          <ThemeToggle />
          <NavUserProfile />
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="px-6 py-4 border-b border-border">
        <NavTabs tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />
      </div>
    </nav>
  );
}
