const METERS_TO_UNREAL_CENTIMETERS = 100;
const LANDSCAPE_COMPONENT_SIZE_QUADS = 63;
const LANDSCAPE_COMPONENTS_PER_AXIS = 4;
const LANDSCAPE_QUADS_PER_AXIS =
  LANDSCAPE_COMPONENT_SIZE_QUADS * LANDSCAPE_COMPONENTS_PER_AXIS;
const LANDSCAPE_SAMPLES_PER_AXIS = LANDSCAPE_QUADS_PER_AXIS + 1;

type MeterVector = { x: number; y: number; z: number };
type CentimeterVector = MeterVector;

type ExportAnalysis = {
  map: {
    widthMeters: number;
    depthMeters: number;
    maxElevationMeters: number;
    gridSizeMeters: number;
    chunkCount: number;
    origin: string;
    coordinateSystem: string;
  };
  layers: Array<{ id: string; name: string; notes: string }>;
  landmarks: Array<{
    id: string;
    name: string;
    type: string;
    x: number;
    y: number;
    z: number;
    rotation: number;
    scale: number;
    footprint: string;
    confidence: number;
    assetCount: number;
    uncertaintyMeters?: number;
  }>;
  assetTree: Array<{
    id: string;
    name: string;
    parent: string;
    category: string;
    kind: string;
    count: number;
    productionCount: number;
    placementCount: number;
    isReusable: boolean;
    dimensions: string;
    dimensionsMeters?: { x: number; y: number; z: number };
    instruction: string;
    sourcePrompt: string;
    placementInstructions: string;
    readEvidence: string;
    confidence?: number;
    placementPattern?: {
      type: "ellipse" | "arc";
      center: MeterVector;
      radiusX: number;
      radiusY: number;
      startAngleDegrees: number;
      endAngleDegrees: number;
      closed: boolean;
      alignToTangent: boolean;
      rotationOffsetDegrees: number;
    };
    placements: Array<{
      id: string;
      assetId: string;
      parentLandmark: string;
      x: number;
      y: number;
      z: number;
      rotation: number;
      orientation?: { yaw: number; pitch: number; roll: number };
      scale: number;
      reason: string;
      uncertaintyMeters?: number;
    }>;
  }>;
  visualSurvey?: {
    waterlines?: Array<{
      points: Array<{ x: number; y: number }>;
      evidence: string;
    }>;
  };
  confidenceBreakdown?: unknown;
  calibrationEvidence?: unknown;
  cameraGeometryVerification?: unknown;
  denseDepth?: unknown;
  reconstruction?: unknown;
  depthMap?: unknown;
  spatialRelations?: unknown;
  validations?: unknown;
};

type TransformExport = {
  sourceMeters: {
    location: MeterVector;
    rotationDegrees: { yaw: number; pitch: number; roll: number };
    scale: number;
  };
  unrealCentimeters: {
    location: CentimeterVector;
    rotationDegrees: { yaw: number; pitch: number; roll: number };
    scale: number;
  };
};

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toCentimeters(vector: MeterVector): CentimeterVector {
  return {
    x: round(vector.x * METERS_TO_UNREAL_CENTIMETERS),
    y: round(vector.y * METERS_TO_UNREAL_CENTIMETERS),
    z: round(vector.z * METERS_TO_UNREAL_CENTIMETERS),
  };
}

function transform(
  location: MeterVector,
  orientation: number | { yaw: number; pitch: number; roll: number },
  scale: number,
): TransformExport {
  const rotation =
    typeof orientation === "number"
      ? { yaw: orientation, pitch: 0, roll: 0 }
      : orientation;
  const sourceMeters = {
    location,
    rotationDegrees: {
      yaw: round(rotation.yaw),
      pitch: round(rotation.pitch),
      roll: round(rotation.roll),
    },
    scale: round(scale, 4),
  };
  return {
    sourceMeters,
    unrealCentimeters: {
      location: toCentimeters(location),
      rotationDegrees: sourceMeters.rotationDegrees,
      scale: sourceMeters.scale,
    },
  };
}

function findLandmark(analysis: ExportAnalysis, ids: string[]) {
  return ids
    .map((id) => analysis.landmarks.find((landmark) => landmark.id === id))
    .find(Boolean);
}

