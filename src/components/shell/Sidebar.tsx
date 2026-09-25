'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Home, FolderOpen, LayoutTemplate, Clapperboard, Scissors, Wand2, Images, Boxes,
  Workflow, PlayCircle, ListOrdered, Type, Image as ImageIcon, Video, Mic2, Music,
  KeyRound, SlidersHorizontal, Coins, CreditCard, Settings2, PanelLeftClose, PanelLeft,
  Film, ChevronRight, Activity
} from 'lucide-react';
import { cx, Dot, Tip } from '@/components/ui/primitives';
import { useApp, useBoot } from '@/store/app';
import { useProject } from '@/store/project';

interface NavItem { label: string; href: string; icon: React.ReactNode; badge?: string }
interface NavGroup { title: string; items: NavItem[] }

export function Sidebar() {
  const pathname = usePathname();
  const collapsed = useApp(s => !s.ui.sidebar);
  const setUi = useApp(s => s.setUi);
  const jobs = useApp(s => s.jobs);
  const boot = useBoot();
  const project = useProject(s => s.project);
  const router = useRouter();

  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'queued').length;
  const projectId = project?.id;

  const groups: NavGroup[] = React.useMemo(() => [
    {
      title: 'Home', items: [
        { label: 'Create', href: '/', icon: <Home size={15} /> },
        { label: 'Projects', href: '/projects', icon: <FolderOpen size={15} /> },
        { label: 'Templates', href: '/templates', icon: <LayoutTemplate size={15} /> }
      ]
    },
    {
      title: 'Studio', items: [
        { label: 'Film Projects', href: projectId ? `/project/${projectId}` : '/projects', icon: <Clapperboard size={15} /> },
        { label: 'Video Editor', href: projectId ? `/editor/${projectId}` : '/projects', icon: <Scissors size={15} /> },
        { label: 'AI Generator', href: '/generate', icon: <Wand2 size={15} /> },
        { label: 'Assets', href: '/assets', icon: <Images size={15} /> },
        { label: 'Models', href: '/models', icon: <Boxes size={15} /> }
      ]
    },
    {
      title: 'Automation', items: [
        { label: 'Workflows', href: '/automation', icon: <Workflow size={15} /> },
        { label: 'Runs', href: '/automation?tab=runs', icon: <PlayCircle size={15} /> },
        { label: 'Queue', href: '#queue', icon: <ListOrdered size={15} />, badge: activeJobs ? String(activeJobs) : undefined }
      ]
    },
    {
      title: 'AI', items: [
        { label: 'Text', href: '/generate?kind=text', icon: <Type size={15} /> },
        { label: 'Images', href: '/generate?kind=image', icon: <ImageIcon size={15} /> },
        { label: 'Video', href: '/generate?kind=video', icon: <Video size={15} /> },
        { label: 'Voice', href: '/generate?kind=voice', icon: <Mic2 size={15} /> },
        { label: 'Music', href: '/generate?kind=music', icon: <Music size={15} /> }
      ]
    },
    {
      title: 'System', items: [
        { label: 'API Providers', href: '/settings/providers', icon: <KeyRound size={15} /> },
        { label: 'Presets', href: '/settings/presets', icon: <SlidersHorizontal size={15} /> },
        { label: 'Credits', href: '/billing', icon: <Coins size={15} /> },
        { label: 'Billing', href: '/billing', icon: <CreditCard size={15} /> },
        { label: 'Settings', href: '/settings/general', icon: <Settings2 size={15} /> }
      ]
    }
  ], [activeJobs, projectId]);

  const isActive = (href: string) => {
    if (href === '#queue') return false;
    if (href === '/') return pathname === '/';
    if (href.startsWith('/settings')) return pathname.startsWith(href);
    return pathname === href || (href !== '/projects' && pathname.startsWith(href));
  };

  return (
    <nav className={cx('relative z-30 flex h-full shrink-0 flex-col border-r border-line bg-panel transition-[width] duration-200 ease-cine',
      collapsed ? 'w-[52px]' : 'w-[236px]')}>
      {/* brand */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line-soft px-3">
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-accent/35 bg-gradient-to-b from-accent/20 to-well2 shadow-[0_0_18px_-6px_rgba(217,154,50,.7)]">
          <Film size={14} className="text-accent-bright" />
        </span>
        {!collapsed && (
          <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold leading-tight tracking-tight text-ink">AI Film Studio</span>
            <span className="block truncate text-[9.5px] uppercase tracking-[0.14em] text-ink3">Production workstation</span>
          </motion.span>
        )}
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden py-2">
        {groups.map(g => (
          <div key={g.title} className="mb-1.5">
            {!collapsed && <div className="label px-3 pb-1 pt-2">{g.title}</div>}
            {collapsed && <div className="mx-3 my-2 h-px bg-line-soft" />}
            <ul className="space-y-px px-1.5">
              {g.items.map(item => {
                const active = isActive(item.href);
                const body = (
                  <>
                    {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-md border border-accent/25 bg-stage-active" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                    <span className={cx('relative z-10 shrink-0', active ? 'text-accent-bright' : 'text-ink3')}>{item.icon}</span>
                    {!collapsed && <span className={cx('relative z-10 min-w-0 flex-1 truncate text-[12px]', active ? 'font-medium text-ink' : 'text-ink2')}>{item.label}</span>}
                    {!collapsed && item.badge && <span className="relative z-10 rounded bg-accent/15 px-1.5 py-px text-[9.5px] font-bold text-accent-bright tnum">{item.badge}</span>}
                    {collapsed && item.badge && <span className="absolute right-1 top-1 z-20 h-1.5 w-1.5 rounded-full bg-accent" />}
                  </>
                );
                const cls = 'relative flex h-[30px] items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-white/[0.04]';
                if (item.href === '#queue') {
                  return (
                    <li key={item.label}>
                      <Tip label={collapsed ? item.label : ''} side="right">
                        <button type="button" onClick={() => setUi('queue', true)} className={cx(cls, 'w-full')}>{body}</button>
                      </Tip>
                    </li>
                  );
                }
                return (
                  <li key={item.label + item.href}>
                    <Tip label={collapsed ? item.label : ''} side="right">
                      <Link href={item.href} className={cx(cls, 'w-full')} aria-current={active ? 'page' : undefined}>{body}</Link>
                    </Tip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* footer: system health */}
      <div className={cx('shrink-0 border-t border-line-soft p-2', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <Tip label="System status" side="top">
            <button type="button" onClick={() => router.push('/settings/advanced')} className="icon-btn">
              <Activity size={14} />
            </button>
          </Tip>
        ) : (
          <button type="button" onClick={() => router.push('/settings/advanced')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
            <Dot tone={boot?.demoMode ? 'accent' : 'ok'} pulse={activeJobs > 0} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10.5px] font-medium text-ink2">
                {boot?.demoMode ? 'Studio Engine' : activeJobs ? `${activeJobs} job${activeJobs > 1 ? 's' : ''} running` : 'Providers connected'}
              </span>
              <span className="block truncate text-[9.5px] text-ink3">
                {boot?.database ?? 'local'} · {boot?.storage ?? 'disk'}{boot?.ffmpeg ? '' : ' · no ffmpeg'}
              </span>
            </span>
            <ChevronRight size={12} className="shrink-0 text-ink3" />
          </button>
        )}
        <div className={cx('mt-1', collapsed && 'hidden')}>
          <button type="button" onClick={() => setUi('sidebar', false)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-[10.5px] text-ink3 transition-colors hover:bg-white/[0.04] hover:text-ink2">
            <PanelLeftClose size={13} />Collapse
          </button>
        </div>
      </div>
      {collapsed && (
        <button type="button" onClick={() => setUi('sidebar', true)} aria-label="Expand sidebar"
          className="absolute -right-3 top-[62px] z-40 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-elevated text-ink3 shadow-card hover:text-ink">
          <PanelLeft size={12} />
        </button>
      )}
    </nav>
  );
}
