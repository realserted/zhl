'use client';

import { useState } from 'react';
import Navbar from './components/Navbar';
import SettingsPage from './components/SettingsPage';
import AdminPanelPage from './components/AdminPanelPage';
import TaskersPage from './components/TaskersPage';
import UserLogsPage from './components/UserLogsPage';

export default function Home() {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <>
      <Navbar onTabChange={setActiveTab} />

      {activeTab === 'settings' ? (
        <SettingsPage />
      ) : activeTab === 'admin' ? (
        <AdminPanelPage />
      ) : activeTab === 'taskers' ? (
        <TaskersPage />
      ) : activeTab === 'logs' ? (
        <UserLogsPage />
      ) : (
        <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4 sm:p-8">
          <div className="text-center max-w-2xl">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">Welcome to Zero Hassle Landlord</h1>
            <p className="text-base sm:text-lg text-muted-foreground">
              {activeTab === 'overview' && 'Your property management dashboard is ready to use'}
              {activeTab === 'taskers' && 'Manage your taskers here'}
              {activeTab === 'unitdata' && 'View and manage unit data'}
              {activeTab === 'files' && 'Manage your files'}
              {activeTab === 'accounts' && 'Manage accounts'}
              {activeTab === 'financial' && 'Financial management'}
              {activeTab === 'templates' && 'Manage templates'}
              {activeTab === 'meetings' && 'Schedule and manage meetings'}
              {activeTab === 'issues' && 'Track tenant issues'}
              {activeTab === 'logs' && 'View user activity logs'}
            </p>
          </div>
        </main>
      )}
    </>
  );
}
