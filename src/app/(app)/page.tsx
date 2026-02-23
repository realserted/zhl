'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getProjects } from '@/lib/db/projects';
import { supabase } from '@/lib/supabase/client';
import { Project } from '@/lib/types/project';
import { ProjectPermission } from '@/lib/types/project';
import Navbar from '@/components/shared/Navbar';
import LoginPage from '@/components/auth/LoginPage';
import OverviewScreen from '@/components/features/overview/OverviewScreen';
import SettingsPage from '@/components/features/settings/SettingsPage';
import AdminPanelPage from '@/components/admin/AdminPanelPage';
import TaskersPage from '@/components/features/taskers/TaskersPage';
import UserLogsPage from '@/components/features/user-logs/UserLogsPage';
import UnitDataPage from '@/components/features/unit-data/UnitDataPage';
import AccountsPage from '@/components/features/accounts/AccountsPage';
import FinancialPage from '@/components/features/financial/FinancialPage';
import FilesPage from '@/components/features/files/FilesPage';

export default function Home() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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

  useEffect(() => {
    if (!user) return;
    supabase
      .from('accounts')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(data?.is_admin === true));
  }, [user]);

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

  // Callback for when a project is deleted (from Settings)
  const handleProjectDeleted = (projectId: string) => {
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    setSelectedProject(remaining.length > 0 ? remaining[0] : null);
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
        <OverviewScreen selectedProjectId={selectedProject?.id ?? null} />
      ) : activeTab === 'settings' ? (
        <SettingsPage
          selectedProjectId={selectedProject?.id ?? null}
          selectedProjectName={selectedProject?.name ?? null}
          selectedProjectStatus={selectedProject?.status ?? null}
          onProjectCreated={handleProjectCreated}
          onProjectDeleted={handleProjectDeleted}
          onProjectStatusChange={handleProjectStatusChange}
          userPermission={userPermission}
        />
      ) : activeTab === 'admin' ? (
        <AdminPanelPage onProjectStatusChange={handleProjectStatusChange} />
      ) : activeTab === 'taskers' ? (
        <TaskersPage selectedProjectId={selectedProject?.id ?? null} selectedProjectName={selectedProject?.name ?? null} userPermission={userPermission} />
      ) : activeTab === 'logs' ? (
        <UserLogsPage />
      ) : activeTab === 'unitdata' ? (
        <UnitDataPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} isAdmin={isAdmin} />
      ) : activeTab === 'files' ? (
        <FilesPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
      ) : activeTab === 'accounts' ? (
        isAdmin ? (
          <AccountsPage selectedProjectId={selectedProject?.id ?? null} userPermission={userPermission} />
        ) : (
          <main className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4 sm:p-8">
            <p className="text-sm text-muted-foreground">Access denied. Accounts is restricted to admins only.</p>
          </main>
        )
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
