'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth-context';
import { getProjects } from '../lib/db/projects';
import { Project } from '../lib/types/project';
import Navbar from './components/Navbar';
import LoginPage from './components/LoginPage';
import OverviewScreen from './components/OverviewScreen';
import SettingsPage from './components/SettingsPage';
import AdminPanelPage from './components/AdminPanelPage';
import TaskersPage from './components/TaskersPage';
import UserLogsPage from './components/UserLogsPage';

export default function Home() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  // Load projects once user is authenticated
  useEffect(() => {
    if (!user) return;
    getProjects().then((data) => {
      setProjects(data);
      if (data.length > 0 && !selectedProject) {
        setSelectedProject(data[0]);
      }
    });
  }, [user]);

  // Callback for when a new project is created (from Settings)
  const handleProjectCreated = (project: Project) => {
    setProjects((prev) => [...prev, project]);
    setSelectedProject(project);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <>
      <Navbar
        projects={projects}
        selectedProject={selectedProject}
        onProjectChange={setSelectedProject}
        onTabChange={setActiveTab}
      />

      {activeTab === 'overview' ? (
        <OverviewScreen />
      ) : activeTab === 'settings' ? (
        <SettingsPage
          selectedProjectId={selectedProject?.id ?? null}
          onProjectCreated={handleProjectCreated}
        />
      ) : activeTab === 'admin' ? (
        <AdminPanelPage />
      ) : activeTab === 'taskers' ? (
        <TaskersPage selectedProjectId={selectedProject?.id ?? null} />
      ) : activeTab === 'logs' ? (
        <UserLogsPage />
      ) : (
        <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4 sm:p-8">
          <div className="text-center max-w-2xl">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">Welcome to Zero Hassle Landlord</h1>
            <p className="text-base sm:text-lg text-muted-foreground">
              {activeTab === 'unitdata' && 'View and manage unit data'}
              {activeTab === 'files' && 'Manage your files'}
              {activeTab === 'accounts' && 'Manage accounts'}
              {activeTab === 'financial' && 'Financial management'}
              {activeTab === 'templates' && 'Manage templates'}
              {activeTab === 'meetings' && 'Schedule and manage meetings'}
              {activeTab === 'issues' && 'Track tenant issues'}
            </p>
          </div>
        </main>
      )}
    </>
  );
}
