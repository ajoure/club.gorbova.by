import { describe, expect, it } from "vitest";
import {
  extractTrainingAssetPaths,
  extractTrainingAssetReferences,
} from "./extractTrainingAssetPaths";

describe("extractTrainingAssetReferences", () => {
  it("keeps private student submissions in their bucket and treats legacy records as public", () => {
    const input = {
      files: [
        {
          storage_path: "student-uploads/student-a/lesson-a/block-a/new.pdf",
          storage_bucket: "student-submissions",
        },
        {
          storage_path: "student-uploads/student-b/lesson-b/block-b/legacy.pdf",
        },
      ],
    };

    expect(extractTrainingAssetReferences(input)).toEqual([
      { bucket: "student-submissions", path: "student-uploads/student-a/lesson-a/block-a/new.pdf" },
      { bucket: "training-assets", path: "student-uploads/student-b/lesson-b/block-b/legacy.pdf" },
    ]);
    expect(extractTrainingAssetPaths(input)).toEqual([
      "student-uploads/student-a/lesson-a/block-a/new.pdf",
      "student-uploads/student-b/lesson-b/block-b/legacy.pdf",
    ]);
  });

  it("ignores untrusted bucket names and unsafe paths", () => {
    expect(extractTrainingAssetReferences({
      storage_path: "student-uploads/student-a/lesson-a/block-a/file.pdf",
      storage_bucket: "arbitrary-bucket",
      nested: { storage_path: "student-uploads/../secret.pdf", storage_bucket: "student-submissions" },
    })).toEqual([
      { bucket: "training-assets", path: "student-uploads/student-a/lesson-a/block-a/file.pdf" },
    ]);
  });
});