function parseSeaLevelMeters(analysis: ExportAnalysis) {
  const waterLayer = analysis.layers.find((layer) => layer.id === "water");
  const match = waterLayer?.notes.match(/Z\s*=\s*(-?\d+(?:\.\d+)?)m/i);
  return match ? Number(match[1]) : 0;
}

function parseFootprintMeters(footprint: string) {
  const dimensions = Array.from(
    footprint.matchAll(/([\d,.]+)\s*m/gi),
    (match) => Number(match[1].replaceAll(",", "")),
  ).filter((value) => Number.isFinite(value) && value > 0);
  return {
    x: dimensions[0] ?? 20,
    y: dimensions[1] ?? dimensions[0] ?? 20,
    z: dimensions[2] ?? Math.max(8, Math.min(80, (dimensions[0] ?? 20) * 0.25)),
  };
}

function buildHeightSamples(analysis: ExportAnalysis) {
  const width = analysis.map.widthMeters;
  const depth = analysis.map.depthMeters;
  const seaLevelMeters = parseSeaLevelMeters(analysis);
  const terrainLandmarks = analysis.landmarks.filter((landmark) =>
    /volcano|ridge|mountain|cliff|island|peak|arena/i.test(
      `${landmark.id} ${landmark.name} ${landmark.type}`,
    ),
  );
  const samples = new Array<number>(
    LANDSCAPE_SAMPLES_PER_AXIS * LANDSCAPE_SAMPLES_PER_AXIS,
  );

  for (let row = 0; row < LANDSCAPE_SAMPLES_PER_AXIS; row += 1) {
    const y =
      -depth / 2 +
      (row / LANDSCAPE_QUADS_PER_AXIS) * depth;
    for (let column = 0; column < LANDSCAPE_SAMPLES_PER_AXIS; column += 1) {
      const x =
        -width / 2 +
        (column / LANDSCAPE_QUADS_PER_AXIS) * width;
      let elevation = seaLevelMeters;

      for (const landmark of terrainLandmarks) {
        const footprintWidth = Math.max(
          250,
          Number(landmark.footprint.match(/([\d,.]+)\s*m/i)?.[1]?.replace(",", "")) ||
            750,
        );
        const radius = footprintWidth * 1.6;
        const distance = Math.hypot(x - landmark.x, y - landmark.y);
        const influence = Math.max(0, 1 - distance / radius);
        elevation = Math.max(
          elevation,
          seaLevelMeters +
            Math.max(0, landmark.z - seaLevelMeters) * influence * influence,
        );
      }

      // A tiny deterministic undulation keeps the editable blockout from being
      // perfectly flat between evidence anchors without pretending to be survey data.
      const undulation =
        Math.sin((x / Math.max(width, 1)) * Math.PI * 4) *
          Math.cos((y / Math.max(depth, 1)) * Math.PI * 3) *
          Math.min(18, Math.max(4, analysis.map.gridSizeMeters * 0.08));
      samples[row * LANDSCAPE_SAMPLES_PER_AXIS + column] = round(
        elevation + undulation,
      );
    }
  }
  return { samples, seaLevelMeters };
}

function encodeUnrealHeightmap(samples: number[]) {
  const maximumAbsoluteHeight = Math.max(
    1,
    ...samples.map((height) => Math.abs(height)),
  );
  const landscapeScaleZPercent = round(
    (maximumAbsoluteHeight / 256) * 100,
    6,
  );
  const valuesPerMeter = (128 * 100) / landscapeScaleZPercent;
  const data = Buffer.allocUnsafe(samples.length * 2);
  samples.forEach((heightMeters, index) => {
    const value = Math.max(
      0,
      Math.min(65_535, Math.round(32_768 + heightMeters * valuesPerMeter)),
    );
    data.writeUInt16LE(value, index * 2);
  });
  return {
    heightmapR16Base64: data.toString("base64"),
    landscapeScaleZPercent,
  };
}

function surveyPointToMeters(
  analysis: ExportAnalysis,
  point: { x: number; y: number },
  z: number,
): MeterVector {
  return {
    x: (point.x - 0.5) * analysis.map.widthMeters,
    y: (point.y - 0.5) * analysis.map.depthMeters,
    z,
  };
}

