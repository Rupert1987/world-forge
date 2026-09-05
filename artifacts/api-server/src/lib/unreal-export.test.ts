import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnrealExportBundle,
  buildUnrealEditorScript,
  buildUnrealScene,
} from "./unreal-export";
import { ExportProjectResponse } from "@workspace/api-zod";

const analysis = {
  map: {
    widthMeters: 1_000,
    depthMeters: 800,
    maxElevationMeters: 300,
    gridSizeMeters: 50,
    chunkCount: 1,
    origin: "Map center",
    coordinateSystem: "World Forge meters · X/Y horizontal · Z up",
  },
  layers: [
    {
      id: "water",
      name: "Water",
      notes: "Sea plane at Z = -20m.",
    },
  ],
  landmarks: [
    {
      id: "central-city",
      name: "Central city",
      type: "settlement",
      x: 10,
      y: 20,
      z: 30,
      rotation: 15,
      scale: 1,
      footprint: "200m × 100m",
      confidence: 0.9,
      assetCount: 10,
    },
    {
      id: "western-harbor",
      name: "Harbor",
      type: "waterfront",
      x: -200,
      y: 100,
      z: -10,
      rotation: 90,
      scale: 1,
      footprint: "150m × 80m",
      confidence: 0.8,
      assetCount: 4,
    },
    {
      id: "volcano",
      name: "Volcano",
      type: "terrain landmark",
      x: 300,
      y: -200,
      z: 280,
      rotation: 0,
      scale: 1,
      footprint: "300m × 300m",
      confidence: 0.75,
      assetCount: 1,
    },
  ],
  assetTree: [
    {
      id: "houses",
      name: "House kit",
      parent: "Central city",
      category: "architecture",
      kind: "modular assembly",
      count: 2,
      productionCount: 1,
      placementCount: 2,
      isReusable: true,
      dimensions: "10m × 10m × 8m",
      dimensionsMeters: { x: 10, y: 10, z: 8 },
      instruction: "Build once.",
      sourcePrompt: "A blockout house.",
      placementInstructions: "Place twice.",
      readEvidence: "Repeated houses.",
      placements: [
        {
          id: "house-1",
          assetId: "houses",
          parentLandmark: "Central city",
          x: 12,
          y: 24,
          z: 30,
          rotation: 45,
          orientation: { yaw: 45, pitch: 12, roll: -3 },
          scale: 1.25,
          reason: "Street edge",
        },
      ],
    },
    {
      id: "arena-seats",
      name: "Arena seating module",
      parent: "Central city",
      category: "architecture",
      kind: "modular assembly",
      count: 5,
      productionCount: 1,
      placementCount: 5,
      isReusable: true,
      dimensions: "8m × 3m × 2m",
      dimensionsMeters: { x: 8, y: 3, z: 2 },
      instruction: "Follow the semi-ellipse.",
      sourcePrompt: "A curved seating module.",
      placementInstructions: "Place five modules along a semi-ellipse.",
      readEvidence: "A half-elliptical seating bowl.",
      placementPattern: {
        type: "arc" as const,
        center: { x: 0, y: 0, z: 10 },
        radiusX: 100,
        radiusY: 50,
        startAngleDegrees: 0,
        endAngleDegrees: 180,
        closed: false,
        alignToTangent: true,
        rotationOffsetDegrees: 0,
      },
      placements: [],
    },
  ],
  visualSurvey: {
    waterlines: [
      {
        points: [
          { x: 0.1, y: 0.8 },
          { x: 0.9, y: 0.75 },
        ],
        evidence: "Visible coast",
      },
    ],
  },
};

