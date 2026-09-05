import { Link, useLocation } from 'wouter';
import { Activity, BookOpen, Bot, ChevronRight, Layers3, Map, Settings2, Sparkles, Waypoints } from 'lucide-react';

export function WorldForgeShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const workspaceActive = location === '/' || location.startsWith('/project/');
  return (
    <div className="min-h-[100dvh] bg-background text-foreground flex flex-col md:flex-row font-sans">
      <aside className="relative z-20 flex w-full shrink-0 flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-[100dvh] md:w-[260px] border-r border-sidebar-border shadow-xl md:shadow-none">
        <div className="flex items-center justify-between border-b border-sidebar-border/50 px-6 py-5 md:block">
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-90" data-testid="link-brand">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_4px_12px_hsl(var(--sidebar-primary)/0.3)]">
              <Waypoints size={20} strokeWidth={2.5} />
            </span>
            <span>
              <span className="block font-mono text-[9px] uppercase tracking-[0.3em] text-sidebar-primary/90">World</span>
              <span className="block text-[18px] font-bold leading-none tracking-tight text-white mt-0.5">Forge</span>
            </span>
          </Link>
        </div>

        <div className="hidden px-6 pt-8 pb-4 md:block">
          <span className="wf-kicker text-sidebar-foreground/50">Production Cockpit</span>
          <p className="mt-2.5 text-[12px] leading-relaxed text-sidebar-foreground/70">
            Concept to coordinates.<br />Atmosphere to assembly.
          </p>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 py-3 md:mt-4 md:block md:space-y-1.5 md:px-4 wf-scroll" aria-label="Primary navigation">
          <NavItem href="/" active={workspaceActive} icon={<Map size={17} />} label="Workspace" testId="link-workspace" />
          <NavItem href="/projects" active={location === '/projects'} icon={<Layers3 size={17} />} label="Project Library" testId="link-projects" />
          <NavItem href="/developer-access" active={location === '/developer-access'} icon={<Bot size={17} />} label="AI Agent Access" testId="link-developer-access" />
        </nav>

        <div className="hidden flex-1 md:block" />

        <div className="hidden border-t border-sidebar-border/50 bg-sidebar-accent/30 px-6 py-6 md:block">
          <div className="mb-4 flex items-center gap-2.5 text-sidebar-foreground/60">
            <Activity size={15} />
            <span className="wf-kicker">Engine Bridge</span>
            <span className="ml-auto flex h-2 w-2 rounded-full bg-sidebar-primary shadow-[0_0_8px_hsl(var(--sidebar-primary))]" />
          </div>
          <div className="space-y-1 font-mono text-[10px] leading-relaxed text-sidebar-foreground/45 uppercase tracking-wider">
            <p>Unreal 5.8 Export Ready</p>
            <p>Core Runtime v0.8.2</p>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 relative bg-background">{children}</main>
    </div>
  );
}

function NavItem({ href, active, icon, label, testId }: { href: string; active: boolean; icon: React.ReactNode; label: string; testId: string }) {
  return (
    <Link href={href} data-testid={testId} className={`group flex min-w-max items-center gap-3 rounded-md px-3.5 py-3 text-[13px] font-semibold transition-all ${active ? 'bg-sidebar-accent text-white shadow-sm' : 'text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-white'}`}>
      <span className={`transition-colors ${active ? 'text-sidebar-primary' : 'text-sidebar-foreground/40 group-hover:text-sidebar-primary/80'}`}>{icon}</span>
      <span>{label}</span>
      {active && <ChevronRight size={14} className="ml-auto hidden opacity-80 md:block text-sidebar-primary" />}
    </Link>
  );
}

export function PageMeta({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children?: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden bg-card px-6 py-8 sm:px-10 lg:flex lg:items-end lg:justify-between border-b border-border shadow-sm z-10">
      <div className="relative z-10">
        <div className="wf-kicker text-primary flex items-center gap-2">
          <span className="h-1 w-3 bg-primary rounded-full"></span>
          {eyebrow}
        </div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-4 max-w-2xl text-[14px] font-medium leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="relative z-10 mt-6 flex shrink-0 items-center gap-3 lg:mt-0">{children}</div>}

      {/* Decorative background element for premium feel */}
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-muted/40 to-transparent pointer-events-none" />
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string; dot: string }> = {
    ready: { label: 'Ready', className: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20', dot: 'bg-emerald-500' },
    analyzing: { label: 'Analyzing', className: 'bg-amber-500/10 text-amber-700 border-amber-500/20', dot: 'bg-amber-500 animate-pulse' },
    draft: { label: 'Draft', className: 'bg-muted text-muted-foreground border-border', dot: 'bg-muted-foreground' }
  };
  const item = config[status] ?? config.draft;
  return (
    <span data-testid={`status-${status}`} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${item.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />
      {item.label}
    </span>
  );
}

export function IconButton({ label, children, onClick, testId, disabled = false }: { label: string; children: React.ReactNode; onClick: () => void; testId: string; disabled?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} data-testid={testId} onClick={onClick} disabled={disabled} className="grid h-10 w-10 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:shadow-sm disabled:pointer-events-none disabled:opacity-40">
      {children}
    </button>
  );
}

export const mutedIcon = <Settings2 size={15} />;
export const docsIcon = <BookOpen size={15} />;
export const sparkIcon = <Sparkles size={15} />;