function buildSplines(analysis: ExportAnalysis) {
  const seaLevelMeters = parseSeaLevelMeters(analysis);
  const splines: Array<{
    id: string;
    name: string;
    type: "coastline" | "road";
    closed: boolean;
    widthMeters: number;
    source: string;
    points: Array<{
      index: number;
      sourceMeters: MeterVector;
      unrealCentimeters: CentimeterVector;
    }>;
  }> = [];

  for (const [index, waterline] of (
    analysis.visualSurvey?.waterlines ?? []
  ).entries()) {
    const points = waterline.points.map((point, pointIndex) => {
      const sourceMeters = surveyPointToMeters(
        analysis,
        point,
        seaLevelMeters,
      );
      return {
        index: pointIndex,
        sourceMeters,
        unrealCentimeters: toCentimeters(sourceMeters),
      };
    });
    if (points.length >= 2) {
      splines.push({
        id: `coastline-${index + 1}`,
        name: `Coastline ${index + 1}`,
        type: "coastline",
        closed: false,
        widthMeters: 12,
        source: waterline.evidence,
        points,
      });
    }
  }

  const centralCity = findLandmark(analysis, ["central-city", "citadel"]);
  const roadDestinations = [
    findLandmark(analysis, ["western-harbor", "harbor"]),
    findLandmark(analysis, ["cemetery"]),
    findLandmark(analysis, ["arena"]),
  ].filter(Boolean);
  if (centralCity && roadDestinations.length > 0) {
    for (const [index, destination] of roadDestinations.entries()) {
      const sourcePoints = [
        {
          x: centralCity.x,
          y: centralCity.y,
          z: centralCity.z,
        },
        {
          x: destination!.x,
          y: destination!.y,
          z: destination!.z,
        },
      ];
      splines.push({
        id: `road-${index + 1}`,
        name: `Primary road ${index + 1}`,
        type: "road",
        closed: false,
        widthMeters: 7,
        source: `Inferred from the ${centralCity.name} to ${destination!.name} landmark route.`,
        points: sourcePoints.map((sourceMeters, pointIndex) => ({
          index: pointIndex,
          sourceMeters,
          unrealCentimeters: toCentimeters(sourceMeters),
        })),
      });
    }
  }

  return splines;
}

function buildProxyActors(analysis: ExportAnalysis) {
  return analysis.landmarks.map((landmark) => {
    const boundsMeters = parseFootprintMeters(landmark.footprint);
    return {
      id: `proxy-landmark-${landmark.id}`,
      label: `WF Proxy · ${landmark.name}`,
      actorClass: "StaticMeshActor",
      assetId: landmark.id,
      editablePurpose: "Visible landmark volume and replaceable blockout proxy",
      proxyMeshPath: "/Engine/BasicShapes/Cube.Cube",
      boundsMeters,
      confidence: landmark.confidence,
      uncertaintyMeters: landmark.uncertaintyMeters ?? null,
      transform: transform(
        {
          x: landmark.x,
          y: landmark.y,
          z: landmark.z + boundsMeters.z / 2,
        },
        landmark.rotation,
        landmark.scale,
      ),
      tags: ["WorldForge", "Proxy", "Landmark", landmark.type],
    };
  });
}

function buildHierarchicalInstances(analysis: ExportAnalysis) {
  return analysis.assetTree
    .filter((asset) => asset.placements.length > 0 || asset.placementPattern)
    .map((asset) => {
      const placements = expandPlacementPattern(asset);
      return {
      id: `his-${asset.id}`,
      label: `WF HISM · ${asset.name}`,
      sourceAssetId: asset.id,
      sourceAssetName: asset.name,
      meshSlots: asset.productionCount,
      reusable: asset.isReusable,
      productionCount: asset.productionCount,
      declaredPlacementCount: asset.placementCount,
      exportedTransformCount: placements.length,
      remainingProceduralCount: Math.max(
        0,
        asset.placementCount - placements.length,
      ),
      replacementPath: `/Game/WorldForge/ProxyMeshes/${asset.id}`,
      fallbackMeshPath: "/Engine/BasicShapes/Cube.Cube",
      dimensionsMeters: asset.dimensionsMeters,
      placementPattern: asset.placementPattern,
      transforms: placements.map((placement) => ({
        id: placement.id,
        parentLandmark: placement.parentLandmark,
        reason: placement.reason,
        uncertaintyMeters: placement.uncertaintyMeters ?? null,
        ...transform(
          { x: placement.x, y: placement.y, z: placement.z },
          placement.orientation ?? placement.rotation,
          placement.scale,
        ),
      })),
    };
    });
}

