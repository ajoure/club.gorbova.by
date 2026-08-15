import { describe, expect, it } from "vitest";
import {
  filterUsersByEducationCondition,
  parseEducationCondition,
} from "../../supabase/functions/_shared/broadcastEducation";
import { evaluateBroadcastGuards } from "../../supabase/functions/_shared/broadcast-guards";

describe("условия учебных рассылок", () => {
  it("принимает только условие с конкретным уроком", () => {
    expect(parseEducationCondition({ lesson_id: "lesson-1", status: "lesson_completed" })).toEqual({
      lesson_id: "lesson-1",
      module_id: null,
      status: "lesson_completed",
    });
    expect(parseEducationCondition({ lesson_id: "", status: "lesson_completed" })).toBeNull();
    expect(parseEducationCondition({ lesson_id: "lesson-1", status: "unknown" })).toBeNull();
  });

  it("не меняет аудиторию без учебного условия", async () => {
    const result = await filterUsersByEducationCondition({}, ["user-1", "user-2"], null);
    expect([...result]).toEqual(["user-1", "user-2"]);
  });

  it("считает конкретный учебный фильтр ограниченной аудиторией", () => {
    expect(evaluateBroadcastGuards({
      filters: {
        include: [],
        exclude: [],
        club_ids: [],
        education: { lesson_id: "lesson-1", status: "lesson_not_completed" },
      },
      messageText: "Напоминание об уроке",
      isDryRun: false,
      isTestSelf: false,
      allowFullAudience: false,
      confirmFullAudienceText: null,
    })).toEqual({ blocked: false });
  });
});
