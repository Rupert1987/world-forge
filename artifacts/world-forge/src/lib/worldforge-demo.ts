import type { AnalysisResult, Project, ProjectSummary } from '@workspace/api-client-react';
import conceptImageUrl from '../assets/ana-kara.jpg';

export const conceptImagePath = conceptImageUrl;

export const demoAnalysis: AnalysisResult = {
  confidence: 0.87,
  visualSurvey: {
    version: 1,
    cameraHypothesis: {
      horizonY: 0.27,
      perspectiveStrength: 'strong',
      viewElevation: 'elevated',
      vanishingDirections: [
        { x: 0.5, y: 0.37, evidence: 'Citadel walls, harbor piers and arena terraces converge toward the central horizon.' },
      ],
    },
    depthBands: [
      { id: 'foreground', order: 0, range: 'foreground', evidence: 'Boats, harbor structures and the arena occupy the lower image.' },
      { id: 'midground', order: 1, range: 'midground', evidence: 'The citadel, cemetery and volcanic ridge retain strong local contrast.' },
      { id: 'distant', order: 2, range: 'distant', evidence: 'The monolith and snowy horizon are reduced by atmospheric perspective.' },
    ],
    objects: [
      { id: 'survey-citadel', name: 'Stepped Citadel', category: 'fortified settlement', bbox: { x: 0.25, y: 0.31, width: 0.47, height: 0.43 }, depthBand: 'midground', groundContact: { x: 0.5, y: 0.69 }, occludes: ['survey-monolith'], occludedBy: [], visibleParts: ['stepped temple', 'city walls', 'gate towers'], repeatedPattern: 'dense modular city blocks', evidence: 'The dominant fortified city and stepped temple occupy the center of the composition.', confidence: 0.96 },
      { id: 'survey-caldera', name: 'Ash Caldera', category: 'volcanic terrain', bbox: { x: 0.68, y: 0.2, width: 0.29, height: 0.28 }, depthBand: 'midground', groundContact: { x: 0.79, y: 0.45 }, occludes: [], occludedBy: [], visibleParts: ['volcanic cone', 'smoke plume', 'lava channels'], repeatedPattern: 'branching lava seams', evidence: 'A smoking volcanic cone and luminous lava channels are visible on the eastern ridge.', confidence: 0.93 },
      { id: 'survey-arena', name: 'Tide Arena', category: 'monument', bbox: { x: 0.63, y: 0.63, width: 0.31, height: 0.28 }, depthBand: 'foreground', groundContact: { x: 0.78, y: 0.86 }, occludes: [], occludedBy: [], visibleParts: ['seating bowl', 'outer wall', 'perimeter lights'], repeatedPattern: 'concentric seating terraces', evidence: 'The circular illuminated arena dominates the lower-right foreground.', confidence: 0.95 },
      { id: 'survey-monolith', name: 'Moon Monolith', category: 'distant monument', bbox: { x: 0.44, y: 0.04, width: 0.13, height: 0.23 }, depthBand: 'distant', groundContact: { x: 0.5, y: 0.25 }, occludes: [], occludedBy: ['survey-citadel'], visibleParts: ['seated silhouette', 'moon halo'], repeatedPattern: '', evidence: 'A monumental seated silhouette is centered against the moon on the horizon.', confidence: 0.84 },
      { id: 'survey-harbor', name: 'Western Harbor & Piers', category: 'waterfront', bbox: { x: 0.04, y: 0.61, width: 0.48, height: 0.36 }, depthBand: 'foreground', groundContact: { x: 0.3, y: 0.88 }, occludes: [], occludedBy: [], visibleParts: ['stone quay', 'timber piers', 'boats'], repeatedPattern: 'parallel mooring fingers', evidence: 'Multiple piers and vessels occupy the lower-left harbor basin.', confidence: 0.94 },
      { id: 'survey-cemetery', name: 'Eastern Cemetery & Kümbet', category: 'memorial ground', bbox: { x: 0.72, y: 0.47, width: 0.27, height: 0.22 }, depthBand: 'midground', groundContact: { x: 0.89, y: 0.65 }, occludes: [], occludedBy: [], visibleParts: ['domed tomb', 'grave rows', 'approach path'], repeatedPattern: 'curved grave-marker rows', evidence: 'The domed tomb and repeated grave markers occupy the eastern plateau.', confidence: 0.9 },
      { id: 'survey-ruins', name: 'Eastern Column Temple Ruins', category: 'ruins', bbox: { x: 0.74, y: 0.3, width: 0.18, height: 0.17 }, depthBand: 'midground', groundContact: { x: 0.83, y: 0.46 }, occludes: [], occludedBy: [], visibleParts: ['standing columns', 'fallen shafts', 'lava edge'], repeatedPattern: 'column row', evidence: 'Tall isolated columns stand beside the lava channels on the eastern ridge.', confidence: 0.88 },
      { id: 'survey-moonwatch', name: 'Distant Moonwatch Colossus', category: 'distant monument', bbox: { x: 0.44, y: 0.04, width: 0.13, height: 0.23 }, depthBand: 'distant', groundContact: { x: 0.5, y: 0.25 }, occludes: [], occludedBy: ['survey-citadel'], visibleParts: ['colossal silhouette'], repeatedPattern: '', evidence: 'The distant colossus shares the central moonlit silhouette.', confidence: 0.78 },
    ],
    terrainContours: [
      { kind: 'eastern volcanic ridge', points: [{ x: 0.61, y: 0.48 }, { x: 0.79, y: 0.2 }, { x: 0.98, y: 0.36 }], evidence: 'The dark volcanic ridge rises continuously behind the eastern landmarks.' },
    ],
    waterlines: [
      { points: [{ x: 0, y: 0.72 }, { x: 0.31, y: 0.67 }, { x: 0.58, y: 0.75 }, { x: 1, y: 0.87 }], evidence: 'Open water and rocky shoreline remain visible across the lower composition.' },
    ],
    lightAndAtmosphere: [
      { signal: 'Warm settlement lights against cold moonlit haze', depthImplication: 'Contrast falls toward the monolith and snowy horizon.' },
    ],
    ambiguities: [
      'The hidden backsides of the citadel and volcanic ridge are not visible.',
      'Absolute object scale is unverified without a measured image span.',
    ],
    coverageChecklist: {
      terrain: true,
      coastlines: true,
      settlements: true,
      fortifications: true,
      ports: true,
      boats: true,
      monuments: true,
      ruins: true,
      cemeteries: true,
      vegetation: false,
      lights: true,
      distantSilhouettes: true,
    },
  },
  map: { widthMeters: 24000, depthMeters: 18000, maxElevationMeters: 980, gridSizeMeters: 100, chunkCount: 432, origin: 'Map center at sea-level datum · X east / Y south / Z up', coordinateSystem: 'World Forge meters · Unreal-compatible left-handed Z-up · export ×100cm' },
  layers: [
    { id: 'water', name: 'Deep water', type: 'hydrology', coverage: 38, color: '#315864', notes: 'Ocean shelf and harbor basin. Keep shoreline spline editable.' },
    { id: 'settlement', name: 'Fortified settlement', type: 'built', coverage: 18, color: '#d18a60', notes: 'Dense central mass around the stepped citadel.' },
    { id: 'rock', name: 'Volcanic rock', type: 'geology', coverage: 24, color: '#56656a', notes: 'High contrast basalt outcrops on east ridge.' },
    { id: 'snow', name: 'Snow cap', type: 'biome', coverage: 20, color: '#b9c9c5', notes: 'Use height + slope blend above 280m.' },
    { id: 'cemetery', name: 'Cemetery & memorial ground', type: 'landmark zone', coverage: 4, color: '#7d8989', notes: 'Separate kümbet, grave-marker rows and approach path from the arena.' },
    { id: 'ruins', name: 'Ancient column ruins', type: 'landmark zone', coverage: 2, color: '#aa8c67', notes: 'Keep columns as reusable modular pieces beside the lava channels.' },
  ],
  landmarks: [
    { id: 'citadel', sourceSurveyObjectId: 'survey-citadel', name: 'Stepped Citadel', type: 'hero structure', x: 118, y: -34, z: 84, rotation: 8, scale: 1, footprint: '180 × 140m', confidence: .94, assetCount: 16 },
    { id: 'caldera', sourceSurveyObjectId: 'survey-caldera', name: 'Ash Caldera', type: 'volcanic feature', x: 712, y: 318, z: 246, rotation: -12, scale: 1.2, footprint: '360 × 310m', confidence: .89, assetCount: 9 },
    { id: 'arena', sourceSurveyObjectId: 'survey-arena', name: 'Tide Arena', type: 'landmark', x: 546, y: -442, z: 32, rotation: 2, scale: .86, footprint: '220 × 190m', confidence: .91, assetCount: 12 },
    { id: 'monolith', sourceSurveyObjectId: 'survey-monolith', name: 'Moon Monolith', type: 'distant silhouette', x: -690, y: 460, z: 164, rotation: 0, scale: 1.5, footprint: '90 × 70m', confidence: .71, assetCount: 4 },
    { id: 'harbor', sourceSurveyObjectId: 'survey-harbor', name: 'Western Harbor & Piers', type: 'waterfront landmark', x: -264, y: 212, z: 30, rotation: 90, scale: 1, footprint: '1480 × 820m', confidence: .88, assetCount: 43 },
    { id: 'cemetery', sourceSurveyObjectId: 'survey-cemetery', name: 'Eastern Cemetery & Kümbet', type: 'memorial landmark', x: 598, y: 118, z: 190, rotation: -12, scale: 1, footprint: '940 × 680m', confidence: .84, assetCount: 149 },
    { id: 'ruins', sourceSurveyObjectId: 'survey-ruins', name: 'Eastern Column Temple Ruins', type: 'ruin landmark', x: 688, y: -274, z: 460, rotation: 4, scale: 1, footprint: '520 × 310m', confidence: .82, assetCount: 32 },
    { id: 'moonwatch', sourceSurveyObjectId: 'survey-moonwatch', name: 'Distant Moonwatch Colossus', type: 'distant monument', x: 0, y: -620, z: 180, rotation: 0, scale: 1, footprint: '420 × 280m', confidence: .72, assetCount: 1 },
  ],
  assetTree: [
    { id: 'wall', name: 'Fortification wall kit', parent: 'Stepped Citadel', category: 'fortification', kind: 'modular kit', count: 42, productionCount: 4, placementCount: 42, isReusable: true, dimensions: '6 × 3 × 4m', instruction: 'Snap to 3m grid; reserve 1m walkway clearance.', sourcePrompt: 'Four reusable basalt wall variants: straight, corner, gate and damaged.', placementInstructions: 'Build four wall variants once; instance them around the citadel perimeter and gate breaks.', readEvidence: 'Continuous stepped wall, crenellations, towers and gate openings are visible around the central settlement.', placements: [{ id: 'wall-p01', assetId: 'wall', parentLandmark: 'Stepped Citadel', x: 118, y: -34, z: 84, rotation: 8, scale: 1, reason: 'citadel perimeter' }] },
    { id: 'stairs', name: 'Citadel stair flight', parent: 'Stepped Citadel', category: 'architecture', kind: 'hero assembly', count: 6, productionCount: 2, placementCount: 6, isReusable: true, dimensions: '18 × 4 × 9m', instruction: 'Align to central axis. Use 8° upward rotation.', sourcePrompt: 'Two modular stone stair flights with side walls, worn steps and lamp sockets.', placementInstructions: 'Produce two stair variants once and place six flights along the citadel and terrace approaches.', readEvidence: 'Long axial stair runs connect the lower settlement to the raised citadel terraces.', placements: [{ id: 'stairs-p01', assetId: 'stairs', parentLandmark: 'Stepped Citadel', x: 118, y: -34, z: 84, rotation: 8, scale: 1, reason: 'main ceremonial ascent' }] },
    { id: 'basalt', name: 'Basalt outcrop cluster', parent: 'Ash Caldera', category: 'environment prop', kind: 'rock scatter', count: 28, productionCount: 5, placementCount: 28, isReusable: true, dimensions: '12 × 8 × 7m', instruction: 'Scatter on east-facing slopes, 0.72–1.35 scale.', sourcePrompt: 'Five reusable basalt, obsidian, ash mound, sulfur vent and lava seam props.', placementInstructions: 'Scatter 28 instances using the heat and slope masks, outside traversal splines.', readEvidence: 'Dark angular rock, ash and glowing volcanic seams repeat across the caldera slope.', placements: [{ id: 'basalt-p01', assetId: 'basalt', parentLandmark: 'Ash Caldera', x: 712, y: 318, z: 246, rotation: -12, scale: 1, reason: 'caldera rim' }] },
    { id: 'dock', name: 'Harbor dock segment', parent: 'Tide Arena', category: 'waterfront', kind: 'modular kit', count: 18, productionCount: 3, placementCount: 18, isReusable: true, dimensions: '12 × 3 × 0.8m', instruction: 'Keep local X parallel to shoreline spline.', sourcePrompt: 'Straight timber dock, angled mooring finger and stone quay modules with rope and lantern sockets.', placementInstructions: 'Produce three dock modules once; place 18 instances along the shoreline with vessel clearance.', readEvidence: 'Multiple piers project into the water, with mooring points and shoreline structures.', placements: [{ id: 'dock-p01', assetId: 'dock', parentLandmark: 'Tide Arena', x: 546, y: -442, z: 32, rotation: 2, scale: 1, reason: 'shoreline dock line' }] },
    { id: 'boats', name: 'Small boat kit', parent: 'Tide Arena', category: 'watercraft', kind: 'reusable asset', count: 9, productionCount: 3, placementCount: 9, isReusable: true, dimensions: '8–22 × 3–7 × 3–8m', instruction: 'Create fishing skiff, covered cargo boat and sailboat as separate reusable meshes.', sourcePrompt: 'Three readable dark wooden harbor boats with mast, sail, rope and cargo sockets.', placementInstructions: 'Generate three meshes once, then place nine boats at piers and in the foreground water with slight rotation offsets.', readEvidence: 'Several hulls, masts and sail silhouettes are visible beside the docks and in the lower foreground.', placements: [{ id: 'boats-p01', assetId: 'boats', parentLandmark: 'Tide Arena', x: 520, y: -452, z: 27, rotation: 6, scale: 1, reason: 'moored fishing boat' }] },
    { id: 'dome', name: 'Kümbet domed tomb', parent: 'Eastern cemetery', category: 'architecture', kind: 'hero unique', count: 1, productionCount: 1, placementCount: 1, isReusable: false, dimensions: '90 × 80 × 65m', instruction: 'Separate circular drum, dome, finial, entrance and interior chamber.', sourcePrompt: 'A single monumental ribbed domed tomb / kümbet with circular stone drum and warm entry light.', placementInstructions: 'Place once on the eastern cemetery plateau, aligned with the graveyard approach.', readEvidence: 'A distinct circular domed mausoleum is visible behind the right-side arena and must not be absorbed into the terrain.', placements: [{ id: 'dome-p01', assetId: 'dome', parentLandmark: 'Eastern cemetery', x: 600, y: 110, z: 190, rotation: 14, scale: 1, reason: 'cemetery hero structure' }] },
    { id: 'columns', name: 'Ancient column ruin kit', parent: 'Eastern ridge ruins', category: 'ruins', kind: 'modular kit', count: 24, productionCount: 4, placementCount: 24, isReusable: true, dimensions: '3–6 × 3–6 × 8–26m', instruction: 'Create intact, broken, capital and fallen column pieces for a ruined processional row.', sourcePrompt: 'Four weathered stone column variants with chipped capitals and collapsed shafts.', placementInstructions: 'Generate four variants once; place 24 columns in two ruin rows on the eastern ridge.', readEvidence: 'Tall isolated columns and a ruined temple silhouette are visible on the volcanic ridge.', placements: [{ id: 'columns-p01', assetId: 'columns', parentLandmark: 'Eastern ridge ruins', x: 760, y: 250, z: 210, rotation: 0, scale: 1, reason: 'eastern ruin colonnade' }] },
    { id: 'graves', name: 'Cemetery marker set', parent: 'Eastern cemetery', category: 'environment prop', kind: 'scatter set', count: 96, productionCount: 5, placementCount: 96, isReusable: true, dimensions: '1–4m', dimensionsMeters: { x: 1.2, y: 0.5, z: 2.8 }, instruction: 'Use five grave marker, standing stone and broken slab variants in curved rows.', sourcePrompt: 'Five worn grave markers with wet dark rock material and moonlit rim highlights.', placementInstructions: 'Produce five markers once and distribute 96 instances in readable curved rows around the kümbet.', readEvidence: 'A field of upright stones and low grave markers occupies the right midground.', placementPattern: { type: 'arc', center: { x: 598, y: 118, z: 184 }, radiusX: 310, radiusY: 190, startAngleDegrees: -15, endAngleDegrees: 195, closed: false, alignToTangent: true, rotationOffsetDegrees: 90 }, placements: [{ id: 'graves-p01', assetId: 'graves', parentLandmark: 'Eastern cemetery', x: 560, y: 140, z: 184, rotation: -8, orientation: { yaw: -8, pitch: 0, roll: 0 }, scale: 1, reason: 'first curved grave row' }] },
    { id: 'lights', name: 'Lantern and brazier kit', parent: 'All inhabited areas', category: 'lighting prop', kind: 'reusable prop', count: 132, productionCount: 4, placementCount: 132, isReusable: true, dimensions: '0.4–3m', instruction: 'Create wall lantern, hanging lamp, brazier and lava brazier with light sockets.', sourcePrompt: 'Four warm fire and lantern props contrasting with the cold moonlit environment.', placementInstructions: 'Produce four lighting props once and place 132 instances at streets, piers, arena rim, graves and lava channels.', readEvidence: 'Warm point lights repeat along the city, waterfront, arena, cemetery and volcanic channels.', placements: [{ id: 'lights-p01', assetId: 'lights', parentLandmark: 'Stepped Citadel', x: 120, y: -32, z: 90, rotation: 0, scale: 1, reason: 'citadel approach light' }] },
  ],
  validations: [
    { id: 'v1', severity: 'pass', title: 'Coordinate system is explicit', detail: 'UE World / Z-up with origin anchored to image center.' },
    { id: 'v2', severity: 'pass', title: 'Hero landmarks have measurable footprints', detail: '4 of 4 detected landmarks can be blocked out on the current grid.' },
    { id: 'v3', severity: 'warning', title: 'East ridge may exceed slope budget', detail: 'Two traversal lanes read above 38°. Consider a switchback or lift route.' },
    { id: 'v4', severity: 'warning', title: 'Harbor scale is inferred', detail: 'Dock lengths are estimated from vessel silhouettes; confirm against gameplay brief.' },
    { id: 'v5', severity: 'pass', title: 'Secondary structures are inventoried', detail: 'The read includes piers, boats, kümbet, cemetery markers, column ruins, towers, gates, arena and lighting props.' },
    { id: 'v6', severity: 'pass', title: 'Production and placement are separated', detail: 'Repeated geometry is generated once per variant and instanced at each world transform.' },
  ],
  prompt: 'Build a moody island fortress around a stepped citadel, with a volcanic ridge to the east, a flooded harbor to the west, and a ceremonial arena on the southern cliff. Preserve the strong moonlit silhouette and warm points of habitation.',
};

export const demoProject: Project = {
  id: 'atlas-01',
  name: 'ANA KARA / Moonlit Archipelago',
  imageName: 'ANA_KARA_1788285065365.jpg',
  status: 'ready',
  updatedAt: '2026-09-01T08:42:00.000Z',
  analysis: demoAnalysis,
};

export const demoSummaries: ProjectSummary[] = [
  { id: demoProject.id, name: demoProject.name, imageName: demoProject.imageName, status: demoProject.status, updatedAt: demoProject.updatedAt, landmarkCount: 10, assetCount: 356, mapSize: '24.0 × 18.0 km' },
];