type ExportAsset = ExportAnalysis["assetTree"][number];

function expandPlacementPattern(asset: ExportAsset): ExportAsset["placements"] {
  const pattern = asset.placementPattern;
  if (!pattern || asset.placementCount <= 0) return asset.placements;

  const denominator = pattern.closed
    ? asset.placementCount
    : Math.max(1, asset.placementCount - 1);
  const angleSpan = pattern.endAngleDegrees - pattern.startAngleDegrees;
  return Array.from({ length: asset.placementCount }, (_, index) => {
    const angleDegrees =
      pattern.startAngleDegrees + (angleSpan * index) / denominator;
    const angleRadians = (angleDegrees * Math.PI) / 180;
    const tangentYaw =
      (Math.atan2(
        pattern.radiusY * Math.cos(angleRadians),
        -pattern.radiusX * Math.sin(angleRadians),
      ) *
        180) /
      Math.PI;
    const yaw =
      (pattern.alignToTangent ? tangentYaw : 0) +
      pattern.rotationOffsetDegrees;
    return {
      id: `${asset.id}-pattern-${String(index + 1).padStart(3, "0")}`,
      assetId: asset.id,
      parentLandmark: asset.parent,
      x: round(pattern.center.x + pattern.radiusX * Math.cos(angleRadians)),
      y: round(pattern.center.y + pattern.radiusY * Math.sin(angleRadians)),
      z: round(pattern.center.z),
      rotation: round(yaw),
      orientation: { yaw: round(yaw), pitch: 0, roll: 0 },
      scale: 1,
      reason: `${pattern.type} pattern ${index + 1}/${asset.placementCount}`,
      uncertaintyMeters: undefined,
    };
  });
}