test("builds an editable Unreal scene with explicit centimeter transforms", () => {
  const scene = buildUnrealScene(analysis);

  assert.equal(scene.units.source, "meters");
  assert.equal(scene.units.target, "centimeters");
  assert.equal(scene.units.metersToUnrealCentimeters, 100);
  assert.equal(scene.landscape.editable, true);
  assert.equal(scene.landscape.actorClass, "Landscape");
  assert.equal(scene.landscape.resolution.samplesX, 253);
  assert.equal(
    scene.landscape.heightSamplesMeters.length,
    scene.landscape.resolution.samplesX *
      scene.landscape.resolution.samplesY,
  );
  assert.ok(scene.landscape.heightmapR16Base64.length > 1_000);
  assert.deepEqual(scene.landscape.originMeters, { x: -500, y: -400, z: 0 });
  assert.equal(scene.landscape.importRecipe.resolution, "253 × 253");
  assert.equal(scene.landscape.importRecipe.sectionSizeQuads, 63);
  assert.equal(scene.landscape.importRecipe.components, "4 × 4");
  assert.equal(
    scene.landscape.importRecipe.scale.xCentimetersPerQuad,
    scene.landscape.sampleSpacingUnrealCentimeters.x,
  );
  assert.equal(scene.splines.some((spline) => spline.type === "coastline"), true);
  assert.equal(scene.splines.some((spline) => spline.type === "road"), true);
  assert.equal(scene.proxyActors[0]?.transform.sourceMeters.location.x, 10);
  assert.equal(
    scene.proxyActors[0]?.transform.unrealCentimeters.location.x,
    1_000,
  );
  assert.equal(
    scene.hierarchicalInstances[0]?.transforms[0]?.unrealCentimeters.location.x,
    1_200,
  );
  assert.deepEqual(
    scene.hierarchicalInstances[0]?.transforms[0]?.sourceMeters.rotationDegrees,
    { yaw: 45, pitch: 12, roll: -3 },
  );
  assert.deepEqual(scene.hierarchicalInstances[0]?.dimensionsMeters, {
    x: 10,
    y: 10,
    z: 8,
  });
  assert.equal(
    scene.hierarchicalInstances[0]?.declaredPlacementCount,
    2,
  );
  assert.equal(
    scene.hierarchicalInstances[0]?.exportedTransformCount,
    1,
  );
  assert.equal(
    scene.hierarchicalInstances[0]?.remainingProceduralCount,
    1,
  );

  const arc = scene.hierarchicalInstances.find(
    (group) => group.sourceAssetId === "arena-seats",
  );
  assert.equal(arc?.exportedTransformCount, 5);
  assert.equal(arc?.remainingProceduralCount, 0);
  assert.deepEqual(arc?.transforms[0]?.sourceMeters.location, {
    x: 100,
    y: 0,
    z: 10,
  });
  assert.deepEqual(arc?.transforms[2]?.sourceMeters.location, {
    x: 0,
    y: 50,
    z: 10,
  });
  assert.deepEqual(arc?.transforms[4]?.sourceMeters.location, {
    x: -100,
    y: 0,
    z: 10,
  });
  assert.equal(
    arc?.transforms[0]?.sourceMeters.rotationDegrees.yaw,
    90,
  );
});

test("emits an editor script that creates all editable blockout layers", () => {
  const scene = buildUnrealScene(analysis);
  const script = buildUnrealEditorScript("Test World", scene);

  assert.match(script, /METERS_TO_UNREAL_CENTIMETERS/);
  assert.match(script, /unreal\.SplineComponent/);
  assert.match(script, /unreal\.SplineComponent\(actor, "WorldForgeSpline"\)/);
  assert.match(script, /HierarchicalInstancedStaticMeshComponent/);
  assert.match(
    script,
    /HierarchicalInstancedStaticMeshComponent\(\s*actor, "WorldForgeHISM"/,
  );
  assert.match(script, /component\.setup_attachment\(root\)/);
  assert.match(script, /heightmapR16Base64/);
  assert.match(script, /wf_prepare_landscape_import/);
  assert.doesNotMatch(script, /spawn.*Landscape/);
  assert.match(script, /wf_create_proxies/);
  assert.doesNotMatch(script, /Test World/);
});

test("base64-wraps scene JSON so project data cannot terminate Python strings", () => {
  const scene = buildUnrealScene(analysis);
  const script = buildUnrealEditorScript(
    "'''\\nraise RuntimeError('injected')",
    scene,
  );

  assert.doesNotMatch(script, /raise RuntimeError/);
  assert.doesNotMatch(script, /'''/);
});

test("returns the complete endpoint bundle required by OpenAPI", () => {
  const bundle = buildUnrealExportBundle(
    { id: "test-project", name: "Test World", analysis },
    "2026-09-02T00:00:00.000Z",
  );
  const parsed = ExportProjectResponse.safeParse(bundle);

  assert.equal(parsed.success, true);
  assert.equal(bundle.unrealScene.format, "world-forge-unreal-blockout");
  assert.equal(JSON.parse(bundle.manifest).unrealScene.version, 1);
});

test("draft export stamps arbitrary units and disables centimeter claims", () => {
  const project = {
    id: "proj-draft",
    name: "Draft World",
    analysis,
  };
  const bundle = buildUnrealExportBundle(project, "2026-09-06T00:00:00.000Z", {
    draft: true,
    tier: "draft",
    failingChecks: ["camera-geometry-unverified", "metric-scale-unknown"],
  });
  assert.equal(bundle.exportMetadata.units, "arbitrary");
  assert.equal(bundle.exportMetadata.pose, "unsolved");
  assert.equal(bundle.exportMetadata.centimeterClaimsEnabled, false);
  assert.equal(bundle.exportMetadata.WorldToMeters, 100);
  assert.match(bundle.filename, /draft-unscaled/);
  const parsed = JSON.parse(bundle.manifest);
  assert.equal(parsed.exportMetadata.centimeterClaimsEnabled, false);
});

test("scale-locked export enables centimeter claims with WorldToMeters=100", () => {
  const project = {
    id: "proj-locked",
    name: "Locked World",
    analysis,
  };
  const bundle = buildUnrealExportBundle(project, "2026-09-06T00:00:00.000Z", {
    draft: false,
    tier: "scale-locked",
  });
  assert.equal(bundle.exportMetadata.units, "centimeters");
  assert.equal(bundle.exportMetadata.pose, "scale-locked");
  assert.equal(bundle.exportMetadata.centimeterClaimsEnabled, true);
  assert.equal(bundle.exportMetadata.WorldToMeters, 100);
  assert.equal(bundle.exportMetadata.metersToUnrealCentimeters, 100);
});
