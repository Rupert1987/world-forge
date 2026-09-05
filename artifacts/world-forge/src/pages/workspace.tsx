import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'wouter';
import { AlertTriangle, ArrowDownToLine, Check, ChevronDown, ChevronRight, Copy, Crosshair, Download, Expand, FileCode2, FileImage, Gauge, Grid3X3, Images, Info, Layers3, LoaderCircle, MapPin, Pencil, RefreshCw, Route, Ruler, Save, ShieldCheck, Target, X } from 'lucide-react';
import { getGetProjectQueryKey, getGetProjectSummaryQueryKey, useAnalyzeProject, useExportProject, useGetProject, useGetProjectSummary, useUpdateProject } from '@workspace/api-client-react';
import type { AnalysisResult, LandmarkSpec, Project } from '@workspace/api-client-react';
import { PageMeta, StatusPill, WorldForgeShell } from '@/components/world-forge-shell';
import { conceptImagePath, demoAnalysis, demoProject } from '@/lib/worldforge-demo';

const VIEW_GUIDE = [
  { number: '01', label: 'Wide master', detail: 'Full scene, straight-on composition. Keep the whole coastline, main city and horizon visible.', prompt: 'View 1 — wide master composition, straight-on, full environment visible, keep the entire coastline and horizon in frame.' },
  { number: '02', label: 'Left three-quarter', detail: 'Move 35–45° to the left. Reveal the near side of the city, walls and docks without changing the world.', prompt: 'View 2 — left three-quarter camera, 35–45 degrees from the master, same world and scale, reveal the near side of the city and harbor.' },
  { number: '03', label: 'Right three-quarter', detail: 'Move 35–45° to the right. Reveal the opposite faces, rear terrain and landmark depth.', prompt: 'View 3 — right three-quarter camera, 35–45 degrees from the master, same world and scale, reveal opposite faces and rear terrain.' },
] as const;

const MULTI_VIEW_PROMPT = `Create the same open-world environment as three consistent concept views. ${VIEW_GUIDE.map((view) => view.prompt).join(' ')} Preserve identical landmarks, materials, lighting language and relative scale across all views. Do not redesign or add objects between angles.`;

function clientExportReadiness(analysis: AnalysisResult) {
  const camera = analysis.cameraGeometryVerification;
  const poseVerified =
    camera?.status === "verified" && Boolean(camera.serverComputedResiduals);
  const meters = analysis.calibrationEvidence?.knownScaleMeters;
  const pixels = analysis.calibrationEvidence?.knownScalePixelDistance;
  const metricScaleKnown =
    typeof meters === "number" &&
    meters > 0 &&
    typeof pixels === "number" &&
    pixels >= 10;
  const failingChecks: string[] = [];
  if (!poseVerified) failingChecks.push("camera-geometry-unverified");
  if (!metricScaleKnown) failingChecks.push("metric-scale-unknown");
  const tier =
    poseVerified && metricScaleKnown
      ? ("scale-locked" as const)
      : poseVerified
        ? ("verified" as const)
        : ("draft" as const);
  return {
    tier,
    poseVerified,
    metricScaleKnown,
    exportReadyCm: tier === "scale-locked",
    exportReadyDraft: Boolean(analysis.map && analysis.landmarks?.length),
    failingChecks,
  };
}

export default function WorkspacePage() {
  const params = useParams<{ id?: string }>();
  const projectId = params.id || 'atlas-01';
  const queryClient = useQueryClient();
  const projectQuery = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: !!projectId, refetchOnMount: 'always', refetchOnWindowFocus: true } });
  const summaryQuery = useGetProjectSummary(projectId, { query: { queryKey: getGetProjectSummaryQueryKey(projectId), enabled: !!projectId, refetchOnMount: 'always', refetchOnWindowFocus: true } });
  const project = (projectQuery.data ?? (projectId === demoProject.id ? demoProject : null)) as Project | null;
  const analysis = project?.analysis ?? demoAnalysis;
  const analyzeProject = useAnalyzeProject();
  const updateProject = useUpdateProject();
  const exportQuery = useExportProject(projectId, { query: { queryKey: [`/api/projects/${projectId}/export`], enabled: false } });
  const [activeLandmark, setActiveLandmark] = useState<string | null>(analysis.landmarks[0]?.id ?? null);
  const [showSetup, setShowSetup] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [width, setWidth] = useState(analysis.map.widthMeters);
  const [depth, setDepth] = useState(analysis.map.depthMeters);
  const [grid, setGrid] = useState(analysis.map.gridSizeMeters);
  const [knownScale, setKnownScale] = useState('');
  const [knownScalePixelDistance, setKnownScalePixelDistance] = useState('');
  const [reprojectionErrorPixels, setReprojectionErrorPixels] = useState('');
  const [imageSrc, setImageSrc] = useState(conceptImagePath);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageDirty, setImageDirty] = useState(false);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [savedNotice, setSavedNotice] = useState(false);
  const [exportError, setExportError] = useState('');
  const active = analysis.landmarks.find((landmark) => landmark.id === activeLandmark) ?? analysis.landmarks[0];
  const isAnalyzing = analyzeProject.isPending || project?.status === 'analyzing';
  const visibleSummary = summaryQuery.data;

  async function runAnalysis(event: React.FormEvent) {
    event.preventDefault();
    const dataForAnalysis = imageData ?? await imageUrlToDataUrl(imageSrc);
    analyzeProject.mutate({ projectId, data: { imageData: dataForAnalysis, referenceImages, mapWidthMeters: Number(width), mapDepthMeters: Number(depth), gridSizeMeters: Number(grid), knownScale: knownScale ? Number(knownScale) : null, knownScalePixelDistance: knownScalePixelDistance ? Number(knownScalePixelDistance) : null, reprojectionErrorPixels: reprojectionErrorPixels ? Number(reprojectionErrorPixels) : null } }, {
      onSuccess: (result) => { queryClient.setQueryData(getGetProjectQueryKey(projectId), (old: Project | undefined) => old ? { ...old, status: 'ready', analysis: result } : old); setImageDirty(false); setShowSetup(false); },
    });
  }

  function handleImageFile(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null;
      if (result) {
        setImageSrc(result);
        setImageData(result);
        setImageDirty(true);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleReferenceFiles(files?: FileList | null) {
    if (!files?.length) {
      setReferenceImages([]);
      return;
    }
    const selected = Array.from(files).slice(0, 8);
    const encoded = await Promise.all(selected.map(fileToDataUrl));
    setReferenceImages((current) => [...current, ...encoded].slice(0, 8));
  }

  function saveSettings() {
    // Status "ready" is analysis-owned; never PATCH ready from the Save button.
    updateProject.mutate({ projectId, data: { name: project?.name } }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }); setSavedNotice(true); window.setTimeout(() => setSavedNotice(false), 2500); } });
  }

  const exportReadiness = clientExportReadiness(analysis);

  async function downloadExport(mode: 'cm' | 'draft' = 'cm') {
    setExportError('');
    if (mode === 'cm' && !exportReadiness.exportReadyCm) {
      setExportError(`Unreal cm export locked (${exportReadiness.tier}). Fix: ${exportReadiness.failingChecks.join(', ') || 'complete analysis'}. Use Draft export for an unscaled hypothesis.`);
      return;
    }
    try {
      const url = mode === 'draft'
        ? `/api/projects/${projectId}/export?draft=1`
        : `/api/projects/${projectId}/export`;
      const response = await fetch(url, { credentials: 'include' });
      if (response.status === 409) {
        const body = await response.json().catch(() => ({})) as { failingChecks?: string[]; tier?: string; message?: string };
        setExportError(body.message ?? `Export blocked (${body.tier ?? 'locked'}): ${(body.failingChecks ?? []).join(', ')}`);
        return;
      }
      if (!response.ok) {
        setExportError('Export bundle is not available yet. Run analysis first, then try again.');
        return;
      }
      const data = await response.json();
      exportQuery.setQueryData?.(data);
      // Store on local state via refetch cache fallback
      (exportQuery as { data?: unknown }).data = data;
      setShowExport(true);
      // Prefer putting payload into react-query cache
      queryClient.setQueryData([`/api/projects/${projectId}/export`], data);
    } catch {
      setExportError('Export request failed. Check the API and try again.');
    }
  }

  if (projectQuery.isLoading && !project) return <WorldForgeShell><WorkspaceLoading /></WorldForgeShell>;
  if (projectQuery.isError && !project) return <WorldForgeShell><div className="grid min-h-[70vh] place-items-center p-6"><div className="max-w-sm text-center"><AlertTriangle className="mx-auto mb-4 text-accent" /><h1 className="font-serif text-3xl">Workspace unavailable</h1><p className="mt-2 text-sm text-muted-foreground">We couldn’t load this world from the forge.</p><button onClick={() => projectQuery.refetch()} data-testid="button-retry-workspace" className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><RefreshCw size={15} /> Retry connection</button></div></div></WorldForgeShell>;

  return <WorldForgeShell><div className="min-h-[100dvh]">
    <PageMeta eyebrow="World workspace / analysis" title={project?.name ?? 'Untitled world'} description={`${project?.imageName ?? 'Concept reference'} · updated ${project ? new Date(project.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'just now'}`}>
      <StatusPill status={project?.status ?? 'draft'} /><button onClick={() => setShowSetup(true)} data-testid="button-edit-analysis" className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm font-semibold hover:border-primary/50 hover:bg-primary/5"><Pencil size={14} /> Configure</button><button type="button" onClick={() => downloadExport('draft')} disabled={exportQuery.isFetching || !exportReadiness.exportReadyDraft} title={!exportReadiness.exportReadyDraft ? 'Run analysis first' : 'Unscaled draft · units=arbitrary · pose=unsolved'} data-testid="button-export-draft" className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-sm font-semibold hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"><Download size={14} /> Draft</button><button type="button" onClick={() => downloadExport('cm')} disabled={exportQuery.isFetching || !exportReadiness.exportReadyCm} title={exportReadiness.exportReadyCm ? 'Scale-locked Unreal cm export' : `Locked until scale-locked. Failing: ${exportReadiness.failingChecks.join(', ') || 'analysis'}`} data-testid="button-export-project" className="flex items-center gap-2 rounded-md bg-foreground px-3 py-2.5 text-sm font-semibold text-background hover:-translate-y-0.5 disabled:opacity-50"><Download size={14} /> {exportQuery.isFetching ? 'Packing…' : 'Export Unreal cm'}</button>
    </PageMeta>
    <div className="px-5 py-6 sm:px-8 lg:px-10">
      <ConfidenceBanner analysis={analysis} updatedAt={project?.updatedAt} />
      <MultiViewGuidePanel />
      <WorkflowGuidePanel onConfigure={() => setShowSetup(true)} onExport={() => downloadExport(exportReadiness.exportReadyCm ? 'cm' : 'draft')} />
      {savedNotice && <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm" data-testid="status-saved"><Check size={16} className="text-primary" /> Workspace settings saved to the forge.</div>}
      {exportError && <div className="mb-4 flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-4 py-3 text-sm" data-testid="error-export"><span>{exportError}</span><button onClick={() => setExportError('')} data-testid="button-close-export-error"><X size={16} /></button></div>}
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(330px,.8fr)]">
        <ConceptCanvas analysis={analysis} active={active} setActive={setActiveLandmark} isAnalyzing={isAnalyzing} overlayStale={imageDirty} imageName={project?.imageName} imageSrc={imageSrc} onImageFile={handleImageFile} />
        <MapSpecCard analysis={analysis} summary={visibleSummary} onConfigure={() => setShowSetup(true)} />
      </section>
      <section className="mt-5">
        <BlueprintPanel analysis={analysis} activeLandmarkId={active?.id} setActiveLandmark={setActiveLandmark} />
      </section>
      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <LandmarkPanel landmarks={analysis.landmarks} active={active} setActive={setActiveLandmark} />
        <ValidationPanel analysis={analysis} />
      </section>
      <section className="mt-5">
        <ReconstructionPanel analysis={analysis} />
      </section>
      {analysis.visualSurvey && <section className="mt-5">
        <VisualSurveyPanel analysis={analysis} />
      </section>}
      {analysis.surveyAudit && <section className="mt-5">
        <SurveyAuditPanel analysis={analysis} />
      </section>}
      <section className="mt-5">
        <DepthMapPanel analysis={analysis} />
      </section>
      <section className="mt-5">
        <CalibrationEvidencePanel
          knownScale={knownScale}
          knownScalePixelDistance={knownScalePixelDistance}
          reprojectionErrorPixels={reprojectionErrorPixels}
          referenceImageCount={referenceImages.length}
          verificationStatus={analysis.calibrationEvidence?.verificationStatus ?? 'unverified-claim'}
          setKnownScale={setKnownScale}
          setKnownScalePixelDistance={setKnownScalePixelDistance}
          setReprojectionErrorPixels={setReprojectionErrorPixels}
          onConfigure={() => setShowSetup(true)}
        />
      </section>
      {analysis.geometryVerification && <section className="mt-5">
        <GeometryVerificationPanel analysis={analysis} />
      </section>}
      <section className="mt-5">
        <SpatialRelationsPanel analysis={analysis} activeLandmarkId={active?.id} />
      </section>
       <section className="mt-5"><AssetTable analysis={analysis} /></section>
       <section className="mt-5"><ProductionHandoffPanel analysis={analysis} onSave={saveSettings} saving={updateProject.isPending} /></section>
    </div>
      {showSetup && <SetupDialog analysis={analysis} width={width} depth={depth} grid={grid} knownScale={knownScale} imageSrc={imageSrc} referenceImageCount={referenceImages.length} onImageFile={handleImageFile} onReferenceFiles={handleReferenceFiles} setWidth={setWidth} setDepth={setDepth} setGrid={setGrid} setKnownScale={setKnownScale} onClose={() => setShowSetup(false)} onSubmit={runAnalysis} loading={analyzeProject.isPending} error={analyzeProject.isError} />}
    {showExport && <ExportDialog exportData={exportQuery.data} onClose={() => setShowExport(false)} />}
  </div></WorldForgeShell>;
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not read concept image');
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not encode concept image'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode concept image'));
    reader.readAsDataURL(blob);
  });
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not encode reference image'));
    reader.onerror = () => reject(reader.error ?? new Error('Could not encode reference image'));
    reader.readAsDataURL(file);
  });
}