export function buildUnrealScene(analysis: ExportAnalysis) {
  const { samples, seaLevelMeters } = buildHeightSamples(analysis);
  const heightmap = encodeUnrealHeightmap(samples);
  const sampleSpacingMeters = {
    x: analysis.map.widthMeters / LANDSCAPE_QUADS_PER_AXIS,
    y: analysis.map.depthMeters / LANDSCAPE_QUADS_PER_AXIS,
  };

  return {
    version: 1,
    format: "world-forge-unreal-blockout",
    units: {
      source: "meters",
      target: "centimeters",
      metersToUnrealCentimeters: METERS_TO_UNREAL_CENTIMETERS,
      conversionRule:
        "Unreal boundary only: every source-meter location and elevation is multiplied by 100; rotations and unitless scales are unchanged.",
    },
    coordinateSystem: {
      source: analysis.map.coordinateSystem,
      unreal: "Unreal Engine left-handed, X/Y horizontal, Z up",
      origin: analysis.map.origin,
    },
    landscape: {
      editable: true,
      actorClass: "Landscape",
      source: "analysis-hypothesis",
      dimensionsMeters: {
        width: analysis.map.widthMeters,
        depth: analysis.map.depthMeters,
        maxElevation: analysis.map.maxElevationMeters,
        seaLevel: seaLevelMeters,
      },
      originMeters: {
        x: round(-analysis.map.widthMeters / 2),
        y: round(-analysis.map.depthMeters / 2),
        z: 0,
      },
      originUnrealCentimeters: {
        x: round(
          (-analysis.map.widthMeters / 2) *
            METERS_TO_UNREAL_CENTIMETERS,
        ),
        y: round(
          (-analysis.map.depthMeters / 2) *
            METERS_TO_UNREAL_CENTIMETERS,
        ),
        z: 0,
      },
      dimensionsUnrealCentimeters: {
        width: round(analysis.map.widthMeters * METERS_TO_UNREAL_CENTIMETERS),
        depth: round(analysis.map.depthMeters * METERS_TO_UNREAL_CENTIMETERS),
        maxElevation: round(
          analysis.map.maxElevationMeters * METERS_TO_UNREAL_CENTIMETERS,
        ),
        seaLevel: round(seaLevelMeters * METERS_TO_UNREAL_CENTIMETERS),
      },
      resolution: {
        samplesX: LANDSCAPE_SAMPLES_PER_AXIS,
        samplesY: LANDSCAPE_SAMPLES_PER_AXIS,
        quadsX: LANDSCAPE_QUADS_PER_AXIS,
        quadsY: LANDSCAPE_QUADS_PER_AXIS,
        componentSizeQuads: LANDSCAPE_COMPONENT_SIZE_QUADS,
        componentsX: LANDSCAPE_COMPONENTS_PER_AXIS,
        componentsY: LANDSCAPE_COMPONENTS_PER_AXIS,
      },
      sampleSpacingMeters,
      sampleSpacingUnrealCentimeters: {
        x: round(sampleSpacingMeters.x * METERS_TO_UNREAL_CENTIMETERS),
        y: round(sampleSpacingMeters.y * METERS_TO_UNREAL_CENTIMETERS),
      },
      heightEncoding: {
        values: "meters above the World Forge sea-level datum",
        importToUnreal:
          "Multiply each heightSamplesMeters value by 100 before writing Landscape height data.",
        heightmapFilename: "WorldForgeLandscape.r16",
        heightmapFormat:
          "16-bit little-endian unsigned RAW; Unreal neutral height is 32768.",
        landscapeScaleZPercent: heightmap.landscapeScaleZPercent,
      },
      heightSamplesMeters: samples,
      heightmapR16Base64: heightmap.heightmapR16Base64,
      importRecipe: {
        target: "Unreal Engine 5 Landscape Mode · Import from File",
        heightmapFilename: "WorldForgeLandscape.r16",
        resolution: `${LANDSCAPE_SAMPLES_PER_AXIS} × ${LANDSCAPE_SAMPLES_PER_AXIS}`,
        sectionSizeQuads: LANDSCAPE_COMPONENT_SIZE_QUADS,
        sectionsPerComponent: 1,
        components: `${LANDSCAPE_COMPONENTS_PER_AXIS} × ${LANDSCAPE_COMPONENTS_PER_AXIS}`,
        locationUnrealCentimeters: {
          x: round(
            (-analysis.map.widthMeters / 2) *
              METERS_TO_UNREAL_CENTIMETERS,
          ),
          y: round(
            (-analysis.map.depthMeters / 2) *
              METERS_TO_UNREAL_CENTIMETERS,
          ),
          z: 0,
        },
        scale: {
          xCentimetersPerQuad: round(
            sampleSpacingMeters.x * METERS_TO_UNREAL_CENTIMETERS,
          ),
          yCentimetersPerQuad: round(
            sampleSpacingMeters.y * METERS_TO_UNREAL_CENTIMETERS,
          ),
          zPercent: heightmap.landscapeScaleZPercent,
        },
        steps: [
          "Open Landscape Mode and choose New Landscape.",
          "Select Import from File and choose WorldForgeLandscape.r16 from the project Saved directory.",
          `Confirm ${LANDSCAPE_SAMPLES_PER_AXIS} × ${LANDSCAPE_SAMPLES_PER_AXIS} vertices, ${LANDSCAPE_COMPONENT_SIZE_QUADS} quads per section, 1 section per component, and ${LANDSCAPE_COMPONENTS_PER_AXIS} × ${LANDSCAPE_COMPONENTS_PER_AXIS} components.`,
          "Apply the exported X/Y centimeters-per-quad scale, Z percentage, and centered location before importing.",
          "Click Import. The resulting Unreal Landscape is component-backed and remains editable in Landscape Mode.",
        ],
      },
    },
    splines: buildSplines(analysis),
    proxyActors: buildProxyActors(analysis),
    hierarchicalInstances: buildHierarchicalInstances(analysis),
  };
}

