import { describe, expect, it } from "vitest";
import { capCodePoints, plainText } from "@/server/assistant/text";

describe("plainText", () => {
  it("strips markup, links and invisible characters", () => {
    expect(plainText("## 好的\n**周四** 可以 `取` <script>x</script>[这里](https://a.b) www.evil.com​", 400)).toBe(
      "好的\n周四 可以 取 x这里",
    );
    expect(plainText("- 红豆包\n- 奶酪角", 400)).toBe("· 红豆包\n· 奶酪角");
  });

  it("caps by code points without splitting emoji", () => {
    expect(capCodePoints("🐰🐰🐰", 2)).toBe("🐰🐰");
    expect([...plainText("🐰".repeat(500), 400)]).toHaveLength(400);
  });
});
