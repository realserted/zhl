'use client';

import { Plus, Calendar, MessageCircle, HelpCircle, Star } from 'lucide-react';
import { useState } from 'react';

export default function TaskersPage() {
  const [viewFilter, setViewFilter] = useState('all');

  const taskers: any[] = [];

  const renderStars = (count: number) => {
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: count }).map((_, i) => (
          <Star key={i} className="h-3 w-3 fill-yellow-400 text-yellow-400" />
        ))}
      </div>
    );
  };

  return (
    <main className="bg-background text-foreground min-h-screen">
      <div className="max-w-full px-4 sm:px-6 py-6 sm:py-8">
        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">Your Taskers</h1>

        {/* View Taskers and Create Section */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 mb-6 sm:mb-8">
          {/* View Taskers Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <span className="font-semibold text-sm sm:text-base">View Taskers:</span>
            <div className="flex gap-2 sm:gap-4 flex-wrap">
              <button
                onClick={() => setViewFilter('all')}
                className={`text-xs sm:text-sm hover:text-accent transition-colors ${
                  viewFilter === 'all' ? 'text-accent font-semibold' : ''
                }`}
              >
                All Taskers
              </button>
              <button
                onClick={() => setViewFilter('relevant')}
                className={`text-xs sm:text-sm hover:text-accent transition-colors ${
                  viewFilter === 'relevant' ? 'text-accent font-semibold' : ''
                }`}
              >
                Only relevant
              </button>
              <button
                onClick={() => setViewFilter('pm')}
                className={`text-xs sm:text-sm hover:text-accent transition-colors ${
                  viewFilter === 'pm' ? 'text-accent font-semibold' : ''
                }`}
              >
                Only PM
              </button>
            </div>
          </div>

          {/* Create Tasker Button */}
          <button className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
            <Plus className="h-3 w-3 sm:h-4 sm:w-4" />
            Create tasker
          </button>

          {/* Calendar View Link */}
          <button className="sm:ml-auto inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-accent hover:text-accent/80 transition-colors">
            <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">(calendar view)</span>
            <span className="sm:hidden">Calendar</span>
          </button>
        </div>

        {/* Taskers Table */}
        <div className="overflow-x-auto border border-input rounded-lg">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="bg-muted border-b border-input">
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Status</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Task Name</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Description</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Status</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Responsible</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">CC</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">"Got the Ball"</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Priority</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Due</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Log</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Help</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">ISSUES</th>
                <th className="px-3 py-3 text-left font-semibold whitespace-nowrap">Original due date vs now</th>
              </tr>
            </thead>
            <tbody>
              {taskers.map((tasker, index) => (
                <tr
                  key={index}
                  className="border-b border-input hover:bg-muted/50 transition-colors"
                >
                  <td className="px-3 py-3 whitespace-nowrap font-medium">{tasker.status}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{tasker.taskName}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-muted-foreground text-xs">
                    {tasker.description}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{tasker.taskStatus}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{tasker.responsible}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{tasker.cc}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {tasker.gotTheBall > 0 ? renderStars(tasker.gotTheBall) : ''}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {tasker.priority ? (
                      <span className="inline-block bg-red-600 dark:bg-red-700 text-white text-xs px-2 py-1 rounded">
                        {tasker.priority}
                      </span>
                    ) : tasker.priorityRating > 0 ? (
                      renderStars(tasker.priorityRating)
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{tasker.due}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {tasker.status === 'Archived' && (
                      <MessageCircle className="h-4 w-4 text-blue-500" />
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {tasker.status === 'Archived' && (
                      <HelpCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs">{tasker.issues}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs">{tasker.originalDueDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
