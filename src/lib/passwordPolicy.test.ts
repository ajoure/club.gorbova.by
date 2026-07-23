import { describe, expect, it } from "vitest";
import {
  getUserPasswordRequirementText,
  USER_PASSWORD_MIN_LENGTH,
  validateUserPassword,
} from "./passwordPolicy";

describe("user password policy", () => {
  it("accepts any password with at least six characters", () => {
    expect(USER_PASSWORD_MIN_LENGTH).toBe(6);
    expect(validateUserPassword("abcdef")).toEqual({ minLength: true });
    expect(validateUserPassword("Абвгде")).toEqual({ minLength: true });
    expect(validateUserPassword("ABC...")).toEqual({ minLength: true });
  });

  it("rejects passwords shorter than six characters", () => {
    expect(validateUserPassword("abcde")).toEqual({ minLength: false });
  });

  it("describes the exact client requirement", () => {
    expect(getUserPasswordRequirementText()).toBe("Минимум 6 символов");
  });
});
