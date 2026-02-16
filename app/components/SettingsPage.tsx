'use client';

import { Plus, ToggleLeft } from 'lucide-react';
import { useState } from 'react';

export default function SettingsPage() {
  const [statusThresholds, setStatusThresholds] = useState({
    taskersWithoutComments: { critical: 5, problematic: 3, good: 1 },
    overdueTaskers: { critical: 5, problematic: 3, good: 1 },
    unitDataComplete: { critical: 70, problematic: 80, good: 95 },
  });

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* MY ACCOUNT SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 pb-4 border-b border-border">MY ACCOUNT</h2>

          <div className="space-y-2 sm:space-y-3 sm:ml-6">
            <div className="py-2">
              <p className="text-sm sm:text-base font-semibold">Link Presaling Account</p>
              <p className="text-xs sm:text-sm text-muted-foreground">(auto-links if presaling email is present)</p>
            </div>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Sync taskers to google calendar
            </button>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Change Display Name
            </button>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Change phone
            </button>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Change Email
            </button>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Change Password
            </button>

            <button className="w-full text-left py-2 px-3 sm:px-4 rounded hover:bg-muted transition-colors text-sm sm:text-base">
              Billing Settings
            </button>
          </div>
        </section>

        {/* PROJECT SETTINGS SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-lg sm:text-xl font-bold mb-6 sm:mb-8 pb-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-4">
            PROJECT SETTINGS FOR
            <select className="border border-input rounded px-2 sm:px-3 py-1 sm:py-2 bg-background text-foreground text-sm">
              <option>Cherry</option>
              <option>Project 1</option>
              <option>Project 2</option>
            </select>
            <button className="w-full sm:w-auto sm:ml-auto border-2 border-foreground px-4 sm:px-6 py-2 rounded font-semibold hover:bg-muted transition-colors text-sm sm:text-base">
              CREATE NEW PROJECT
            </button>
          </h2>

        
        {/* USERS AND PERMISSIONS SECTION */}
        <section>
          <h2 className="text-xl font-bold mb-6 bg-muted px-4 py-3 rounded">USERS AND PERMISSIONS</h2>

          {/* Permissions Table */}
          <div className="overflow-x-auto border border-input rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted border-b border-input">
                  <th className="px-4 py-3 text-left font-semibold">NAME</th>
                  <th className="px-4 py-3 text-left font-semibold">Email</th>
                  <th className="px-4 py-3 text-left font-semibold">TASKERS</th>
                  <th className="px-4 py-3 text-left font-semibold">UNIT DATA</th>
                  <th className="px-4 py-3 text-left font-semibold">FILES</th>
                  <th className="px-4 py-3 text-left font-semibold">ACCOUNTS</th>
                  <th className="px-4 py-3 text-left font-semibold">REPORTS</th>
                  <th className="px-4 py-3 text-left font-semibold">TEMPLATES</th>
                  <th className="px-4 py-3 text-left font-semibold">MEETINGS</th>
                  <th className="px-4 py-3 text-left font-semibold">USER LOGS</th>
                  <th className="px-4 py-3 text-left font-semibold">Project Permissions</th>
                  <th className="px-4 py-3 text-left font-semibold">Work Roles</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-input hover:bg-muted/50">
                  <td className="px-4 py-3">Jim Bob</td>
                  <td className="px-4 py-3">jim@example.com</td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View Only</option>
                      <option>Suggest Change</option>
                      <option>View Suggested Change</option>
                      <option>Approve Changes</option>
                      <option>Edit</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View / Don't view</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>Project Owner</option>
                      <option>Transfer Ownership (Only 1 owner on each project)</option>
                      <option>Project Manager (can change all permissions on a project)</option>
                      <option>Property Manager (coming soon)</option>
                      <option>Limited Partner (no view perms, only receives emailed reports)</option>
                      <option>Accountant (views financial records only)</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>Administrative</option>
                      <option>Capex</option>
                      <option>Financial</option>
                      <option>Legal</option>
                      <option>Management</option>
                      <option>Misc</option>
                      <option>Strategic</option>
                      <option>Workflow</option>
                    </select>
                  </td>
                </tr>
                <tr className="border-b border-input hover:bg-muted/50">
                  <td className="px-4 py-3">Michael Douglas</td>
                  <td className="px-4 py-3">michael@example.com</td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View Only</option>
                      <option>Suggest Change</option>
                      <option>View Suggested Change</option>
                      <option>Approve Changes</option>
                      <option>Edit</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View...</option>
                      <option>Edit</option>
                      <option>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>View / Don't view</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>Project Owner</option>
                      <option>Transfer Ownership (Only 1 owner on each project)</option>
                      <option>Project Manager (can change all permissions on a project)</option>
                      <option>Property Manager (coming soon)</option>
                      <option>Limited Partner (no view perms, only receives emailed reports)</option>
                      <option>Accountant (views financial records only)</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                      <option>Administrative</option>
                      <option>Capex</option>
                      <option>Financial</option>
                      <option>Legal</option>
                      <option>Management</option>
                      <option>Misc</option>
                      <option>Strategic</option>
                      <option>Workflow</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Add User Button */}
          <button className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
            <Plus className="h-4 w-4" />
            Add User
          </button>
        </section>

          {/* EMAIL READING SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">EMAIL READING</h3>
            <div className="space-y-2 ml-4">
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Link Company Gmail
              </button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Autoforwarding
              </button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Summarize prompt
              </button>
              <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
                Notify if
              </button>
            </div>
          </div>

          {/* LINK BANK ACCOUNT SECTION */}
          <div className="mb-8 ml-6">
            <button className="w-full text-left py-2 px-4 rounded hover:bg-muted transition-colors">
              Link Bank Account
            </button>
            <p className="text-sm text-muted-foreground ml-4 mt-1">(do via Plaid)</p>
          </div>

          {/* STATUS THRESHOLDS SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-4 bg-muted px-3 py-2 rounded">STATUS THRESHOLDS</h3>
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold">Metric</th>
                    <th className="px-4 py-3 text-center font-semibold">Critical</th>
                    <th className="px-4 py-3 text-center font-semibold">Problematic</th>
                    <th className="px-4 py-3 text-center font-semibold">Good</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Taskers without comments</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.taskersWithoutComments.critical}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.taskersWithoutComments.problematic}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.taskersWithoutComments.good}</td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Overdue taskers</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.overdueTaskers.critical}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.overdueTaskers.problematic}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.overdueTaskers.good}</td>
                  </tr>
                  <tr className="border-b border-input hover:bg-muted/50">
                    <td className="px-4 py-3">Unit Data % Complete</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.unitDataComplete.critical}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.unitDataComplete.problematic}</td>
                    <td className="px-4 py-3 text-center">{statusThresholds.unitDataComplete.good}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* UNIT DATA SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 px-3 py-2 rounded">UNIT DATA</h3>
            <div className="ml-4">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Allow Users to customize their display</span>
              </label>
              <div className="flex gap-4 ml-6 text-sm">
                <button className="px-3 py-1 rounded border border-input hover:bg-muted transition-colors">Yes</button>
                <button className="px-3 py-1 rounded border border-input hover:bg-muted transition-colors">No</button>
              </div>
            </div>
          </div>

          {/* DISPO SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3">DISPO</h3>
            <div className="ml-4 space-y-3">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Open for Offers</span>
              </label>
              <div className="ml-6 text-sm">
                <label className="flex items-center gap-2 py-2">
                  <input type="checkbox" className="w-4 h-4" />
                  <span>Control what data to share</span>
                </label>
              </div>
            </div>
          </div>

          {/* FINANCIAL SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">FINANCIAL</h3>
            <div className="ml-4 space-y-2">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>GROSS INCOME</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>EXPENSES</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>LOANS</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>CASHFLOW</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>DISBURSEMENTS</span>
              </label>
            </div>
          </div>

          {/* UNIT DATA DISPLAY OPTIONS */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">UNIT DATA</h3>
            <div className="ml-4 space-y-2">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Rent Info</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Rent Collections</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Property Info</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>Tenant Info (is it present?)</span>
              </label>
            </div>
          </div>

          {/* FILES SECTION */}
          <div className="mb-8 ml-6">
            <h3 className="text-lg font-bold mb-3 text-foreground">FILES</h3>
            <div className="ml-4 space-y-2">
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span>🖹 Dispo</span>
              </label>
              <label className="flex items-center gap-2 py-2">
                <input type="checkbox" className="w-4 h-4" />
                <span className="text">● PUBLIC Folder</span>
              </label>
            </div>
          </div>
        </section>

      </div>
    </main>
  );
}
