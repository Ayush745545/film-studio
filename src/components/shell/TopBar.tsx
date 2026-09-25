'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Search, Sparkles, Bell, Coins, ChevronDown, PanelLeft, Settings, LogOut,
  Keyboard, LifeBuoy, CircleUser, ListChecks, FlaskConical, Check, Cloud, CloudOff, Palette
} from 'lucide-react';
import { cx, Dot, Tip, Badge } from '@/components/ui/primitives';
import { Popover, MenuItem } from '@/components/ui/overlays';
import { useApp, useBoot } from '@/store/app';
import { useTheme } from '@/hooks/useTheme';
import { useProject } from '@/store/project';
import { isEventStreamConnected } from '@/lib/client/events';

function timeAgo(ts: number | null): string {
  if (!ts) return 'not saved yet';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'saved just now';
  if (s < 60) return `saved ${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `saved ${m}m ago`;
  return `saved ${Math.round(m / 60)}h ago`;
}

export function TopBar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  // One primitive per selector: object selectors allocate a fresh reference on
  // every call and reintroduce the getServerSnapshot loop.
  const setUi = useApp(s => s.setUi);
  const reload = useApp(s => s.reload);
  const credits = useApp(s => s.credits);
  const sidebarOpen = useApp(s => s.ui.sidebar);
  const searchOpen = useApp(s => s.ui.search);
  const copilotOpen = useApp(s => s.ui.copilot);
  const queueOpen = useApp(s => s.ui.queue);
  const boot = useBoot();
  const proj = useProject(s => s.project);
  const saveState = useProject(s => s.saveState);
  const lastSavedAt = useProject(s => s.lastSavedAt);
  const versions = useProject(s => s.versions);
  const jobs = useApp(s => s.jobs);
  const router = useRouter();
  const { theme, setTheme, themes, current } = useTheme();
  const [, force] = React.useReducer(x => x + 1, 0);
  const [connected, setConnected] = React.useState(true);

  React.useEffect(() => {
    const i = setInterval(() => { setConnected(isEventStreamConnected()); force(); }, 2500);
    return () => clearInterval(i);
  }, [force]);

  const running = jobs.filter(j => j.status === 'running').length;
  const queued = jobs.filter(j => j.status === 'queued').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const waiting = jobs.filter(j => j.status === 'review').length;

  return (
    <header className="sheen relative z-40 flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-panel-grad px-2.5">
      <button type="button" onClick={onToggleSidebar ?? (() => setUi('sidebar', !sidebarOpen))} className="icon-btn" aria-label="Toggle sidebar">
        <PanelLeft size={15} />
      </button>

      {/* project identity */}
      <div className="flex min-w-0 items-center gap-2">
        {proj ? (
          <>
            <Link href="/projects" className="icon-btn shrink-0" aria-label="All projects">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => router.push(`/project/${proj.id}`)}
                  className="max-w-[240px] truncate text-left text-[13px] font-semibold leading-tight tracking-tight text-ink hover:text-accent-bright">
                  {proj.name}
                </button>
                <Badge tone="mut" className="shrink-0 font-mono text-[9px]">rev {proj.rev ?? 1}</Badge>
                {boot?.demoMode && <Badge tone="mut" className="shrink-0">Studio Engine</Badge>}
              </div>
              <div className="mt-px flex items-center gap-1.5 text-[10px] text-ink3">
                {saveState === 'saving' ? (<><Cloud size={10} className="animate-pulseDot" />Saving…</>)
                  : saveState === 'error' ? (<><CloudOff size={10} className="text-bad" /><span className="text-bad">Save failed — retrying</span></>)
                  : (<><Check size={10} className="text-ok" />{timeAgo(lastSavedAt)}</>)}
                {versions.length > 0 && <span className="text-ink3">· {versions.length} revisions</span>}
              </div>
            </div>
          </>
        ) : (
          <Link href="/" className="flex items-center gap-2 px-1">
            <span className="text-[13px] font-semibold tracking-tight text-ink">AI Film Studio</span>
          </Link>
        )}
      </div>

      <div className="flex-1" />

      {/* search + copilot */}
      <div className="hidden items-center gap-1.5 md:flex">
        <button type="button" onClick={() => setUi('search', true)}
          className="group flex h-[30px] w-[230px] items-center gap-2 rounded-md border border-line bg-well px-2.5 text-[11.5px] text-ink3 transition-colors hover:border-ink3/45 hover:text-ink2 xl:w-[290px]">
          <Search size={13} className="shrink-0" />
          <span className="flex-1 truncate text-left">Search project…</span>
          <kbd className="kbd">⌘F</kbd>
        </button>
        <Tip label="AI copilot — knows this project">
          <button type="button" onClick={() => setUi('copilot', !copilotOpen)} className={cx('icon-btn h-[30px] w-[30px]', copilotOpen && 'border-accent/30 bg-accent/12 text-accent-bright')} aria-label="AI copilot">
            <Sparkles size={15} />
          </button>
        </Tip>
      </div>

      {/* theme */}
      <Popover width={268} align="right" trigger={({ toggle }) => (
        <Tip label={`Theme · ${current.name}`}>
          <button type="button" onClick={toggle} className="icon-btn h-[30px] w-[30px]" aria-label="Change theme">
            <Palette size={15} />
          </button>
        </Tip>
      )}>
        {close => (
          <div className="p-1">
            <div className="label px-2.5 pb-1.5 pt-1">Theme</div>
            {themes.map(t => (
              <button key={t.id} type="button" onClick={() => { void setTheme(t.id); close(); }}
                className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
                  t.id === theme ? 'bg-accent/12' : 'hover:bg-white/[0.05]')}>
                <span className="flex h-5 w-9 shrink-0 overflow-hidden rounded border border-line-soft">
                  {t.swatch.map((c, i) => <span key={i} className="h-full flex-1" style={{ background: c }} />)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-[11.5px]', t.id === theme ? 'font-semibold text-accent-bright' : 'text-ink2')}>{t.name}</span>
                  <span className="block truncate text-[9.5px] text-ink3">{t.contrast} contrast</span>
                </span>
                {t.id === theme && <Check size={12} className="shrink-0 text-accent-bright" />}
              </button>
            ))}
            <div className="my-1 h-px bg-line-soft" />
            <MenuItem icon={<Settings size={13} />} label="Appearance settings" hint="⌘K" onClick={() => { close(); router.push('/settings/appearance'); }} />
          </div>
        )}
      </Popover>

      {/* queue */}
      <Tip label={running || queued ? `${running} running · ${queued} queued` : 'Generation queue'}>
        <button type="button" onClick={() => setUi('queue', !queueOpen)}
          className={cx('relative flex h-[30px] items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors',
            running || waiting ? 'border-accent/35 bg-accent/10 text-accent-bright' : failed ? 'border-bad/35 bg-bad/10 text-bad' : 'border-line bg-well text-ink2 hover:text-ink')}
          aria-label="Generation queue">
          {running > 0 ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.6, ease: 'linear' }}><ListChecks size={13} /></motion.span> : <ListChecks size={13} />}
          <span className="tnum">{running + queued + waiting || (failed ? `${failed}!` : '')}</span>
          {running > 0 && <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#D99A32]" />}
        </button>
      </Tip>

      {/* live connection */}
      <Tip label={connected ? 'Live updates connected' : 'Reconnecting…'}>
        <span className="hidden h-[30px] items-center px-1 lg:flex"><Dot tone={connected ? 'ok' : 'bad'} pulse={connected && running > 0} /></span>
      </Tip>

      {/* credits — opens the usage drawer */}
      <Tip label="Usage & credits">
        <button type="button" onClick={() => setUi('usage', true)}
          className="flex items-center gap-1.5 rounded-md border border-line bg-well py-1 pl-2 pr-2 transition-colors hover:border-accent/40 hover:bg-accent/10"
          aria-label="Open usage and credits">
          <Coins size={12} className="text-accent" />
          <span className="text-[11.5px] font-semibold text-ink tnum">{Math.round(credits).toLocaleString()}</span>
          <span className="hidden text-[10px] text-ink3 sm:inline">credits</span>
        </button>
      </Tip>

      <button type="button" onClick={() => setUi('upgrade', true)} className="btn btn-premium h-[30px] gap-1.5 px-3 text-[11.5px]">
        <Sparkles size={12} />Upgrade
      </button>

      {/* profile */}
      <Popover width={250} trigger={({ toggle }) => (
        <button type="button" onClick={toggle} className="flex h-[30px] items-center gap-1.5 rounded-md border border-transparent px-1 transition-colors hover:border-line hover:bg-white/[0.04]" aria-label="Account">
          <span className="flex h-[24px] w-[24px] items-center justify-center rounded-full text-[10px] font-bold text-accent-on"
            style={{ background: `linear-gradient(160deg, ${boot?.user.avatarColor ?? '#D99A32'}, ${boot?.user.avatarColor ?? '#D99A32'}88)` }}>
            {(boot?.user.name ?? 'D').slice(0, 1).toUpperCase()}
          </span>
          <ChevronDown size={12} className="text-ink3" />
        </button>
      )}>
        {close => (
          <div className="p-1">
            <div className="border-b border-line-soft px-2.5 pb-2.5 pt-1.5">
              <p className="truncate text-[12.5px] font-semibold text-ink">{boot?.user.name}</p>
              <p className="truncate text-[10.5px] text-ink3">{boot?.user.email}</p>
              <div className="mt-2 flex items-center gap-1.5">
                <Badge tone="accent">{boot?.subscription.planId ?? 'free'}</Badge>
                {boot?.user.developerMode && <Badge tone="info">Dev mode</Badge>}
              </div>
            </div>
            <div className="pt-1">
              <MenuItem icon={<Coins size={13} />} label="Credits & billing" hint={String(Math.round(credits))} onClick={() => { close(); router.push('/billing'); }} />
              <MenuItem icon={<Settings size={13} />} label="Settings" onClick={() => { close(); router.push('/settings/general'); }} />
              <MenuItem icon={<Keyboard size={13} />} label="Keyboard shortcuts" hint="?" onClick={() => { close(); setUi('shortcuts', true); }} />
              <MenuItem icon={<FlaskConical size={13} />} label="System status" onClick={() => { close(); router.push('/settings/advanced'); }} />
              <MenuItem icon={<LifeBuoy size={13} />} label="Documentation" onClick={() => { close(); window.open('https://github.com/', '_blank'); }} />
              <div className="my-1 h-px bg-line-soft" />
              <MenuItem icon={<CircleUser size={13} />} label={boot?.user.developerMode ? 'Disable developer mode' : 'Enable developer mode'}
                onClick={async () => { close(); await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ developerMode: !boot?.user.developerMode }) }); await reload(); }} />
              <MenuItem tone="danger" icon={<LogOut size={13} />} label="Sign out"
                onClick={async () => { close(); await fetch('/api/auth/logout', { method: 'POST' }); router.push('/'); router.refresh(); }} />
            </div>
          </div>
        )}
      </Popover>
    </header>
  );
}

export function NotificationsBell() {
  const jobs = useApp(s => s.jobs);
  const failed = jobs.filter(j => j.status === 'failed');
  return (
    <Tip label={failed.length ? `${failed.length} failed generation(s)` : 'No alerts'}>
      <span className="icon-btn relative">
        <Bell size={14} />
        {failed.length > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-bad" />}
      </span>
    </Tip>
  );
}