function ConceptCanvas({ analysis, active, setActive, isAnalyzing, overlayStale, imageName, imageSrc, onImageFile }: { analysis: AnalysisResult; active?: LandmarkSpec; setActive: (id: string) => void; isAnalyzing: boolean; overlayStale: boolean; imageName?: string; imageSrc: string; onImageFile: (file?: File) => void }) {
  const surveyedObjects = analysis.visualSurvey?.objects ?? [];
  const surveyById = new Map(surveyedObjects.map((object) => [object.id, object]));
  const pointFor = (landmark: LandmarkSpec) => {
    const surveyObject = landmark.sourceSurveyObjectId
      ? surveyById.get(landmark.sourceSurveyObjectId)
      : undefined;
    if (!surveyObject) return null;
    return {
      left: `${Math.max(2, Math.min(98, surveyObject.groundContact.x * 100))}%`,
      top: `${Math.max(2, Math.min(98, surveyObject.groundContact.y * 100))}%`,
    };
  };
  const imageLandmarks = analysis.landmarks
    .map((landmark) => ({ landmark, point: pointFor(landmark) }))
    .filter((item): item is { landmark: LandmarkSpec; point: { left: string; top: string } } => item.point !== null);
  const missingImageLandmarks = analysis.landmarks.length - imageLandmarks.length;
  return <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card flex flex-col"><div className="flex items-center justify-between border-b border-border bg-card px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary"><Crosshair size={16} /></div><div><div className="text-sm font-bold">Spatial Read</div><div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Image-space evidence projection</div></div></div><div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-3 py-1.5 rounded-full"><span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_currentColor]" />{Math.round(analysis.confidence * 100)}% Match</div></div><div className="relative aspect-[16/9] w-full overflow-hidden bg-[#0A0D14]"><img src={imageSrc} alt="Concept art reference" data-testid="img-concept-reference" className="h-full w-full object-cover opacity-80 mix-blend-screen" /><div className="absolute inset-0 bg-gradient-to-t from-[#0A0D14]/90 via-[#0A0D14]/20 to-transparent pointer-events-none" /><div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'linear-gradient(hsl(var(--primary)/0.6) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)/0.6) 1px, transparent 1px)', backgroundSize: '10% 10%' }} />{!overlayStale && imageLandmarks.map(({ landmark, point }) => <button key={landmark.id} onClick={() => setActive(landmark.id)} data-testid={`button-landmark-marker-${landmark.id}`} className={`absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-300 hover:scale-125 ${active?.id === landmark.id ? 'z-10 scale-125' : ''}`} style={point} title={`${landmark.name} · image evidence anchor`}><span className={`grid h-8 w-8 items-center justify-center rounded-full border-2 shadow-lg transition-colors ${active?.id === landmark.id ? 'border-primary bg-primary text-primary-foreground scale-110' : 'border-primary/80 bg-[#0A0D14]/80 text-primary backdrop-blur-sm'}`}><MapPin size={14} fill={active?.id === landmark.id ? "currentColor" : "none"} strokeWidth={active?.id === landmark.id ? 2 : 2.5} /></span><span className={`absolute left-1/2 top-10 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider backdrop-blur-md transition-colors ${active?.id === landmark.id ? 'bg-primary text-primary-foreground' : 'bg-[#0A0D14]/90 text-white/90 border border-white/10'}`}>{landmark.name}</span></button>)}{!overlayStale && !analysis.visualSurvey && <div data-testid="notice-overlay-unavailable" className="absolute left-1/2 top-1/2 w-[90%] max-w-md -translate-x-1/2 -translate-y-1/2 -translate-y-1/2 rounded-xl border border-primary/30 bg-[#0A0D14]/90 p-5 text-center text-white shadow-2xl backdrop-blur-md"><Info className="mx-auto mb-2 text-primary" size={24} /><div className="text-sm font-bold">Image markers unavailable</div><p className="mt-1 text-xs leading-relaxed text-white/70">Run the visual survey to place landmarks from image-space evidence. World coordinates remain available in the blueprint.</p></div>}{!overlayStale && analysis.visualSurvey && missingImageLandmarks > 0 && <div data-testid="notice-overlay-partial" className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-md border border-amber-500/30 bg-[#0A0D14]/90 px-3 py-2 text-center text-[10px] text-white/80 shadow-lg">Showing {imageLandmarks.length} of {analysis.landmarks.length} landmarks with image evidence</div>}{overlayStale && <div data-testid="notice-overlay-stale" className="absolute left-1/2 top-1/2 w-[90%] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-amber-500/30 bg-[#0A0D14]/95 p-6 text-center text-white shadow-2xl backdrop-blur-md"><AlertTriangle className="mx-auto mb-3 text-amber-500" size={28} /><div className="text-base font-bold tracking-tight">Overlay hidden until re-analysis</div><p className="mt-2 text-sm text-white/70 leading-relaxed">The visible image changed. Previous XYZ markers are no longer shown as if they matched.</p></div>}<label className="absolute right-4 top-4 flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-[#0A0D14]/80 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-white/80 transition-colors hover:bg-white/10 hover:text-white backdrop-blur-sm"><FileImage size={14} /> Replace Source<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => onImageFile(event.target.files?.[0])} /></label>{isAnalyzing && <div className="absolute inset-0 grid place-items-center bg-[#0A0D14]/80 backdrop-blur-md z-20"><div className="flex flex-col items-center text-white"><div className="relative h-12 w-12 mb-4"><div className="absolute inset-0 rounded-full border-2 border-primary/20"></div><div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin"></div><LoaderCircle className="absolute inset-0 m-auto animate-pulse text-primary opacity-50" size={20} /></div><div className="font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-primary">Reading terrain signals</div><div className="mt-2 text-sm font-medium text-white/60">Cross-referencing spatial anchors</div></div></div>}<div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md border border-white/10 bg-[#0A0D14]/80 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-white/80 backdrop-blur-sm"><Grid3X3 size={14} className="text-primary" /><span>{analysis.map.gridSizeMeters}m grid</span><span className="w-px h-3 bg-white/20 mx-1"></span><span>X→ East</span><span className="w-px h-3 bg-white/20 mx-1"></span><span>Y↓ South</span><span className="w-px h-3 bg-white/20 mx-1"></span><span>Z↑ Up</span></div><button onClick={() => document.documentElement.requestFullscreen?.()} data-testid="button-expand-canvas" className="absolute bottom-4 right-4 grid h-9 w-9 place-items-center rounded-md border border-white/10 bg-[#0A0D14]/80 text-white/80 transition-colors hover:bg-white/10 hover:text-white backdrop-blur-sm" title="Expand canvas"><Expand size={15} /></button></div><div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-card px-5 py-4 border-t border-border font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-primary/80" /> Built Mass</span><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-accent/80" /> Landmark</span><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-muted-foreground/50" /> High Ground</span><span className="ml-auto flex items-center gap-2"><FileImage size={13} className="text-primary/70" />{imageName ?? 'Reference Image'}</span></div></div>;
}

