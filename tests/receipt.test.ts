import { describe, it, expect } from "vitest";
import { createReceipt, renderReceipt } from "../src/domain/receipt";
import { taskDefaults } from "../src/domain/workspace";
const task = {
  id: "00000000-0000-4000-8000-000000000001",
  ...taskDefaults('<script>alert("x")</script>'),
};
describe("receipt snapshot", () => {
  it("uses stable credential-free URLs and excludes completed work", () => {
    const snapshot = createReceipt(
      [
        task,
        {
          ...task,
          id: "00000000-0000-4000-8000-000000000002",
          completed: true,
        },
      ],
      "https://daily.example/?token=secret",
    );
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].url).toBe(
      `https://daily.example/?task=${task.id}`,
    );
  });
  it("rejects non-phone-accessible origins", () => {
    expect(() => createReceipt([task], "http://localhost:1420")).toThrow();
  });
  it("escapes supplied text and embeds a QR image rather than external resources", async () => {
    const html = await renderReceipt(
      createReceipt([task], "https://daily.example"),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("data:image/png;base64,");
  });
});
