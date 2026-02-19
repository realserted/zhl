'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth-context';
import { getProjects } from '../lib/db/projects';
import { supabase } from '../lib/supabase';
import { Project } from '../lib/types/project';
import { ProjectPermission } from '../lib/types/project';
import Navbar from './components/Navbar';
import LoginPage from './components/LoginPage';
import OverviewScreen from './components/OverviewScreen';
import SettingsPage from './components/SettingsPage';
import AdminPanelPage from './components/AdminPanelPage';
import TaskersPage from './components/TaskersPage';
import UserLogsPage from './components/UserLogsPage';
import UnitDataPage from './components/UnitDataPage';
import AccountsPage from './components/AccountsPage';
import FinancialPage from './components/FinancialPage';
import FilesPage from './components/FilesPage';

export default function Home() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  // Permission of current user for the selected project (null = owner or no project)
  const [userPermission, setUserPermission] = useState<ProjectPermission | null>(null);

  // Load projects once user is authenticated
  useEffect(() => {
    if (!user) return;

    // Auto-link user_id in project_permissions where email matches but user_id is null
    // Uses SECURITY DEFINER RPC to bypass RLS and do case-insensitive email matching
    const linkUserPermissions = async () => {
      const email = user.email; // from auth.users, the source of truth
      if (email) {
        await supabase.rpc('link_user_permissions', {
          p_user_id: user.id,
          p_email: email,
        });
      }
    };

    linkUserPermissions().then(() => {
      getProjects().then((data) => {
        setProjects(data);
        if (data.length > 0 && !selectedProject) {
          setSelectedProject(data[0]);
        }
      });
    });
  }, [user]);

  // When selected project changes, load the user's permission for it
  useEffect(() => {
    if (!user || !selectedProject) { setUserPermission(null); return; }
    // If the user is the owner they have full access — no permission row needed
    if (selectedProject.owner_id === user.id) { setUserPermission(null); return; }
    supabase
      .from('project_permissions')
      .select('*')
      .eq('project_id', selectedProject.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setUserPermission(data ?? null));
  }, [user, selectedProject]);

  // Callback for when admin changes a project's status
  const handleProjectStatusChange = (projectId: string, status: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, status: status as Project['status'] } : p))
    );
    if (selectedProject?.id === projectId) {
      setSelectedProject((prev) => prev ? { ...prev, status: status as Project['status'] } : prev);
    }
  };

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
        userPermission={userPermission}
      />

      {activeTab === 'overview' ? (
        <OverviewScreen />
      ) : activeTab === 'settings' ? (
        <SettingsPage
          selectedProjectId={selectedProject?.id ?? null}
          onProjectCreated={handleProjectCreated}
          userPermission={userPermission}
        />
      ) : activeTab === 'admin' ? (
        <AdminPanelPage onProjectStatusChange={handleProjectStatusChange} />
      ) : activeTab === 'taskers' ? (
        <TaskersPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
      ) : activeTab === 'logs' ? (
        <UserLogsPage />
      ) : activeTab === 'unitdata' ? (
        <UnitDataPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
      ) : activeTab === 'files' ? (
        <FilesPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
      ) : activeTab === 'accounts' ? (
        <AccountsPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
      ) : activeTab === 'financial' ? (
        <FinancialPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
      ) : (
        <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4 sm:p-8">
          <div className="text-center max-w-2xl">
            <h1 className="text-3xl sm:text-4xl font-bold mb-4">Welcome to Zero Hassle Landlord</h1>
            <p className="text-base sm:text-lg text-muted-foreground">
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
