import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowUpRight, CalendarDays, FileImage, FolderPlus, Search, X } from 'lucide-react';
import { getListProjectsQueryKey, useCreateProject, useListProjects } from '@workspace/api-client-react';
import type { ProjectSummary } from '@workspace/api-client-react';
import { PageMeta, StatusPill, WorldForgeShell } from '@/components/world-forge-shell';
import { conceptImagePath, demoSummaries } from '@/lib/worldforge-demo';

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const projectsQuery = useListProjects();
  const createProject = useCreateProject();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [imageName, setImageName] = useState('');
  const projects = useMemo(() => ((projectsQuery.data?.length ? projectsQuery.data : demoSummaries) as ProjectSummary[]).filter((project) => `${project.name} ${project.imageName}`.toLowerCase().includes(search.toLowerCase())), [projectsQuery.data, search]);

  function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !imageName.trim()) return;
    createProject.mutate({ data: { name: name.trim(), imageName: imageName.trim() } }, {
      onSuccess: (project) => { queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }); setShowCreate(false); setName(''); setImageName(''); setLocation(`/project/${project.id}`); },
    });
  }

  return <WorldForgeShell><div className="min-h-[100dvh]">
    <PageMeta eyebrow="Library / worlds" title="Project library" description="Every image has a coordinate system waiting inside it. Keep your worlds close, and your assumptions visible.">
      <button onClick={() => setShowCreate(true)} data-testid="button-new-project" className="flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_22px_hsl(var(--primary)/.2)] hover:-translate-y-0.5"><FolderPlus size={16} /> New world</button>
    </PageMeta>
    <section className="px-5 py-6 sm:px-8 lg:px-10">
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div className="wf-kicker text-muted-foreground">{projects.length.toString().padStart(2, '0')} worlds in forge</div><label className="flex max-w-xs items-center gap-2 border-b border-border pb-2 text-muted-foreground"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-projects" placeholder="Filter worlds" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60" /></label></div>
      {projectsQuery.isLoading ? <ProjectSkeleton /> : projectsQuery.isError && !projectsQuery.data ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive" data-testid="error-projects">Couldn’t reach the project index. Showing your local workspace. <button onClick={() => projectsQuery.refetch()} data-testid="button-retry-projects" className="ml-2 underline">Retry</button></div> : projects.length === 0 ? <div className="wf-grid rounded-xl border border-dashed border-border py-20 text-center" data-testid="empty-projects"><FileImage className="mx-auto mb-3 text-muted-foreground/50" size={28} /><h2 className="font-serif text-2xl">No worlds match that filter.</h2><p className="mt-2 text-sm text-muted-foreground">Try a different name, or start a new world.</p></div> : <div className="grid gap-4 lg:grid-cols-2">
        {projects.map((project, index) => <ProjectCard key={project.id} project={project} index={index} />)}
      </div>}
    </section>
    {showCreate && <div className="fixed inset-0 z-30 grid place-items-center bg-[hsl(198_38%_17%/.45)] p-5 backdrop-blur-sm"><form onSubmit={submitCreate} className="wf-panel relative w-full max-w-md rounded-xl border border-border bg-card p-6" data-testid="form-create-project"><button type="button" onClick={() => setShowCreate(false)} data-testid="button-close-create" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"><X size={18} /></button><div className="wf-kicker text-primary">New world / setup</div><h2 className="mt-2 font-serif text-3xl">Name the place.</h2><p className="mt-2 text-sm text-muted-foreground">Start with an image reference. Measurements come next.</p><label className="mt-6 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">World name<input value={name} onChange={(event) => setName(event.target.value)} data-testid="input-project-name" autoFocus className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" placeholder="e.g. The Sunken Marches" /></label><label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Concept image filename<input value={imageName} onChange={(event) => setImageName(event.target.value)} data-testid="input-project-image" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary" placeholder="concept-art.jpg" /></label>{createProject.isError && <p className="mt-3 text-xs text-destructive" data-testid="error-create-project">Couldn’t create this world. Check the details and try again.</p>}<button disabled={createProject.isPending} data-testid="button-submit-project" className="mt-6 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">{createProject.isPending ? 'Creating world…' : 'Create workspace'}</button></form></div>}
  </div></WorldForgeShell>;
}

function ProjectCard({ project, index }: { project: ProjectSummary; index: number }) {
  return <Link href={`/project/${project.id}`} data-testid={`card-project-${project.id}`} className="group wf-panel relative overflow-hidden rounded-xl border border-border bg-card p-4 hover:-translate-y-0.5 hover:border-primary/50">
      <div className={`relative mb-4 flex h-36 items-end overflow-hidden rounded-lg ${index % 2 ? 'bg-[#d4ddd5]' : 'bg-[#263f48]'}`}>
       <div className="absolute inset-0 opacity-90" style={project.id === 'atlas-01' ? { backgroundImage: `linear-gradient(0deg, hsl(198 38% 17%/.65), transparent 75%), url("${conceptImagePath}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : { backgroundImage: 'linear-gradient(135deg, hsl(164 43% 70%/.3), transparent 55%), repeating-linear-gradient(125deg, transparent 0 18px, hsl(41 34% 91%/.12) 19px 20px)' }} />
      <span className="relative m-3 font-mono text-[10px] uppercase tracking-[.14em] text-white/75">world reference / {String(index + 1).padStart(2, '0')}</span><ArrowUpRight className="absolute right-3 top-3 text-white/75 opacity-0 transition-opacity group-hover:opacity-100" size={18} />
    </div>
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-[17px] font-semibold tracking-[-.02em]">{project.name}</h2><p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground"><FileImage size={11} />{project.imageName}</p></div><StatusPill status={project.status} /></div>
    <div className="mt-5 flex items-center gap-4 border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[.06em] text-muted-foreground"><span>{project.landmarkCount} landmarks</span><span>{project.assetCount} assets</span><span className="ml-auto flex items-center gap-1"><CalendarDays size={11} />{new Date(project.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div>
  </Link>;
}

function ProjectSkeleton() { return <div className="grid gap-4 lg:grid-cols-2">{[1, 2].map((item) => <div key={item} className="h-72 animate-pulse rounded-xl border border-border bg-muted/50" />)}</div>; }