function MapSpecCard({ analysis, summary, onConfigure }: { analysis: AnalysisResult; summary?: { mapSize: string; landmarkCount: number; assetCount: number }; onConfigure: () => void }) {
  const map = analysis.map;
  const metrics = [{ label: 'Map envelope', value: `${(map.widthMeters / 1000).toFixed(1)} × ${(map.depthMeters / 1000).toFixed(1)} km` }, { label: 'Elevation ceiling', value: `${map.maxElevationMeters} m` }, { label: 'World chunks', value: map.chunkCount.toLocaleString() }, { label: 'Working grid', value: `${map.gridSizeMeters} m` }];
  return <div className="wf-panel rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="wf-kicker text-primary">Build specification / 01</div><h2 className="mt-1 text-[17px] font-semibold">Map envelope</h2></div><button onClick={onConfigure} data-testid="button-configure-map" className="text-muted-foreground hover:text-foreground" title="Configure map"><Pencil size={15} /></button></div><div className="grid grid-cols-2">{metrics.map((metric) => <div key={metric.label} className="border-b border-r border-border px-5 py-4 last:border-r-0"><div className="text-[11px] text-muted-foreground">{metric.label}</div><div className="mt-1 font-mono text-[17px] tracking-[-.04em]">{metric.value}</div></div>)}</div><div className="space-y-3 px-5 py-4"><DetailRow label="Origin" value={map.origin ?? 'Image center'} /><DetailRow label="Coordinates" value={map.coordinateSystem ?? 'UE World / Z-up'} /><DetailRow label="Summary" value={summary ? `${summary.landmarkCount} landmarks · ${summary.assetCount} assets` : 'Analysis snapshot'} /></div><div className="mx-5 mb-5 flex items-center gap-2 rounded-md bg-muted/70 px-3 py-2.5"><Ruler size={14} className="text-primary" /><span className="text-xs text-muted-foreground">Dimensions are planning hypotheses in meters for an editable Unreal blockout.</span></div></div>;
}
function DetailRow({ label, value }: { label: string; value: string }) { return <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-2 text-xs last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-mono text-[10px] text-right">{value}</span></div>; }

function LandmarkPanel({ landmarks, active, setActive }: { landmarks: LandmarkSpec[]; active?: LandmarkSpec; setActive: (id: string) => void }) {
  return <div className="wf-panel rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="wf-kicker text-primary">Spatial anchors / full read</div><h2 className="mt-1 text-[17px] font-semibold">Landmarks</h2></div><span className="font-mono text-[11px] text-muted-foreground">{landmarks.length.toString().padStart(2, '0')} mapped</span></div><div className="divide-y divide-border">{landmarks.map((landmark, index) => <button type="button" key={landmark.id} onClick={() => setActive(landmark.id)} data-testid={`button-select-landmark-${landmark.id}`} className={`flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/55 ${active?.id === landmark.id ? 'bg-primary/5' : ''}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md font-mono text-[10px] ${active?.id === landmark.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{landmark.name}</span><span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[.06em] text-muted-foreground">{landmark.type} · {landmark.footprint}</span></span><span className="text-right"><span className="block font-mono text-[11px]">{Math.round(landmark.confidence * 100)}%</span><span className="block font-mono text-[9px] text-muted-foreground">{landmark.assetCount} assets</span></span></button>)}</div>{active && <div className="border-t border-border bg-muted/30 px-5 py-4"><div className="mb-3 flex items-center gap-2 text-xs font-semibold"><Target size={14} className="text-primary" />{active.name} transform</div><div className="grid grid-cols-3 gap-2">{[['X', active.x], ['Y', active.y], ['Z', active.z]].map(([label, value]) => <div key={String(label)} className="rounded border border-border bg-card px-2.5 py-2"><div className="wf-kicker text-muted-foreground">{label}</div><div className="mt-1 font-mono text-xs">{value}m</div></div>)}</div></div>}</div>;
}

function ValidationPanel({ analysis }: { analysis: AnalysisResult }) {
  const counts = useMemo(() => ({ pass: analysis.validations.filter((item) => item.severity === 'pass').length, warning: analysis.validations.filter((item) => item.severity === 'warning').length, critical: analysis.validations.filter((item) => item.severity === 'critical').length }), [analysis.validations]);
  return <div className="wf-panel rounded-xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="wf-kicker text-primary">Build checks / 06</div><h2 className="mt-1 text-[17px] font-semibold">Validation findings</h2></div><div className="flex items-center gap-1.5 font-mono text-[10px]"><span className="rounded bg-primary/15 px-2 py-1 text-primary">{counts.pass} pass</span>{counts.warning > 0 && <span className="rounded bg-accent/20 px-2 py-1 text-accent-foreground">{counts.warning} warn</span>}{counts.critical > 0 && <span className="rounded bg-destructive/15 px-2 py-1 text-destructive">{counts.critical} critical</span>}</div></div><div className="divide-y divide-border">{analysis.validations.map((item) => <div key={item.id} className="flex gap-3 px-5 py-3.5"><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${item.severity === 'pass' ? 'bg-primary/15 text-primary' : item.severity === 'warning' ? 'bg-accent/20 text-accent-foreground' : 'bg-destructive/15 text-destructive'}`}>{item.severity === 'pass' ? <Check size={12} /> : <AlertTriangle size={12} />}</span><div><div className="text-sm font-semibold">{item.title}</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p></div></div>)}</div></div>;
}

function ReconstructionPanel({ analysis }: { analysis: AnalysisResult }) {
  const reconstruction = analysis.reconstruction;
  if (!reconstruction) return null;
  const methods = [
    { label: 'Camera hypothesis', value: reconstruction.cameraModel },
    { label: 'Depth inference', value: reconstruction.depthMethod },
    { label: 'Terrain completion', value: reconstruction.terrainMethod },
    { label: 'Occlusion graph', value: reconstruction.occlusionMethod },
  ];
  return <div className="wf-panel rounded-xl border border-border bg-card" data-testid="panel-reconstruction"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="wf-kicker text-primary">Single-image spatial reasoning</div><h2 className="mt-1 text-[17px] font-semibold">3D reconstruction hypothesis</h2></div><span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] text-primary">{reconstruction.mode.replaceAll('-', ' ')}</span></div><div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">{methods.map((method) => <div key={method.label} className="px-5 py-4"><div className="wf-kicker text-muted-foreground">{method.label}</div><p className="mt-2 text-xs leading-relaxed text-foreground/80">{method.value}</p></div>)}</div><div className="border-t border-border bg-muted/30 px-5 py-4"><div className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle size={14} className="text-accent-foreground" />What the image cannot prove</div><ul className="mt-2 grid gap-2 text-xs leading-relaxed text-muted-foreground md:grid-cols-3">{reconstruction.limitations.map((item) => <li key={item} className="flex items-start"><ChevronRight size={14} className="mr-1.5 shrink-0 text-primary/50" /><span>{item}</span></li>)}</ul></div></div>;
}