export function buildUnrealEditorScript(
  _projectName: string,
  scene: ReturnType<typeof buildUnrealScene>,
) {
  const sceneBase64 = Buffer.from(JSON.stringify(scene), "utf8").toString(
    "base64",
  );
  return `# World Forge editable Unreal blockout
# Paste into the Unreal Editor Python console or save as a .py file and run it.
# World Forge stores all geometry in meters. This script is the explicit Unreal boundary:
# locations and landscape elevations are multiplied by 100; rotations/scales are unchanged.

import base64
import json
import os
import unreal

WORLD_FORGE_SCENE = json.loads(base64.b64decode("${sceneBase64}").decode("utf-8"))
METERS_TO_UNREAL_CENTIMETERS = WORLD_FORGE_SCENE["units"]["metersToUnrealCentimeters"]

def wf_cm(vector_m):
    return unreal.Vector(
        vector_m["x"] * METERS_TO_UNREAL_CENTIMETERS,
        vector_m["y"] * METERS_TO_UNREAL_CENTIMETERS,
        vector_m["z"] * METERS_TO_UNREAL_CENTIMETERS,
    )

def wf_transform(item):
    location = item["sourceMeters"]["location"]
    rotation = item["sourceMeters"]["rotationDegrees"]
    return unreal.Transform(
        unreal.Rotator(rotation["pitch"], rotation["yaw"], rotation["roll"]),
        wf_cm(location),
        unreal.Vector(
            item["sourceMeters"]["scale"],
            item["sourceMeters"]["scale"],
            item["sourceMeters"]["scale"],
        ),
    )

def wf_spawn(actor_class, transform, label):
    subsystem = getattr(unreal, "EditorActorSubsystem", None)
    if subsystem:
        editor = unreal.get_editor_subsystem(subsystem)
        actor = editor.spawn_actor_from_class(actor_class, transform.translation, transform.rotation)
    else:
        actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
            actor_class, transform.translation, transform.rotation
        )
    if actor:
        actor.set_actor_label(label)
    return actor

def wf_tag(actor, tags):
    if not actor:
        return
    for tag in tags:
        actor.tags.append(tag)

def wf_ensure_root(actor):
    root = actor.get_root_component()
    if root:
        return root
    root = unreal.SceneComponent(actor, "WorldForgeRoot")
    actor.add_instance_component(root)
    actor.set_root_component(root)
    root.register_component()
    return root

def wf_prepare_landscape_import():
    data = WORLD_FORGE_SCENE["landscape"]
    heightmap_path = os.path.join(
        unreal.Paths.project_saved_dir(),
        data["heightEncoding"]["heightmapFilename"],
    )
    with open(heightmap_path, "wb") as heightmap_file:
        heightmap_file.write(base64.b64decode(data["heightmapR16Base64"]))
    recipe = data["importRecipe"]
    print("World Forge: import-ready Landscape R16 created:", heightmap_path)
    print("  resolution:", recipe["resolution"])
    print("  section/component layout:", recipe["sectionSizeQuads"], "quads,", recipe["sectionsPerComponent"], "section,", recipe["components"], "components")
    print("  location cm:", recipe["locationUnrealCentimeters"])
    print("  scale:", recipe["scale"])
    for step in recipe["steps"]:
        print("  -", step)
    return {"heightmapPath": heightmap_path, "recipe": recipe}

def wf_create_splines():
    created = []
    for spline_data in WORLD_FORGE_SCENE["splines"]:
        actor = wf_spawn(unreal.Actor, unreal.Transform(), "WF Spline · " + spline_data["name"])
        if not actor:
            continue
        wf_tag(actor, ["WorldForge", "Spline", spline_data["type"]])
        root = wf_ensure_root(actor)
        component = unreal.SplineComponent(actor, "WorldForgeSpline")
        actor.add_instance_component(component)
        component.setup_attachment(root)
        component.register_component()
        component.clear_spline_points(False)
        for point in spline_data["points"]:
            component.add_spline_point(wf_cm(point["sourceMeters"]), unreal.SplineCoordinateSpace.WORLD, False)
        component.set_closed_loop(spline_data["closed"], False)
        component.update_spline()
        created.append(actor)
    return created

def wf_create_proxies():
    created = []
    actor_class = getattr(unreal, "StaticMeshActor", unreal.Actor)
    for proxy in WORLD_FORGE_SCENE["proxyActors"]:
        actor = wf_spawn(actor_class, wf_transform(proxy["transform"]), proxy["label"])
        wf_tag(actor, proxy["tags"])
        if actor:
            mesh = unreal.EditorAssetLibrary.load_asset(proxy["proxyMeshPath"])
            mesh_component = actor.get_editor_property("static_mesh_component")
            if mesh and mesh_component:
                mesh_component.set_static_mesh(mesh)
                bounds = proxy["boundsMeters"]
                source_scale = proxy["transform"]["sourceMeters"]["scale"]
                actor.set_actor_scale3d(unreal.Vector(
                    bounds["x"] * source_scale,
                    bounds["y"] * source_scale,
                    bounds["z"] * source_scale,
                ))
            created.append(actor)
    return created

def wf_create_hierarchical_instances():
    created = []
    for group in WORLD_FORGE_SCENE["hierarchicalInstances"]:
        actor = wf_spawn(unreal.Actor, unreal.Transform(), group["label"])
        if not actor:
            continue
        wf_tag(actor, ["WorldForge", "HISM", group["sourceAssetId"]])
        root = wf_ensure_root(actor)
        component = unreal.HierarchicalInstancedStaticMeshComponent(
            actor, "WorldForgeHISM"
        )
        actor.add_instance_component(component)
        component.setup_attachment(root)
        component.register_component()
        mesh_path = group["replacementPath"]
        mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
        if not mesh:
            mesh = unreal.EditorAssetLibrary.load_asset(group["fallbackMeshPath"])
        if mesh:
            component.set_static_mesh(mesh)
        if mesh_path != group["fallbackMeshPath"] and not unreal.EditorAssetLibrary.does_asset_exist(mesh_path):
            print("World Forge: replacement mesh not found; using visible cube proxies:", mesh_path)
        for item in group["transforms"]:
            component.add_instance(wf_transform(item))
        created.append(actor)
    return created

LANDSCAPE_IMPORT = wf_prepare_landscape_import()
SPLINES = wf_create_splines()
PROXIES = wf_create_proxies()
HIERARCHICAL_INSTANCES = wf_create_hierarchical_instances()
print("World Forge blockout export ready: landscape heightmap=%s splines=%d proxies=%d HISM groups=%d" % (
    bool(LANDSCAPE_IMPORT), len(SPLINES), len(PROXIES), len(HIERARCHICAL_INSTANCES)
))
`;
}

