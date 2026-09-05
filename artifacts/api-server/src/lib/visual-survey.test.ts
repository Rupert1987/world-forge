import assert from "node:assert/strict";
import test from "node:test";
import { parseVisualSurvey } from "./visual-survey";

const validSurvey = {
  cameraHypothesis: {
    horizonY: 0.4,
    perspectiveStrength: "medium",
    viewElevation: "elevated",
    vanishingDirections: [{ x: 0.5, y: 0.4, evidence: "roof lines" }],
  },
  depthBands: [
    { id: "near", order: 0, range: "foreground", evidence: "large silhouette" },
  ],
  objects: [
    {
      id: "tower",
      name: "Tower",
      category: "architecture",
      bbox: { x: 0.2, y: 0.2, width: 0.2, height: 0.5 },
      depthBand: "near",
      groundContact: { x: 0.3, y: 0.7 },
      occludes: [] as string[],
      occludedBy: [] as string[],
      visibleParts: ["roof", "walls"],
      repeatedPattern: "",
      evidence: "isolated tower silhouette",
      confidence: 0.9,
    },
  ],
  terrainContours: [
    {
      kind: "ridge",
      points: [{ x: 0.1, y: 0.4 }, { x: 0.9, y: 0.5 }],
      evidence: "continuous skyline",
    },
  ],
  waterlines: [
    {
      points: [{ x: 0, y: 0.8 }, { x: 1, y: 0.8 }],
      evidence: "level shoreline",
    },
  ],
  lightAndAtmosphere: [
    { signal: "haze", depthImplication: "reduced distant contrast" },
  ],
  ambiguities: ["rear wall is hidden"],
  coverageChecklist: {
    terrain: true,
    coastlines: true,
    settlements: true,
    fortifications: true,
    ports: false,
    boats: false,
    monuments: true,
    ruins: false,
    cemeteries: false,
    vegetation: false,
    lights: true,
    distantSilhouettes: true,
  },
};

test("retains a complete typed visual survey without fabricating evidence", () => {
  const result = parseVisualSurvey(JSON.stringify(validSurvey));
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.version, 1);
  assert.deepEqual(result.data.objects[0]?.bbox, validSurvey.objects[0]?.bbox);
  assert.deepEqual(
    result.data.objects[0]?.groundContact,
    validSurvey.objects[0]?.groundContact,
  );
  assert.deepEqual(result.data.ambiguities, validSurvey.ambiguities);
});

test("rejects partial survey responses", () => {
  const result = parseVisualSurvey(JSON.stringify({ objects: [] }));
  assert.equal(result.success, false);
});

test("rejects out-of-range and out-of-image boxes", () => {
  const outOfRange = structuredClone(validSurvey);
  outOfRange.objects[0]!.bbox.x = -0.1;
  assert.equal(parseVisualSurvey(JSON.stringify(outOfRange)).success, false);

  const outsideImage = structuredClone(validSurvey);
  outsideImage.objects[0]!.bbox = {
    x: 0.9,
    y: 0.2,
    width: 0.2,
    height: 0.5,
  };
  assert.equal(parseVisualSurvey(JSON.stringify(outsideImage)).success, false);
});

test("rejects broken depth and occlusion references", () => {
  const brokenDepth = structuredClone(validSurvey);
  brokenDepth.objects[0]!.depthBand = "missing";
  assert.equal(parseVisualSurvey(JSON.stringify(brokenDepth)).success, false);

  const brokenOcclusion = structuredClone(validSurvey);
  brokenOcclusion.objects[0]!.occludes = ["missing-object"];
  assert.equal(parseVisualSurvey(JSON.stringify(brokenOcclusion)).success, false);
});