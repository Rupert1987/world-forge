import {
  AnalyzeProjectResponse,
  type VisualSurvey,
} from "@workspace/api-zod";

const visualSurveySchema = AnalyzeProjectResponse.shape.visualSurvey
  .unwrap()
  .superRefine((survey, context) => {
    const objectIds = new Set<string>();
    const depthBandIds = new Set<string>();

    if (survey.objects.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["objects"],
        message: "At least one surveyed object is required",
      });
    }
    if (survey.depthBands.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["depthBands"],
        message: "At least one depth band is required",
      });
    }

    survey.depthBands.forEach((band, index) => {
      if (!band.id.trim()) {
        context.addIssue({
          code: "custom",
          path: ["depthBands", index, "id"],
          message: "Depth-band IDs must not be blank",
        });
      } else if (depthBandIds.has(band.id)) {
        context.addIssue({
          code: "custom",
          path: ["depthBands", index, "id"],
          message: "Depth-band IDs must be unique",
        });
      }
      depthBandIds.add(band.id);
    });

    survey.objects.forEach((object, index) => {
      if (!object.id.trim()) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "id"],
          message: "Survey object IDs must not be blank",
        });
      } else if (objectIds.has(object.id)) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "id"],
          message: "Survey object IDs must be unique",
        });
      }
      objectIds.add(object.id);

      if (object.bbox.width <= 0 || object.bbox.height <= 0) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "bbox"],
          message: "Survey boxes must have positive width and height",
        });
      }
      if (
        object.bbox.x + object.bbox.width > 1 ||
        object.bbox.y + object.bbox.height > 1
      ) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "bbox"],
          message: "Survey boxes must remain inside the normalized image",
        });
      }
    });

    const depthRanges = new Set([
      "foreground",
      "midground",
      "background",
      "distant",
    ]);
    survey.objects.forEach((object, index) => {
      if (
        !depthBandIds.has(object.depthBand) &&
        !depthRanges.has(object.depthBand)
      ) {
        context.addIssue({
          code: "custom",
          path: ["objects", index, "depthBand"],
          message: "Object depth bands must reference a declared band",
        });
      }
      [...object.occludes, ...object.occludedBy].forEach((linkedId) => {
        if (linkedId === object.id || !objectIds.has(linkedId)) {
          context.addIssue({
            code: "custom",
            path: ["objects", index],
            message: "Occlusion links must reference another survey object ID",
          });
        }
      });
    });

    survey.terrainContours.forEach((contour, index) => {
      if (contour.points.length < 2) {
        context.addIssue({
          code: "custom",
          path: ["terrainContours", index, "points"],
          message: "Terrain contours require at least two normalized points",
        });
      }
    });
    survey.waterlines.forEach((waterline, index) => {
      if (waterline.points.length < 2) {
        context.addIssue({
          code: "custom",
          path: ["waterlines", index, "points"],
          message: "Waterlines require at least two normalized points",
        });
      }
    });
  });

export type VisualSurveyParseResult =
  | { success: true; data: VisualSurvey }
  | { success: false; error: string };

export function parseVisualSurvey(raw: string): VisualSurveyParseResult {
  try {
    const decoded: unknown = JSON.parse(
      raw.replace(/^```json\s*|\s*```$/g, ""),
    );
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      return { success: false, error: "Survey response is not a JSON object" };
    }
    const result = visualSurveySchema.safeParse({ ...decoded, version: 1 });
    if (!result.success) {
      return {
        success: false,
        error: result.error.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.join(".") || "survey"}: ${issue.message}`)
          .join("; "),
      };
    }
    return { success: true, data: result.data };
  } catch {
    return { success: false, error: "Survey response is not valid JSON" };
  }
}