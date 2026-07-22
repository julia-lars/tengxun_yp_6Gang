import { describe, expect, it } from "vitest";
import { api } from "./api.js";
describe("api", () => {
  it("所有方法存在", () => {
    expect(typeof api.getTags).toBe("function");
    expect(typeof api.listPersonas).toBe("function");
    expect(typeof api.getPersona).toBe("function");
    expect(typeof api.getChatSession).toBe("function");
  });
});