function DepthMapPanel({ analysis }: { analysis: AnalysisResult }) {
  const depth = analysis.depthMap;
  return <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card" data-testid="panel-depth-map"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="wf-kicker text-primary">Dense geometry signal</div><h2 className="mt-1 text-[17px] font-semibold">Monocular depth map</h2></div><span className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] ${depth?.status === 'ready' ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{depth?.status ?? 'not generated'}</span></div>{depth?.status === 'ready' && depth.previewUrl ? <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]"><div className="relative min-h-64 bg-[#132b33]"><img src={depth.previewUrl} alt="Depth Anything V2 relative depth map" data-testid="img-depth-map" className="h-full max-h-[520px] w-full object-contain" /><div className="absolute bottom-3 left-3 rounded bg-[hsl(198_38%_17%/.82)] px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-white/80">relative depth · not metric scale</div></div><div className="space-y-4 border-l border-border px-5 py-5"><DetailRow label="Provider" value={depth.provider} /><DetailRow label="Model" value={depth.model} /><DetailRow label="Resolution" value={`${depth.width ?? 0} × ${depth.height ?? 0}`} /><DetailRow label="Raw range" value={`${depth.min?.toFixed(3) ?? '—'} → ${depth.max?.toFixed(3) ?? '—'}`} /><DetailRow label="Source image" value={depth.sourceImageSha256 ? `${depth.sourceImageSha256.slice(0, 12)}…` : '—'} /><DetailRow label="Mean" value={depth.mean?.toFixed(3) ?? '—'} /><DetailRow label="Inference" value={depth.inferenceMilliseconds ? `${(depth.inferenceMilliseconds / 1000).toFixed(1)}s` : '—'} /><p className="rounded-md bg-muted/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">This is a real neural depth estimate tied to the canonical image hash. It strengthens ordering, silhouettes and terrain continuity, but remains relative on stylized concept art and does not independently prove world meters.</p></div></div> : <div className="px-5 py-6"><div className="flex items-start gap-3 rounded-md bg-muted/50 p-4"><Layers3 size={18} className="mt-0.5 shrink-0 text-primary" /><div><div className="text-sm font-semibold">{depth?.status === 'unavailable' ? 'Depth adapter unavailable' : 'Run analysis to generate dense depth'}</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{depth?.error ?? 'Depth-Anything V2 will run in parallel with the visual geometry survey and provide a pixel-level relative-depth signal.'}</p></div></div></div>}</div>;
}

function SurveyAuditPanel({ analysis }: { analysis: AnalysisResult }) {
  const audit = analysis.surveyAudit;
  if (!audit) return null;
  const checks = [
    ['Survey objects', `${audit.uniqueObjectCount} unique`],
    ['Linked landmarks', `${audit.linkedLandmarkCount} / ${audit.uniqueObjectCount}`],
    ['Missing objects', String(audit.missingSurveyObjectCount)],
    ['Unlinked landmarks', String(audit.unlinkedLandmarkCount)],
    ['Invalid geometry', String(audit.invalidGeometryCount)],
    ['Duplicate IDs', String(audit.duplicateIdCount)],
  ];
  return <div className="wf-panel rounded-xl border border-border bg-card" data-testid="panel-survey-audit"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="wf-kicker text-primary">Machine-checked provenance</div><h2 className="mt-1 text-[17px] font-semibold">Visual survey audit</h2></div><span className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] ${audit.status === 'pass' ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{audit.status}</span></div><div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-6">{checks.map(([label, value]) => <div key={label} className="px-4 py-4"><div className="wf-kicker text-muted-foreground">{label}</div><div className="mt-2 font-mono text-sm font-semibold">{value}</div></div>)}</div><div className="border-t border-border bg-muted/30 px-5 py-4"><ul className="grid gap-2 text-xs leading-relaxed text-muted-foreground lg:grid-cols-3">{audit.notes.map((note) => <li key={note} className="flex items-start"><ChevronRight size={14} className="mr-1.5 shrink-0 text-primary/50" /><span>{note}</span></li>)}</ul></div></div>;
}

