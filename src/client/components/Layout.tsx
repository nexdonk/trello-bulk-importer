import * as React from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { History, LayoutDashboard, Menu, Settings, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnectionStatus } from '@/hooks/useConnectionStatus';
import { LogoMark } from '@/components/common';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/import', label: 'New Import', icon: Upload, end: false },
  { to: '/history', label: 'History', icon: History, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
] as const;

export function ConnectionPill({ className }: { className?: string }) {
  const { status, loading, error } = useConnectionStatus();
  let dot = 'bg-zinc-500';
  let label = 'Not Connected';
  let sub: string | null = null;
  if (loading && !status) {
    label = 'Checking…';
    dot = 'bg-zinc-600 animate-pulse';
  } else if (error && !status) {
    label = 'Server unreachable';
    dot = 'bg-red-400';
  } else if (status?.state === 'connected') {
    label = 'Connected';
    dot = 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';
    sub = status.member ? `@${status.member.username}` : null;
  } else if (status?.state === 'failed') {
    label = 'Connection Failed';
    dot = 'bg-red-400';
    sub = status.keyHint ? `key ${status.keyHint}` : null;
  }
  return (
    <Link
      to="/settings"
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-left transition-colors duration-150 hover:border-border-strong',
        className,
      )}
    >
      <span className={cn('size-2 shrink-0 rounded-full', dot)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{label}</span>
        {sub && <span className="block truncate font-mono text-[11px] text-subtle">{sub}</span>}
      </span>
    </Link>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150',
              isActive ? 'bg-white/[0.07] text-foreground' : 'text-muted hover:bg-white/[0.04] hover:text-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <LogoMark className="size-6" />
      <span className="text-[14px] font-semibold tracking-tight">Trello Bulk Importer</span>
    </Link>
  );
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const location = useLocation();

  React.useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-[#0b0b0d] md:flex">
        <div className="flex h-14 items-center px-4">
          <Brand />
        </div>
        <div className="px-2 pt-2">
          <div className="px-2.5 pb-2 text-[11px] font-medium uppercase tracking-wider text-subtle">Workspace</div>
          <NavItems />
        </div>
        <div className="mt-auto p-3">
          <ConnectionPill />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="cursor-pointer rounded-md p-2 text-muted hover:bg-white/[0.05] hover:text-foreground"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </header>
      {mobileOpen && (
        <div className="sticky top-14 z-20 border-b border-border bg-background p-3 animate-fade-in md:hidden">
          <NavItems onNavigate={() => setMobileOpen(false)} />
          <ConnectionPill className="mt-3" />
        </div>
      )}

      <main className="relative md:pl-60">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.045),transparent_70%)]"
        />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 animate-fade-in" key={location.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