export type UnrealExportOptions = {
  draft?: boolean;
  tier?: "draft" | "verified" | "scale-locked";
  failingChecks?: string[];
};

export function buildUnrealExportBundle(
  project: { id: string; name: string; analysis: ExportAnalysis },
  generatedAt: string,
  options: UnrealExportOptions = {},
) {
  const draft = Boolean(options.draft);
  const tier = options.tier ?? (draft ? "draft" : "scale-locked");
  const failingChecks = options.failingChecks ?? [];
  const unrealScene = buildUnrealScene(project.analysis);
  const exportMetadata = {
    units: draft ? "arbitrary" : "centimeters",
    pose: draft ? "unsolved" : "scale-locked",
    exportTier: tier,
    centimeterClaimsEnabled: !draft,
    WorldToMeters: 100,
    metersToUnrealCentimeters: METERS_TO_UNREAL_CENTIMETERS,
    failingChecks,
  };
  const manifest = JSON.stringify(
    {
      project: project.name,
      exportMetadata,
      coordinateSystem: draft
        ? "World Forge arbitrary units · pose unsolved · not survey-grade centimeters"
        : project.analysis.map.coordinateSystem,
      map: project.analysis.map,
      landmarks: project.analysis.landmarks,
      assetTree: project.analysis.assetTree,
      confidenceBreakdown: project.analysis.confidenceBreakdown,
      calibrationEvidence: project.analysis.calibrationEvidence,
      cameraGeometryVerification:
        project.analysis.cameraGeometryVerification,
      denseDepth: project.analysis.denseDepth,
      visualSurvey: project.analysis.visualSurvey,
      reconstruction: project.analysis.reconstruction,
      depthMap: project.analysis.depthMap,
      spatialRelations: project.analysis.spatialRelations,
      validations: project.analysis.validations,
      unrealScene,
    },
    null,
    2,
  );
  const suffix = draft ? "-draft-unscaled" : "-unreal-blockout-export";
  return {
    filename: `${project.id}${suffix}.json`,
    generatedAt,
    exportMetadata,
    unrealScript: buildUnrealEditorScript(project.name, unrealScene),
    manifest,
    unrealScene,
  };
}