function VisualSurveyPanel({ analysis }: { analysis: AnalysisResult }) {
  const survey = analysis.visualSurvey;
  if (!survey) return null;
  const occlusionLinks = survey.objects.reduce((total, object) => total + object.occludes.length + object.occludedBy.length, 0);
  const covered = Object.values(survey.coverageChecklist).filter(Boolean).length;
  const coverageTotal = Object.keys(survey.coverageChecklist).length;
  const metrics = [
    ['Objects', String(survey.objects.length)],
    ['Depth bands', String(survey.depthBands.length)],
    ['Terrain / water', `${survey.terrainContours.length} / ${survey.waterlines.length}`],
    ['Occlusion links', String(occlusionLinks)],
    ['Ambiguities', String(survey.ambiguities.length)],
    ['Coverage', `${covered} / ${coverageTotal}`],
  ];
  return <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card" data-testid="panel-visual-survey">
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="wf-kicker text-primary">Reusable source evidence / v{survey.version}</div><h2 className="mt-1 text-[17px] font-semibold">Persisted visual survey</h2><p className="mt-1 text-xs text-muted-foreground">Exact image-space observations retained for export and future reconstruction passes.</p></div>
      <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] text-primary">{survey.cameraHypothesis.viewElevation} · {survey.cameraHypothesis.perspectiveStrength} perspective</span>
    </div>
    <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-6">{metrics.map(([label, value]) => <div key={label} className="px-4 py-4"><div className="wf-kicker text-muted-foreground">{label}</div><div className="mt-2 font-mono text-sm font-semibold">{value}</div></div>)}</div>
    <div className="grid border-t border-border xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,.5fr)]">
      <div className="wf-scroll max-h-[460px] overflow-auto border-b border-border xl:border-b-0 xl:border-r">
        <table className="w-full min-w-[820px] text-left">
          <thead className="sticky top-0 z-10 bg-muted font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="px-5 py-3 font-normal">Observed object</th><th className="px-3 py-3 font-normal">Normalized box</th><th className="px-3 py-3 font-normal">Ground contact</th><th className="px-3 py-3 font-normal">Depth</th><th className="px-5 py-3 font-normal">Occlusion evidence</th></tr></thead>
          <tbody className="divide-y divide-border">{survey.objects.map((object, index) => <tr key={`${object.id}-${index}`} data-testid={`row-survey-object-${object.id || index}`} className="align-top hover:bg-muted/35"><td className="px-5 py-3.5"><div className="text-sm font-semibold">{object.name}</div><div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{object.id || 'unidentified'} · {object.category} · {Math.round(object.confidence * 100)}%</div><p className="mt-2 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{object.evidence}</p></td><td className="px-3 py-3.5 font-mono text-[10px]">x {object.bbox.x.toFixed(3)}<br />y {object.bbox.y.toFixed(3)}<br />w {object.bbox.width.toFixed(3)} · h {object.bbox.height.toFixed(3)}</td><td className="px-3 py-3.5 font-mono text-[10px]">({object.groundContact.x.toFixed(3)}, {object.groundContact.y.toFixed(3)})</td><td className="px-3 py-3.5"><span className="rounded bg-primary/10 px-2 py-1 font-mono text-[9px] uppercase text-primary">{object.depthBand}</span>{object.depthBandId && <div className="mt-2 font-mono text-[9px] text-muted-foreground">source: {object.depthBandId}</div>}</td><td className="px-5 py-3.5 text-[11px] leading-relaxed text-muted-foreground"><div><span className="font-semibold text-foreground">Occludes:</span> {object.occludes.join(', ') || 'none recorded'}</div><div className="mt-1"><span className="font-semibold text-foreground">Behind:</span> {object.occludedBy.join(', ') || 'none recorded'}</div><div className="mt-2">{object.visibleParts.join(', ') || 'Visible parts not enumerated'}</div></td></tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-5 px-5 py-5">
        <div><div className="wf-kicker text-primary">Depth ordering</div><div className="mt-2 space-y-2">{survey.depthBands.map((band) => <div key={band.id} className="rounded-md border border-border bg-muted/30 p-3"><div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] font-semibold">{band.order}. {band.range}</span><span className="font-mono text-[9px] text-muted-foreground">{band.id}</span></div><p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{band.evidence}</p></div>)}</div></div>
        <div><div className="wf-kicker text-primary">Contours retained</div><div className="mt-2 space-y-2 text-[11px] text-muted-foreground">{survey.terrainContours.map((contour, index) => <div key={`${contour.kind}-${index}`}><span className="font-semibold text-foreground">{contour.kind}</span> · {contour.points.length} normalized points<br />{contour.evidence}</div>)}{survey.waterlines.map((line, index) => <div key={`water-${index}`}><span className="font-semibold text-foreground">Waterline {index + 1}</span> · {line.points.length} normalized points<br />{line.evidence}</div>)}{survey.terrainContours.length + survey.waterlines.length === 0 && <span>No contour evidence recorded.</span>}</div></div>
        <div><div className="wf-kicker text-primary">Ambiguities kept open</div><ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">{survey.ambiguities.map((item) => <li key={item} className="flex items-start"><AlertTriangle size={12} className="mr-2 mt-0.5 shrink-0 text-accent-foreground" /><span>{item}</span></li>)}{survey.ambiguities.length === 0 && <li>No unresolved ambiguity recorded.</li>}</ul></div>
      </div>
    </div>
  </div>;
}
function CalibrationEvidencePanel({ knownScale, knownScalePixelDistance, reprojectionErrorPixels, referenceImageCount, verificationStatus, setKnownScale, setKnownScalePixelDistance, setReprojectionErrorPixels, onConfigure }: { knownScale: string; knownScalePixelDistance: string; reprojectionErrorPixels: string; referenceImageCount: number; verificationStatus: 'unverified-claim' | 'solver-verified'; setKnownScale: (value: string) => void; setKnownScalePixelDistance: (value: string) => void; setReprojectionErrorPixels: (value: string) => void; onConfigure: () => void }) {
  const solverVerified = verificationStatus === 'solver-verified';
  const hasScaleEvidence = solverVerified && Number(knownScale) > 0 && Number(knownScalePixelDistance) >= 10;
  const hasGeometryEvidence = solverVerified && referenceImageCount >= 2 && Number(reprojectionErrorPixels) > 0 && Number(reprojectionErrorPixels) <= 1;
  return <div className="wf-panel rounded-xl border border-border bg-card" data-testid="panel-calibration-evidence"><div className="flex flex-col gap-4 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="wf-kicker text-primary">Evidence required for verification</div><h2 className="mt-1 text-[17px] font-semibold">Calibration & photogrammetry proof</h2><p className="mt-1 text-xs text-muted-foreground">These values must come from measured image points or a photogrammetry solve—not from the vision model.</p></div><button type="button" onClick={onConfigure} className="shrink-0 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted">Select scene views</button></div><div className="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Known length (m)<input type="number" min="0" value={knownScale} onChange={(event) => setKnownScale(event.target.value)} data-testid="input-evidence-known-scale" placeholder="e.g. 20" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary" /></label><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matching span (px)<input type="number" min="0" value={knownScalePixelDistance} onChange={(event) => setKnownScalePixelDistance(event.target.value)} data-testid="input-evidence-pixel-span" placeholder="e.g. 148" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary" /></label><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reprojection RMS (px)<input type="number" min="0" step="0.01" value={reprojectionErrorPixels} onChange={(event) => setReprojectionErrorPixels(event.target.value)} data-testid="input-evidence-reprojection" placeholder="≤ 1.00" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary" /></label><div className="rounded-md border border-border bg-muted/40 px-3 py-3"><div className="wf-kicker text-muted-foreground">Evidence state</div><div className="mt-2 space-y-2 text-xs"><div className="flex items-center justify-between"><span>Scale endpoints</span><span className={hasScaleEvidence ? 'text-primary' : 'text-accent-foreground'}>{hasScaleEvidence ? 'ready' : 'missing'}</span></div><div className="flex items-center justify-between"><span>Unique scene views</span><span className={referenceImageCount >= 2 ? 'text-primary' : 'text-accent-foreground'}>{referenceImageCount + 1} / 3</span></div><div className="flex items-center justify-between"><span>Geometric residual</span><span className={hasGeometryEvidence ? 'text-primary' : 'text-accent-foreground'}>{hasGeometryEvidence ? 'validated' : 'missing'}</span></div></div></div></div></div>;
}

function GeometryVerificationPanel({ analysis }: { analysis: AnalysisResult }) {
  const geometry = analysis.geometryVerification;
  if (!geometry) return null;
  return <div className="wf-panel rounded-xl border border-border bg-card" data-testid="panel-geometry-verification"><div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="wf-kicker text-primary">Server-computed geometry</div><h2 className="mt-1 text-[17px] font-semibold">Alternate-view registration</h2></div><span className={`rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[.1em] ${geometry.status === 'views-registered' || geometry.status === 'solver-verified' ? 'bg-primary/10 text-primary' : 'bg-accent/15 text-accent-foreground'}`}>{geometry.status.replaceAll('-', ' ')}</span></div><div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-5"><div className="px-4 py-4"><div className="wf-kicker text-muted-foreground">Solver</div><div className="mt-2 font-mono text-xs">{geometry.solver}</div></div><div className="px-4 py-4"><div className="wf-kicker text-muted-foreground">Verified views</div><div className="mt-2 font-mono text-sm font-semibold">{geometry.verifiedAlternateViewCount} / {geometry.requestedAlternateViewCount}</div></div><div className="px-4 py-4"><div className="wf-kicker text-muted-foreground">Registration RMS</div><div className="mt-2 font-mono text-sm font-semibold">{geometry.aggregateReprojectionRmsPixels === null ? '—' : `${geometry.aggregateReprojectionRmsPixels.toFixed(3)} px`}</div></div><div className="px-4 py-4"><div className="wf-kicker text-muted-foreground">Camera pose</div><div className="mt-2 font-mono text-sm font-semibold">{(analysis.cameraGeometryVerification?.status === 'verified' || geometry.cameraPoseVerified) ? 'verified' : (analysis.cameraGeometryVerification?.status ?? 'not solved')}</div></div><div className="px-4 py-4"><div className="wf-kicker text-muted-foreground">Canonical hash</div><div className="mt-2 font-mono text-xs">{geometry.canonicalImageSha256.slice(0, 12)}…</div></div></div>{geometry.registrations.length > 0 && <div className="divide-y divide-border border-t border-border">{geometry.registrations.map((registration, index) => <div key={registration.imageSha256} className="grid gap-2 px-5 py-3 text-xs md:grid-cols-[80px_1fr_auto] md:items-center"><span className={`font-mono uppercase ${registration.status === 'registered' ? 'text-primary' : 'text-accent-foreground'}`}>View {index + 2}</span><span className="text-muted-foreground">{registration.reason}</span><span className="font-mono">{registration.inlierCount}/{registration.candidateMatchCount} inliers · {registration.reprojectionRmsPixels === null ? '—' : `${registration.reprojectionRmsPixels.toFixed(3)} px`}</span></div>)}</div>}<div className="border-t border-border bg-muted/30 px-5 py-4"><ul className="grid gap-2 text-xs leading-relaxed text-muted-foreground lg:grid-cols-3">{geometry.notes.map((note) => <li key={note} className="flex items-start"><ChevronRight size={14} className="mr-1.5 shrink-0 text-primary/50" /><span>{note}</span></li>)}</ul></div></div>;
}

function ProductionHandoffPanel({ analysis, onSave, saving }: { analysis: AnalysisResult; onSave: () => void; saving: boolean }) {
  const geometry = analysis.geometryVerification;
  const readiness = clientExportReadiness(analysis);
  const poseVerified = readiness.poseVerified || Boolean(geometry?.cameraPoseVerified);
  const verifiedAlternateViews = geometry?.verifiedAlternateViewCount ?? 0;
  const requestedAlternateViews = geometry?.requestedAlternateViewCount ?? 0;
  const totalVerifiedViews = verifiedAlternateViews + 1;
  const productionCount = analysis.assetTree.reduce((sum, asset) => sum + asset.productionCount, 0);
  const placementCount = analysis.assetTree.reduce((sum, asset) => sum + asset.placementCount, 0);
  const nextStep = readiness.exportReadyCm
    ? 'Scale-locked. Export Unreal cm and begin blockout.'
    : poseVerified && !readiness.metricScaleKnown
      ? 'Pin a scale object: enter a known real-world length (m) and its matching pixel span (≥10px), then re-run analysis.'
      : totalVerifiedViews >= 3 && !poseVerified
        ? 'Views registered, but camera pose is still unsolved. Keep overlapping alternate angles and ensure COLMAP/geometry endpoints are configured.'
        : 'Add an overlapping alternate view (left/right three-quarter of the same world), then re-run analysis. Registration strengthens verification before Unreal cm unlocks.';
  const viewStatus = geometry
    ? `${totalVerifiedViews} verified / ${requestedAlternateViews + 1} submitted`
    : '1 canonical view';
  const evidenceStatus = analysis.confidenceBreakdown?.status?.replaceAll('-', ' ') ?? 'current analysis';
  const cameraDetail = analysis.cameraGeometryVerification
    ? `${analysis.cameraGeometryVerification.status} · ${analysis.cameraGeometryVerification.solver}`
    : 'metric pose gate';
  return <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card" data-testid="panel-production-handoff">
    <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ArrowDownToLine size={17} /></div>
        <div><div className="wf-kicker text-primary">Multi-angle approval loop · tier {readiness.tier}</div><h2 className="mt-1 text-[17px] font-semibold">Production handoff</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">Hypothesis first. Unreal cm export unlocks only after overlapping multi-view pose verification and metric scale lock.</p></div>
      </div>
      <button onClick={onSave} disabled={saving} data-testid="button-save-workspace" className="flex shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"><Save size={14} /> {saving ? 'Saving…' : 'Save workspace'}</button>
    </div>
    <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
      <HandoffMetric label="Scene views" value={viewStatus} detail={geometry?.status?.replaceAll('-', ' ') ?? 'single-view hypothesis'} />
      <HandoffMetric label="Current confidence" value={`${Math.round(analysis.confidence * 100)}%`} detail={evidenceStatus} />
      <HandoffMetric label="Unreal production" value={`${productionCount} unique meshes`} detail={`${placementCount} planned placements`} />
      <HandoffMetric label="Camera pose" value={poseVerified ? 'Verified' : 'Not solved'} detail={cameraDetail} />
    </div>
    <div className="flex items-start gap-3 border-t border-border bg-muted/30 px-5 py-4">
      <Gauge size={16} className="mt-0.5 shrink-0 text-primary" />
      <div><div className="text-xs font-semibold">Recommended next action</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground" data-testid="text-handoff-next-action">{nextStep}</p>{!readiness.exportReadyCm && <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-accent-foreground">Blocked checks · {readiness.failingChecks.join(' · ') || 'none'}</p>}</div>
    </div>
  </div>;
}

function HandoffMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="bg-card px-4 py-4"><div className="wf-kicker text-muted-foreground">{label}</div><div className="mt-2 font-mono text-sm font-semibold">{value}</div><div className="mt-1 text-[10px] text-muted-foreground">{detail}</div></div>;
}

