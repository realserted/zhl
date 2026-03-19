'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useAuth } from '@/lib/auth-context';
import {
  Building2, FileText, CalendarDays, ClipboardList, Users,
  BarChart3, FolderOpen, Bell, ChevronRight, ChevronDown, Menu, X,
  Sun, Moon, Shield, Eye,
} from 'lucide-react';

// ── Dot grid background SVG ──
function DotGrid({ className = '' }: { className?: string }) {
  return (
    <svg className={`absolute inset-0 w-full h-full ${className}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="dotgrid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1" fill="currentColor" opacity="0.15" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dotgrid)" />
    </svg>
  );
}

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!loading && user) router.replace('/overview');
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="flex items-center gap-2 cursor-pointer"
            >
              {mounted && (
                <Image
                  src={isDark ? '/zhl-logo-light.png' : '/zhl-logo-dark.png'}
                  alt="ZHL"
                  width={140}
                  height={40}
                  className="h-8 w-auto"
                />
              )}
            </button>

            <div className="hidden md:flex items-center gap-6">
              <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Home</button>
              <a href="#features" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="#protocol" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
              <a href="#faq" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
              {mounted && (
                <button
                  onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </button>
              )}
              <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Sign In
              </Link>
              <Link
                href="/signup"
                className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition-all"
              >
                Get Started
              </Link>
            </div>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {mobileMenuOpen && (
            <div className="md:hidden py-4 space-y-3 border-t border-border/40">
              <button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setMobileMenuOpen(false); }} className="block text-sm font-medium text-muted-foreground hover:text-foreground py-2 text-left">Home</button>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-muted-foreground hover:text-foreground py-2">Features</a>
              <a href="#protocol" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-muted-foreground hover:text-foreground py-2">How It Works</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="block text-sm font-medium text-muted-foreground hover:text-foreground py-2">FAQ</a>
              <div className="flex gap-3 pt-2">
                <Link href="/login" className="flex-1 text-center py-2.5 rounded-lg border border-border text-sm font-medium">Sign In</Link>
                <Link href="/signup" className="flex-1 text-center py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">Get Started</Link>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <DotGrid className="text-foreground" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-36 lg:pt-44 pb-20 sm:pb-28">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1]">
              Zero Hassle{' '}
              <span className="text-primary">Property Management</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl leading-relaxed text-muted-foreground max-w-2xl mx-auto">
              Instant task tracking, financial modeling, and document management for real estate professionals.
            </p>
            <div className="mt-10">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-8 h-12 rounded-lg bg-primary text-primary-foreground text-sm font-bold tracking-wide uppercase hover:brightness-110 transition-all"
              >
                Get Started <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-16 grid grid-cols-3 gap-4 max-w-lg mx-auto">
            {[
              { value: '12+', label: 'Core Features' },
              { value: '100%', label: 'Free to Start' },
              { value: '24/7', label: 'Cloud Access' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-2xl sm:text-3xl font-extrabold text-primary">{stat.value}</p>
                <p className="text-[10px] sm:text-xs font-bold tracking-widest uppercase text-muted-foreground mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform Overview (mock dashboard) ── */}
      <section className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Your Command Center
            </h2>
            <p className="mt-4 text-muted-foreground sm:text-lg">
              Real-time project health, task management, and financial insights — all in one dashboard.
            </p>
          </div>

          {/* Mock browser window */}
          <div className="relative max-w-4xl mx-auto">
            <div className="absolute -inset-4 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 rounded-2xl blur-xl" />
            <div className="relative rounded-xl border border-border/60 bg-card shadow-2xl shadow-black/10 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-muted/30">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-red-500/60" />
                  <div className="h-3 w-3 rounded-full bg-amber-500/60" />
                  <div className="h-3 w-3 rounded-full bg-emerald-500/60" />
                </div>
                <span className="text-xs font-medium text-muted-foreground ml-2">zerohasslelandlord.com</span>
              </div>
              <div className="p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-primary" />
                    <span className="text-base font-bold">CHERRY</span>
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-green-500/10 text-green-500 font-bold uppercase tracking-wider">Good</span>
                  </div>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {['Overview', 'Taskers', 'Files', 'Financial', 'Meetings', 'Accounts'].map((tab, i) => (
                    <span
                      key={tab}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase shrink-0 transition-colors ${
                        i === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {tab}
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'Properties', value: '12', color: 'text-blue-500' },
                    { label: 'Open Tasks', value: '8', color: 'text-amber-500' },
                    { label: 'Revenue', value: '$24.5k', color: 'text-emerald-500' },
                    { label: 'Issues', value: '2', color: 'text-red-400' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg border border-border/40 bg-muted/20 p-3 text-center">
                      <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                      <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground mt-0.5">{stat.label}</p>
                    </div>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
                    <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground">Recent Files</p>
                    {[
                      { name: 'Lease Agreement.pdf', icon: FileText, color: 'text-red-400' },
                      { name: 'Tenant Records', icon: FolderOpen, color: 'text-amber-400' },
                      { name: 'Monthly Report.xlsx', icon: FileText, color: 'text-green-400' },
                    ].map((f) => (
                      <div key={f.name} className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/20">
                        <f.icon className={`h-3.5 w-3.5 ${f.color}`} />
                        <span className="text-xs">{f.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
                    <p className="text-[9px] font-bold tracking-widest uppercase text-muted-foreground">Upcoming</p>
                    {[
                      { name: 'Team Sync', time: 'Today 2:00 PM', dot: 'bg-blue-500' },
                      { name: 'Lease Review', time: 'Tomorrow 10:00 AM', dot: 'bg-amber-500' },
                      { name: 'Tenant Walkthrough', time: 'Mar 22', dot: 'bg-emerald-500' },
                    ].map((m) => (
                      <div key={m.name} className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/20">
                        <div className={`h-2 w-2 rounded-full ${m.dot} shrink-0`} />
                        <span className="text-xs flex-1">{m.name}</span>
                        <span className="text-[10px] text-muted-foreground">{m.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="features" className="bg-muted/30 border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Built for Real Estate Professionals
            </h2>
            <p className="mt-4 text-muted-foreground sm:text-lg">
              Every tool you need to manage properties, tenants, and finances — unified in one platform.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: ClipboardList, iconBg: 'bg-blue-500/10', iconColor: 'text-blue-500', title: 'Task Management', description: 'Create, assign, and track tasks with due dates. Heatmap view shows team activity at a glance.' },
              { icon: FolderOpen, iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-500', title: 'Google Drive Integration', description: 'Connect your Drive, browse files as a tree, preview documents, PDFs, and images — all inline.' },
              { icon: CalendarDays, iconBg: 'bg-amber-500/10', iconColor: 'text-amber-500', title: 'Meetings & Scheduling', description: 'Schedule meetings with auto Google Meet links, calendar sync, and email invitations to attendees.' },
              { icon: BarChart3, iconBg: 'bg-purple-500/10', iconColor: 'text-purple-500', title: 'Financial Reports', description: 'AutoBooks, debt schedules, and financial dashboards keep your numbers organized and accessible.' },
              { icon: Users, iconBg: 'bg-rose-500/10', iconColor: 'text-rose-500', title: 'Team & Role Access', description: 'Invite team members with role-based permissions. Owners, managers, and accountants see only what they need.' },
              { icon: Bell, iconBg: 'bg-orange-500/10', iconColor: 'text-orange-500', title: 'Tenant Issue Tracking', description: 'Track maintenance requests and tenant issues with status updates, assignments, and resolution logs.' },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-border/40 bg-card p-6 hover:border-primary/20 transition-all"
              >
                <div className={`inline-flex rounded-lg p-2.5 ${feature.iconBg} mb-4`}>
                  <feature.icon className={`h-5 w-5 ${feature.iconColor}`} />
                </div>
                <h3 className="text-base font-bold mb-2">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Protocol / How It Works (3-step) ── */}
      <section id="protocol" className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Get Started in Minutes
            </h2>
            <p className="mt-4 text-muted-foreground sm:text-lg">
              A simple three-step setup to go from zero to fully operational.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                step: '01',
                icon: Shield,
                title: 'Create Your Account',
                description: 'Sign up for free and create your first project. Invite team members and assign roles immediately.',
                items: ['Free signup', 'Role-based access', 'Multi-project support'],
              },
              {
                step: '02',
                icon: FolderOpen,
                title: 'Connect Your Tools',
                description: 'Link Google Drive for file management and Google Calendar for meetings. Everything syncs automatically.',
                items: ['Google Drive sync', 'Calendar integration', 'Auto Meet links'],
              },
              {
                step: '03',
                icon: Eye,
                title: 'Manage & Monitor',
                description: 'Track tasks, review financials, manage tenants, and oversee every property from one dashboard.',
                items: ['Real-time dashboard', 'Financial tracking', 'Issue management'],
              },
            ].map((item) => (
              <div key={item.step} className="relative rounded-xl border border-border/40 bg-card p-6 hover:border-primary/20 transition-all">
                <span className="text-5xl font-extrabold text-primary/30 absolute top-4 right-5">{item.step}</span>
                <div className="relative">
                  <div className="inline-flex rounded-lg p-2.5 bg-primary/10 mb-4">
                    <item.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-base font-bold mb-2">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground mb-4">{item.description}</p>
                  <ul className="space-y-1.5">
                    {item.items.map((li) => (
                      <li key={li} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="h-1 w-1 rounded-full bg-primary shrink-0" />
                        {li}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="bg-muted/30 border-t border-border/40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-3">
            {[
              {
                q: 'Is there a cost to use ZHL?',
                a: 'ZHL is free to get started. You can create projects, invite team members, and use all core features at no cost during early access.',
              },
              {
                q: 'What does ZHL do exactly?',
                a: 'ZHL is an all-in-one property management platform. It combines task management, Google Drive file browsing, meeting scheduling with auto Google Meet links, financial reporting, tenant issue tracking, and role-based team access.',
              },
              {
                q: 'Do I need to upload files to ZHL?',
                a: 'No. ZHL connects directly to your Google Drive. You browse, preview, and manage files from your Drive without ever uploading them to our servers. Your data stays on Google.',
              },
              {
                q: 'How does team access work?',
                a: 'Project owners can invite team members and assign roles like Project Manager, Property Manager, or Accountant. Each role has specific permissions controlling what they can view and edit.',
              },
              {
                q: 'Can I manage multiple properties?',
                a: 'Yes. ZHL supports multiple projects, each with its own team, files, tasks, and financials. Switch between projects instantly from the sidebar.',
              },
            ].map((item, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <span className="text-sm font-semibold pr-4">{item.q}</span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative border-t border-border/40 overflow-hidden">
        <DotGrid className="text-foreground" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/90 to-background" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Start Managing Smarter
            </h2>
            <p className="mt-4 text-muted-foreground sm:text-lg">
              Create your free account and take control of your properties today.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 px-8 h-12 rounded-lg bg-primary text-primary-foreground text-sm font-bold tracking-wide uppercase hover:brightness-110 transition-all"
              >
                Get Started <ChevronRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 px-8 h-12 rounded-lg border border-border text-sm font-bold tracking-wide uppercase hover:bg-muted/50 transition-all"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-2">
              {mounted && (
                <Image
                  src={isDark ? '/zhl-logo-light.png' : '/zhl-logo-dark.png'}
                  alt="ZHL"
                  width={180}
                  height={50}
                  className="h-10 w-auto"
                />
              )}
            </div>
            <div className="flex items-center gap-6 text-xs text-muted-foreground">
              <a href="#features" className="hover:text-foreground transition-colors">Features</a>
              <a href="#protocol" className="hover:text-foreground transition-colors">How It Works</a>
              <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
              <Link href="/login" className="hover:text-foreground transition-colors">Sign In</Link>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border/40">
            <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Zero Hassle Landlord. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
