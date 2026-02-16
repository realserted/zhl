'use client';

import { Plus, Upload } from 'lucide-react';
import { useState } from 'react';

export default function AdminPanelPage() {
  const [reportTypes, setReportTypes] = useState([
    'Wells Fargo Checki...',
    'Wells Fargo Checki...',
    'Bank of America Ch...',
    'Rent Vine Report',
    'Buildium Report',
    'Yardi Breeze Report',
    'Appfolio Report',
  ]);

  const [requests] = useState([
    { date: '2/15/2028 16:19:02', message: 'I want Chase bank statements!' },
  ]);

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* BROWSE ALL USER'S PROJECTS SECTION */}
        <section className="mb-8 sm:mb-12">
          <h2 className="text-lg sm:text-xl font-bold mb-4 sm:mb-6 pb-4 border-b border-border">BROWSE ALL USER'S PROJECTS</h2>

          <div className="overflow-x-auto border border-input rounded-lg">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="bg-muted border-b border-input">
                  <th className="px-4 py-3 text-left font-semibold">Project Name</th>
                  <th className="px-4 py-3 text-left font-semibold">Project Owner</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Units</th>
                  <th className="px-4 py-3 text-left font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-input hover:bg-muted/50">
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ADD NEW TEMPLATES SECTION */}
        <section className="mb-12">
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">ADD NEW TEMPLATES</h2>

          <div className="ml-6 space-y-6">
            {/* File Upload Area */}
            <div className="border-2 border-dashed border-input rounded-lg p-8 hover:bg-muted/50 transition-colors cursor-pointer">
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="font-semibold text-foreground">File free here</p>
              </div>
            </div>

            {/* Tasker Name AI Prompt */}
            <div>
              <label className="block text-sm font-semibold mb-2">Tasker name AI prompt</label>
              <textarea
                className="w-full border border-input rounded-md p-3 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Enter AI prompt for tasker name..."
              />
            </div>

            {/* Status AI Prompt */}
            <div>
              <label className="block text-sm font-semibold mb-2">Status AI prompt</label>
              <textarea
                className="w-full border border-input rounded-md p-3 bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                rows={3}
                placeholder="Enter AI prompt for status..."
              />
              <p className="text-xs text-muted-foreground mt-1">10 words max</p>
            </div>
          </div>
        </section>

        {/* REPORT TYPES SECTION */}
        <section className="mb-12">
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">REPORT TYPES</h2>

          <div className="ml-6 space-y-4">
            <div className="overflow-x-auto border border-input rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted border-b border-input">
                    <th className="px-4 py-3 text-left font-semibold">Type</th>
                    <th className="px-4 py-3 text-left font-semibold">AI Prompt</th>
                  </tr>
                </thead>
                <tbody>
                  {reportTypes.map((type, index) => (
                    <tr key={index} className="border-b border-input hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <select className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs">
                          <option>{type}</option>
                          <option>Wells Fargo Checki...</option>
                          <option>Bank of America Ch...</option>
                          <option>Rent Vine Report</option>
                          <option>Buildium Report</option>
                          <option>Yardi Breeze Report</option>
                          <option>Appfolio Report</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          className="border border-input rounded px-2 py-1 bg-background text-foreground text-xs w-full"
                          placeholder="Enter AI prompt..."
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add New Type Button */}
            <button className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
              <Plus className="h-4 w-4" />
              Add new type
            </button>
          </div>
        </section>

        {/* REQUESTS SECTION */}
        <section>
          <h2 className="text-lg font-bold mb-6 pb-3 border-b border-border">Requests</h2>

          <div className="ml-6 space-y-4">
            {requests.map((request, index) => (
              <div key={index} className="border border-input rounded-lg p-4 hover:bg-muted/30 transition-colors">
                <p className="text-xs text-muted-foreground mb-2">{request.date}</p>
                <p className="text-sm font-medium text-foreground">{request.message}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