function ConfidenceBanner({ analysis, updatedAt }: { analysis: AnalysisResult; updatedAt?: string }) {
  const breakdown = analysis.confidenceBreakdown;
  const overall = analysis.confidence;
  const submittedViews = 1 + (analysis.calibrationEvidence?.alternateImageSha256s.length ?? 0);
  const verifiedViews = 1 + (analysis.geometryVerification?.verifiedAlternateViewCount ?? 0);
  const requestedViews = 1 + (analysis.geometryVerification?.requestedAlternateViewCount ?? submittedViews - 1);
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Current session';
  return <div className="mb-6 overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md" data-testid="panel-confidence-breakdown">
    <div className="flex flex-col xl:flex-row xl:items-stretch">
      <div className="flex flex-1 flex-col justify-center border-b border-border bg-gradient-to-br from-primary/5 to-transparent p-6 xl:border-b-0 xl:border-r">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-primary" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-primary">Latest analysis confidence</span>
        </div>
        <div className="mt-4 flex items-baseline gap-3">
          <span className="text-5xl font-extrabold tracking-tight text-foreground">{Math.round(overall * 100)}%</span>
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Overall Confidence</span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider ${breakdown?.status === 'target-met' ? 'bg-emerald-500/15 text-emerald-700' : breakdown?.status === 'needs-calibration' ? 'bg-amber-500/15 text-amber-700' : 'bg-primary/15 text-primary'}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
            {breakdown?.status ? breakdown.status.replace(/-/g, ' ') : 'Evidence Gathered'}
          </span>
          <span className="text-xs font-medium text-muted-foreground">Live result · updated {updatedLabel}</span>
        </div>
        <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground" data-testid="text-confidence-evidence-rule">Evidence-driven score from this analysis: {requestedViews} unique submitted view{requestedViews === 1 ? '' : 's'}, {submittedViews} admitted to analysis and {verifiedViews} contributing after registration. Unregistered files do not increase confidence.</p>
      </div>
      <div className="grid flex-[2] grid-cols-2 gap-px bg-border sm:grid-cols-5">
        <BreakdownMetric label="Visual Detect" value={breakdown?.visualDetection} fallback={overall} />
        <BreakdownMetric label="Scale Calib" value={breakdown?.scaleCalibration} fallback={overall} />
        <BreakdownMetric label="Depth Infer" value={breakdown?.depthInference} fallback={overall} />
        <BreakdownMetric label="Evidence Cover" value={breakdown?.coverageCompleteness} fallback={overall} />
        <BreakdownMetric label="Spatial Cons" value={breakdown?.spatialConsistency} fallback={overall} />
      </div>
    </div>
  </div>;
}

