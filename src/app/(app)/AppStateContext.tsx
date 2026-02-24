'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getProjects } from '@/lib/db/projects';
import { supabase } from '@/lib/supabase/client';
import { Project, ProjectPermission } from '@/lib/types/project';

interface AppState {
  projects: Project[];
  selectedProject: Project | null;
  setSelectedProject: (project: Project) => void;
  isAdmin: boolean;
  userPermission: ProjectPermission | null;
  handleProjectStatusChange: (projectId: string, status: string) => void;
  handleProjectCreated: (project: Project) => void;
  handleProjectDeleted: (projectId: string) => void;
}

const AppStateContext = createContext<AppState | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPermission, setUserPermission] = useState<ProjectPermission | null>(null);

  // Link permissions and load projects once the user authenticates
  useEffect(() => {
    if (!user) return;
    const run = async () => {
      if (user.email) {
        await supabase.rpc('link_user_permissions', {
          p_user_id: user.id,
          p_email: user.email,
        });
      }
      const data = await getProjects();
      setProjects(data);
      // Only auto-select if no project is selected yet
      setSelectedProject((prev) => prev ?? (data.length > 0 ? data[0] : null));
    };
    run();
  }, [user]);

  // Load isAdmin flag
  useEffect(() => {
    if (!user) return;
    supabase
      .from('accounts')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setIsAdmin(data?.is_admin === true));
  }, [user]);

  // Load the current user's permission for the selected project
  useEffect(() => {
    if (!user || !selectedProject) { setUserPermission(null); return; }
    // Owners have full access — no permission row needed
    if (selectedProject.owner_id === user.id) { setUserPermission(null); return; }
    supabase
      .from('project_permissions')
      .select('*')
      .eq('project_id', selectedProject.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setUserPermission(data ?? null));
  }, [user, selectedProject]);

  // ── Callbacks ────────────────────────────────────────────────────────────────

  const handleProjectStatusChange = (projectId: string, status: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, status: status as Project['status'] } : p))
    );
    setSelectedProject((prev) =>
      prev?.id === projectId ? { ...prev, status: status as Project['status'] } : prev
    );
  };

  const handleProjectCreated = (project: Project) => {
    setProjects((prev) => [...prev, project]);
    setSelectedProject(project);
  };

  const handleProjectDeleted = (projectId: string) => {
    setProjects((prev) => {
      const remaining = prev.filter((p) => p.id !== projectId);
      setSelectedProject(remaining.length > 0 ? remaining[0] : null);
      return remaining;
    });
  };

  return (
    <AppStateContext.Provider
      value={{
        projects,
        selectedProject,
        setSelectedProject,
        isAdmin,
        userPermission,
        handleProjectStatusChange,
        handleProjectCreated,
        handleProjectDeleted,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