function MultiViewGuidePanel() {
  const [copied, setCopied] = useState(false);
  async function copyPrompt() {
    await navigator.clipboard?.writeText(MULTI_VIEW_PROMPT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <section className="mb-6 overflow-hidden rounded-xl border border-primary/20 bg-primary/5" data-testid="panel-multi-view-guide">
    <div className="flex flex-col gap-4 border-b border-primary/15 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2"><Images size={16} className="text-primary" /><span className="wf-kicker text-primary">Before you generate or upload</span></div>
        <h2 className="mt-2 text-lg font-semibold">Use the same world from three camera angles</h2>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">One image works for a production hypothesis. These three consistent views give the registration and depth stages more evidence without changing the scene between images.</p>
      </div>
      <button type="button" onClick={copyPrompt} data-testid="button-copy-view-prompt-main" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-primary/25 bg-card px-3 py-2.5 text-xs font-bold text-primary hover:bg-primary/10"><Copy size={13} />{copied ? 'Copied' : 'Copy example prompt'}</button>
    </div>
    <div className="grid gap-px bg-primary/15 md:grid-cols-3">
      {VIEW_GUIDE.map((view) => <div key={view.number} className="bg-card/80 px-5 py-4"><div className="font-mono text-[10px] font-bold tracking-[.16em] text-primary">{view.number} / {view.label}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{view.detail}</p></div>)}
    </div>
    <div className="border-t border-primary/15 bg-card/60 px-5 py-4">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[.12em] text-primary">Example prompt · paste into Gemini or your image generator</div>
      <p data-testid="text-multi-view-prompt-main" className="mt-2 max-w-6xl font-mono text-[11px] leading-relaxed text-foreground/75">{MULTI_VIEW_PROMPT}</p>
    </div>
  </section>;
}

function WorkflowGuidePanel({ onConfigure, onExport }: { onConfigure: () => void; onExport: () => void }) {
  const steps = [
    { number: '01', title: 'Create the view set', detail: 'Copy the example prompt above and generate the same world as a wide master, left three-quarter and right three-quarter view.' },
    { number: '02', title: 'Open Configure', detail: 'Upload the wide image as the canonical concept. Add the left and right images under Alternate scene views.' },
    { number: '03', title: 'Set the world envelope', detail: 'Enter map width, map depth and grid size in meters. Add a measured reference only when you know its real-world size.' },
    { number: '04', title: 'Run calibrated analysis', detail: 'World Forge inventories the scene, checks view registration, estimates relative depth and creates the editable asset and placement plan.' },
    { number: '05', title: 'Review before production', detail: 'Check confidence, warnings, registration, uncertainty and camera-pose status. Low-confidence values are hypotheses, not survey measurements.' },
    { number: '06', title: 'Hand off to Unreal', detail: 'Only after multi-view pose + metric scale-lock: export Unreal cm (WorldToMeters=100). Until then use Draft (arbitrary units, pose unsolved).' },
  ];
  return <section className="mb-6 rounded-xl border border-border bg-card" data-testid="panel-workflow-guide">
    <div className="flex flex-col gap-4 border-b border-border px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <div className="wf-kicker text-primary">Start here / complete workflow</div>
        <h2 className="mt-2 text-lg font-semibold">What to do, in the correct order</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Follow these six steps from concept generation to the editable Unreal production package.</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onConfigure} data-testid="button-guide-configure" className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2.5 text-xs font-bold hover:border-primary/40"><Pencil size={13} />Configure images</button>
        <button type="button" onClick={onExport} data-testid="button-guide-export" className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2.5 text-xs font-bold text-background"><Download size={13} />Export when ready</button>
      </div>
    </div>
    <ol className="grid gap-px overflow-hidden rounded-b-xl bg-border md:grid-cols-2 xl:grid-cols-3">
      {steps.map((step) => <li key={step.number} className="bg-card px-5 py-4"><div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 font-mono text-[10px] font-bold text-primary">{step.number}</span><div><h3 className="text-sm font-semibold">{step.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p></div></div></li>)}
    </ol>
  </section>;
}

function BlueprintPanel({ analysis, activeLandmarkId, setActiveLandmark }: { analysis: AnalysisResult; activeLandmarkId?: string; setActiveLandmark: (id: string) => void }) {
  const map = analysis.map;
  const width = map.widthMeters;
  const depth = map.depthMeters;
  const gridPctX = (map.gridSizeMeters / width) * 100;
  const gridPctY = (map.gridSizeMeters / depth) * 100;

  return (
    <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card flex flex-col" data-testid="panel-blueprint">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border bg-card px-5 py-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
            <Route size={16} />
          </div>
          <div>
            <div className="text-[17px] font-semibold text-foreground">World Blueprint</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Orthographic plan view</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-px w-3 bg-accent/60" /> World relation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary/40 border border-primary/50" /> Asset
          </span>
          <span className="flex items-center gap-1.5">
            <span className="grid h-3 w-3 place-items-center rounded-sm border border-primary/50 bg-[#0A0D14]/90 text-primary">
               <Target size={8} />
            </span> Landmark
          </span>
        </div>
      </div>

      <div className="relative w-full bg-[#0A0D14] overflow-hidden group" style={{ aspectRatio: `${width} / ${depth}` }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
             backgroundImage: 'linear-gradient(hsl(var(--primary)/0.15) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)/0.15) 1px, transparent 1px)',
             backgroundSize: `${gridPctX}% ${gridPctY}%`,
             backgroundPosition: '50% 50%'
          }}
        />

        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/40 -translate-x-1/2 pointer-events-none" />
        <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/40 -translate-y-1/2 pointer-events-none" />

        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${width} ${depth}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {(analysis.spatialRelations ?? []).map((relation) => {
            const from = analysis.landmarks.find((landmark) => landmark.id === relation.fromId);
            const to = analysis.landmarks.find((landmark) => landmark.id === relation.toId);
            if (!from || !to) return null;
            return <line key={relation.id} x1={from.x + width / 2} y1={from.y + depth / 2} x2={to.x + width / 2} y2={to.y + depth / 2} stroke="hsl(var(--accent)/0.28)" strokeWidth={Math.max(width, depth) / 3200} strokeDasharray={`${Math.max(width, depth) / 900} ${Math.max(width, depth) / 1400}`} />;
          })}
        </svg>

        {analysis.assetTree.flatMap(asset => asset.placements.map((placement, i) => (
           <div
             key={`asset-${asset.id}-${placement.id || i}`}
             className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto cursor-help"
             style={{
               left: `${Math.max(0, Math.min(100, 50 + (placement.x / width) * 100))}%`,
               top: `${Math.max(0, Math.min(100, 50 + (placement.y / depth) * 100))}%`,
             }}
             title={`${asset.name}\nX: ${placement.x.toFixed(1)}m Y: ${placement.y.toFixed(1)}m\n${placement.reason}`}
           >
              <div
                className="w-1.5 h-1.5 border border-primary/50 bg-primary/20 rounded-sm transition-colors hover:bg-primary/60 hover:border-primary shadow-[0_0_4px_hsl(var(--primary)/0.2)]"
                style={{ transform: `rotate(${placement.rotation}deg) scale(${placement.scale})` }}
              />
           </div>
        )))}

        {analysis.landmarks.map(landmark => (
           <button
             type="button"
             key={landmark.id}
             onClick={() => setActiveLandmark(landmark.id)}
             aria-label={`Select ${landmark.name} at X ${landmark.x} meters, Y ${landmark.y} meters, Z ${landmark.z} meters`}
             className={`absolute group -translate-x-1/2 -translate-y-1/2 rounded-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-[#0A0D14] ${activeLandmarkId === landmark.id ? 'z-20 scale-125' : 'z-10 hover:scale-110'}`}
             style={{
               left: `${Math.max(0, Math.min(100, 50 + (landmark.x / width) * 100))}%`,
               top: `${Math.max(0, Math.min(100, 50 + (landmark.y / depth) * 100))}%`,
             }}
           >
             <span className={`grid h-6 w-6 place-items-center rounded-sm border shadow-[0_0_8px_hsl(var(--primary)/0.2)] transition-colors ${activeLandmarkId === landmark.id ? 'border-primary bg-primary text-primary-foreground' : 'border-primary/60 bg-[#0A0D14]/90 text-primary backdrop-blur-sm hover:border-primary'}`}>
               <Target size={12} fill={activeLandmarkId === landmark.id ? "currentColor" : "none"} strokeWidth={activeLandmarkId === landmark.id ? 2 : 2.5} />
             </span>
             <span className={`absolute left-1/2 top-7 -translate-x-1/2 whitespace-nowrap rounded px-1.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider backdrop-blur-md transition-colors ${activeLandmarkId === landmark.id ? 'bg-primary text-primary-foreground' : 'bg-[#0A0D14]/90 text-white/90 border border-white/10 opacity-0 group-hover:opacity-100 pointer-events-none'}`}>
               {landmark.name}
               <span className="block mt-0.5 text-[8px] font-medium opacity-80">
                 XYZ: {landmark.x.toFixed(0)}, {landmark.y.toFixed(0)}, {landmark.z.toFixed(0)}
               </span>
             </span>
           </button>
        ))}

        <div className="absolute bottom-4 left-4 flex flex-col gap-2 pointer-events-none">
           <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#0A0D14]/80 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-white/80 backdrop-blur-sm">
             <Ruler size={13} className="text-primary" />
             <span>{width}m × {depth}m Env</span>
           </div>
           <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#0A0D14]/80 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-white/80 backdrop-blur-sm">
             <Grid3X3 size={13} className="text-primary" />
             <span>{map.gridSizeMeters}m Grid</span>
           </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownMetric({ label, value, fallback }: { label: string; value?: number; fallback: number }) {
  const displayValue = value ?? fallback;
  return <div className="flex flex-col justify-center bg-card p-5">
    <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-2 flex items-end gap-1">
      <span className="text-2xl font-bold text-foreground">{Math.round(displayValue * 100)}</span>
      <span className="mb-0.5 font-mono text-sm font-medium text-muted-foreground">%</span>
    </div>
    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all duration-1000 ease-out" style={{ width: `${Math.round(displayValue * 100)}%` }} />
    </div>
  </div>;
}

function SpatialRelationsPanel({ analysis, activeLandmarkId }: { analysis: AnalysisResult; activeLandmarkId?: string }) {
  const relations = useMemo(() => {
    const all = analysis.spatialRelations ?? [];
    if (!activeLandmarkId) return all;
    return [...all].sort((a, b) => Number(b.fromId === activeLandmarkId || b.toId === activeLandmarkId) - Number(a.fromId === activeLandmarkId || a.toId === activeLandmarkId));
  }, [analysis.spatialRelations, activeLandmarkId]);
  return <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card" data-testid="panel-spatial-relations"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="wf-kicker text-primary">Deterministic geometry</div><h2 className="mt-1 text-[17px] font-semibold">XYZ distance matrix</h2></div><div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><Route size={14} />{relations.length} pair relations</div></div><div className="wf-scroll max-h-[430px] overflow-auto"><table className="w-full min-w-[880px] text-left"><thead className="sticky top-0 z-10 bg-muted font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground"><tr><th className="px-5 py-3 font-normal">From → to</th><th className="px-3 py-3 font-normal">ΔX</th><th className="px-3 py-3 font-normal">ΔY</th><th className="px-3 py-3 font-normal">ΔZ</th><th className="px-3 py-3 font-normal">Horizontal</th><th className="px-3 py-3 font-normal">3D distance</th><th className="px-3 py-3 font-normal">Bearing / vertical</th><th className="px-5 py-3 font-normal">Error ±</th></tr></thead><tbody className="divide-y divide-border">{relations.map(relation => { const isActive = relation.fromId === activeLandmarkId || relation.toId === activeLandmarkId; return <tr key={relation.id} className={isActive ? 'bg-primary/5' : ''}><td className="px-5 py-3"><div className="text-xs font-semibold">{relation.fromName}</div><div className="mt-1 text-[10px] text-muted-foreground">→ {relation.toName}</div></td><td className="px-3 py-3 font-mono text-[10px]">{relation.deltaX.toLocaleString()}m</td><td className="px-3 py-3 font-mono text-[10px]">{relation.deltaY.toLocaleString()}m</td><td className="px-3 py-3 font-mono text-[10px]">{relation.deltaZ.toLocaleString()}m</td><td className="px-3 py-3 font-mono text-[10px]">{relation.horizontalDistanceMeters.toLocaleString()}m</td><td className="px-3 py-3 font-mono text-xs font-semibold">{relation.distance3dMeters.toLocaleString()}m</td><td className="px-3 py-3 font-mono text-[10px]">{relation.bearingDegrees}° / {relation.verticalAngleDegrees}°</td><td className="px-5 py-3"><div className="font-mono text-[10px]">±{relation.uncertaintyMeters.toLocaleString()}m</div><div className="mt-1 text-[9px] text-muted-foreground">{Math.round(relation.confidence * 100)}% pair confidence</div></td></tr>})}</tbody></table></div></div>;
}

function formatPlacementPattern(asset: AnalysisResult['assetTree'][number]) {
  const pattern = asset.placementPattern;
  if (!pattern) return null;
  const span = Math.abs(pattern.endAngleDegrees - pattern.startAngleDegrees);
  return `${pattern.type} · ${pattern.radiusX} × ${pattern.radiusY}m radii · ${span}° · ${pattern.alignToTangent ? 'tangent aligned' : 'fixed heading'}`;
}

function AssetTable({ analysis }: { analysis: AnalysisResult }) {
  const production = analysis.assetTree.reduce((sum, asset) => sum + asset.productionCount, 0);
  const placements = analysis.assetTree.reduce((sum, asset) => sum + asset.placementCount, 0);
  return <div className="wf-panel overflow-hidden rounded-xl border border-border bg-card"><div className="flex flex-col justify-between gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center"><div><div className="wf-kicker text-primary">Exhaustive scene inventory</div><h2 className="mt-1 text-[17px] font-semibold">Detected assets & placement plan</h2></div><div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground"><Layers3 size={14} />{analysis.assetTree.length} families · {production} unique builds · {placements} placements</div></div><div className="wf-scroll overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead className="bg-muted/55 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground"><tr><th className="px-5 py-3 font-normal">Asset / visual evidence</th><th className="px-3 py-3 font-normal">Category</th><th className="px-3 py-3 font-normal">Rodin builds</th><th className="px-3 py-3 font-normal">World placements</th><th className="px-3 py-3 font-normal">Dimensions</th><th className="px-5 py-3 font-normal">Placement plan</th></tr></thead><tbody className="divide-y divide-border">{analysis.assetTree.map((asset) => { const patternLabel = formatPlacementPattern(asset); return <tr key={asset.id} data-testid={`row-asset-${asset.id}`} className="group align-top hover:bg-muted/35"><td className="px-5 py-3.5"><div className="text-sm font-semibold">{asset.name}</div><div className="mt-1 font-mono text-[10px] text-muted-foreground">{asset.parent}</div><p className="mt-2 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{asset.readEvidence}</p></td><td className="px-3 py-3.5"><div className="text-xs text-muted-foreground">{asset.category}</div><div className="mt-1 font-mono text-[9px] text-muted-foreground">{asset.kind}</div></td><td className="px-3 py-3.5"><div className="font-mono text-sm">{asset.productionCount}</div><div className="mt-1 text-[10px] text-muted-foreground">unique mesh</div></td><td className="px-3 py-3.5"><div className="font-mono text-sm">{asset.placementCount}</div><div className="mt-1 text-[10px] text-muted-foreground">{asset.isReusable ? 'instanced' : 'hero unique'}</div></td><td className="px-3 py-3.5 font-mono text-[10px] text-muted-foreground"><div>{asset.dimensions}</div>{asset.dimensionsMeters && <div className="mt-1 text-primary">exact {asset.dimensionsMeters.x} × {asset.dimensionsMeters.y} × {asset.dimensionsMeters.z}m</div>}</td><td className="max-w-sm px-5 py-3.5 text-xs leading-relaxed text-muted-foreground"><div>{asset.placementInstructions}</div>{patternLabel && <div className="mt-2 rounded bg-primary/10 px-2 py-1.5 font-mono text-[9px] text-primary" data-testid={`pattern-asset-${asset.id}`}>{patternLabel}</div>}<div className="mt-2 font-mono text-[9px] text-primary">{asset.placements.length} transform anchors listed</div></td></tr>})}</tbody></table></div></div>;
}

function SetupDialog({ analysis, width, depth, grid, knownScale, imageSrc, referenceImageCount, onImageFile, onReferenceFiles, setWidth, setDepth, setGrid, setKnownScale, onClose, onSubmit, loading, error }: { analysis: AnalysisResult; width: number; depth: number; grid: number; knownScale: string; imageSrc: string; referenceImageCount: number; onImageFile: (file?: File) => void; onReferenceFiles: (files?: FileList | null) => void; setWidth: (value: number) => void; setDepth: (value: number) => void; setGrid: (value: number) => void; setKnownScale: (value: string) => void; onClose: () => void; onSubmit: (event: React.FormEvent) => void; loading: boolean; error: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copyViewPrompt() {
    await navigator.clipboard?.writeText(MULTI_VIEW_PROMPT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <div className="fixed inset-0 z-30 grid place-items-center overflow-y-auto bg-[hsl(198_38%_17%/.45)] p-5 backdrop-blur-sm"><form onSubmit={onSubmit} className="wf-panel relative my-5 w-full max-w-2xl rounded-xl border border-border bg-card p-6" data-testid="form-analysis-settings"><button type="button" onClick={onClose} data-testid="button-close-analysis" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"><X size={18} /></button><div className="wf-kicker text-primary">Analysis controls / multi-view capture</div><h2 className="mt-2 font-serif text-3xl">Calibrate the world.</h2><p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">One image is enough for a production hypothesis. For stronger depth and overlap evidence, upload the same scene from three consistent camera angles.</p><div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-sm font-bold"><Images size={16} className="text-primary" />Recommended concept set</div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Generate one world three times with the same seed/style. The canonical image plus two alternates gives the system three views; more alternates can be added for registration checks.</p></div><button type="button" onClick={copyViewPrompt} data-testid="button-copy-view-prompt" className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary/25 bg-card px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10"><Copy size={13} />{copied ? 'Copied' : 'Copy prompt'}</button></div><div className="mt-4 grid gap-2 md:grid-cols-3">{VIEW_GUIDE.map((view) => <div key={view.number} className="rounded-lg border border-border/80 bg-card/70 p-3"><div className="font-mono text-[10px] font-bold tracking-[.16em] text-primary">{view.number} / {view.label}</div><p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{view.detail}</p></div>)}</div><div className="mt-3 rounded-lg border border-border/80 bg-background/60 p-3"><div className="font-mono text-[10px] font-bold uppercase tracking-[.12em] text-primary">Generator instruction · use before creating images</div><p data-testid="text-multi-view-prompt" className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">{MULTI_VIEW_PROMPT}</p></div></div><div className="mt-6 grid grid-cols-2 gap-4"><Field label="Width (m)" value={width} setValue={setWidth} testId="input-map-width" /><Field label="Depth (m)" value={depth} setValue={setDepth} testId="input-map-depth" /><Field label="Grid (m)" value={grid} setValue={setGrid} testId="input-grid-size" /><label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verified reference (m)<input type="number" min="0" value={knownScale} onChange={(event) => setKnownScale(event.target.value)} data-testid="input-known-scale" placeholder="Optional until surveyed" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary" /></label></div><label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Canonical concept image · View 01<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onImageFile(event.target.files?.[0])} data-testid="input-concept-image" className="mt-2 block w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2.5 text-xs file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs" /></label><div className="mt-3 flex items-center gap-3 rounded-md bg-muted/60 p-2.5"><img src={imageSrc} alt="" className="h-10 w-16 rounded object-cover" /><span className="truncate text-xs text-muted-foreground">Primary composition and object inventory.</span></div><label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Alternate scene views · View 02–09<input type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(event) => onReferenceFiles(event.target.files)} data-testid="input-reference-images" className="mt-2 block w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2.5 text-xs file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:text-xs" /></label><div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Images size={14} className="text-primary" />{referenceImageCount} alternate view(s) selected · {referenceImageCount === 0 ? 'single-view mode' : `total ${referenceImageCount + 1} view${referenceImageCount === 0 ? '' : 's'} ready`}</span>{referenceImageCount > 0 && <button type="button" onClick={() => onReferenceFiles(null)} className="font-semibold text-primary hover:underline">Clear alternates</button>}</div><div className="mt-4 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground"><Info size={14} className="shrink-0 text-primary" />Upload 0, 2 or more alternates. The server only counts views that pass same-scene registration; visually unrelated images are rejected.</div>{error && <p className="mt-3 text-xs text-destructive" data-testid="error-analysis">Analysis could not complete. The previous specification remains available.</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} data-testid="button-cancel-analysis" className="rounded-md px-4 py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancel</button><button disabled={loading} data-testid="button-run-analysis" className="flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">{loading ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />} {loading ? 'Analyzing…' : 'Run calibrated analysis'}</button></div></form></div>;
}
function Field({ label, value, setValue, testId }: { label: string; value: number; setValue: (value: number) => void; testId: string }) { return <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}<input type="number" min="10" value={value} onChange={(event) => setValue(Number(event.target.value))} data-testid={testId} className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2.5 font-mono text-sm outline-none focus:border-primary" /></label>; }

function downloadTextFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function ExportDialog({ exportData, onClose }: { exportData?: { filename: string; generatedAt: string; unrealScript: string; manifest: string; exportMetadata?: { units?: string; pose?: string; exportTier?: string; centimeterClaimsEnabled?: boolean; WorldToMeters?: number } }; onClose: () => void }) {
  const [tab, setTab] = useState<'script' | 'manifest'>('script');
  const [copied, setCopied] = useState(false);
  if (!exportData) return null;
  const scriptFilename = exportData.filename.replace(/\.json$/i, '.py');
  const visibleContent = tab === 'script' ? exportData.unrealScript : exportData.manifest;
  async function copyVisibleContent() {
    await navigator.clipboard?.writeText(visibleContent);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return <div className="fixed inset-0 z-30 grid place-items-center bg-[hsl(198_38%_17%/.45)] p-5 backdrop-blur-sm"><div className="wf-panel relative w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-card" data-testid="dialog-export-bundle"><button onClick={onClose} data-testid="button-close-export" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"><X size={18} /></button><div className="border-b border-border px-6 py-5"><div className="wf-kicker text-primary">Export bundle / {exportData.exportMetadata?.centimeterClaimsEnabled === false ? `draft · ${exportData.exportMetadata?.units ?? "arbitrary"} · pose ${exportData.exportMetadata?.pose ?? "unsolved"}` : `Unreal cm · WorldToMeters=${exportData.exportMetadata?.WorldToMeters ?? 100}`}</div><h2 className="mt-2 font-serif text-3xl">Editable Unreal handoff</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{exportData.exportMetadata?.centimeterClaimsEnabled === false ? "Draft hypothesis only — units are arbitrary and camera pose is unsolved. Do not treat coordinates as survey centimeters." : "Download the Python importer and its evidence manifest. Run the `.py` file in Unreal Editor; meters convert to centimeters at the import boundary (×100)."}</p><p className="mt-3 font-mono text-[10px] uppercase tracking-[.08em] text-muted-foreground">Generated {new Date(exportData.generatedAt).toLocaleString()}</p></div><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 pt-4"><div className="flex gap-1"><button onClick={() => setTab('script')} data-testid="button-export-script-tab" className={`border-b-2 px-2 pb-3 text-xs font-semibold ${tab === 'script' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}><FileCode2 size={14} className="mr-1.5 inline" />Unreal script</button><button onClick={() => setTab('manifest')} data-testid="button-export-manifest-tab" className={`border-b-2 px-2 pb-3 text-xs font-semibold ${tab === 'manifest' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>Evidence manifest</button></div><button onClick={copyVisibleContent} data-testid="button-copy-export" className="mb-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"><Copy size={13} />{copied ? 'Copied' : 'Copy visible'}</button></div><pre data-testid="text-export-content" className="wf-scroll max-h-[43vh] overflow-auto whitespace-pre-wrap bg-[hsl(198_38%_17%)] p-6 font-mono text-xs leading-relaxed text-[hsl(41_34%_91%)]">{visibleContent}</pre><div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center"><div className="mr-auto text-[11px] leading-relaxed text-muted-foreground">UE 5.x · World Forge meters → Unreal centimeters at import boundary</div><button onClick={() => downloadTextFile(exportData.filename, exportData.manifest, 'application/json')} data-testid="button-download-manifest" className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted"><ArrowDownToLine size={15} />Manifest .json</button><button onClick={() => downloadTextFile(scriptFilename, exportData.unrealScript, 'text/x-python')} data-testid="button-download-unreal-script" className="inline-flex items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:-translate-y-0.5"><Download size={15} />Unreal importer .py</button></div></div></div>;
}

function WorkspaceLoading() { return <div className="p-5 sm:p-8 lg:p-10"><div className="h-10 w-64 animate-pulse rounded bg-muted" /><div className="mt-3 h-4 w-80 animate-pulse rounded bg-muted" /><div className="mt-10 grid gap-5 xl:grid-cols-[1.45fr,.8fr]"><div className="aspect-video animate-pulse rounded-xl bg-muted" /><div className="h-80 animate-pulse rounded-xl bg-muted" /></div></div>; }
