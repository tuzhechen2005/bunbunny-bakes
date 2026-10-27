import { describe, expect, it } from "vitest";
import { scrubPii } from "@/server/assistant/scrub";

describe("scrubPii", () => {
  it.each([
    ["我的微信是 bunny_2024，周四能取吗", "bunny_2024"],
    ["微信号：wxid_abc123xyz", "wxid_abc123xyz"],
    ["加我 vx: Tom-1999", "Tom-1999"],
    ["my wechat id is alice88", "alice88"],
    ["wechat: abc", "abc"],
    ["电话 608-555-1234 谢谢", "608-555-1234"],
    ["call me at (608) 555 1234", "555 1234"],
    ["手机13812345678", "13812345678"],
    ["+86 138 1234 5678 是我", "1234 5678"],
    ["email me: jane.doe+bread@gmail.com", "jane.doe+bread@gmail.com"],
    ["邮箱 xiao@qq.com", "xiao@qq.com"],
    ["送到 123 N. University Ave Apt 4B 可以吗", "University Ave"],
    ["deliver to 1600 Regent Street, Madison WI 53715", "Regent Street"],
    ["deliver to 1600 Regent Street, Madison WI 53715", "53715"],
    ["地址是大学路123号", "大学路123号"],
    ["幸福小区5栋2单元301室", "301"],
    ["住在12号楼", "12号楼"],
  ])("masks %s", (input, secret) => {
    const out = scrubPii(input);
    expect(out).not.toContain(secret);
    expect(out).toContain("***");
  });

  it.each([
    "周四能取什么？",
    "泡芙怎么订",
    "可以配送吗",
    "我要 2 个奶酥红豆包和 3 个奶酪角，11/5 能取吗",
    "11月5号可以吗",
    "Is delivery available on Thursday?",
    "I want 4 brioche buns please",
    "价格是 $12.99 吗",
    "2026-11-05 有吗",
    "Tell me what bread is on 11/5",
    "Can you tell me 2 options?",
    "一共3座位",
    "周四 12点 取 3 个",
  ])("keeps %s", (input) => {
    expect(scrubPii(input)).toBe(input);
  });

  it.each([
    ["要3个红豆包送到大学路12号", "要3个红豆包送到", "12号"],
    ["我要红豆包3个送到大学路12号可以吗", "我要红豆包3个送到", "12号"],
    ["周四要两个泡芙送到5楼", "周四要两个泡芙送到", "5楼"],
    ["送到幸福小区5栋2单元301室，要4个奶酪角", "要4个奶酪角", "301"],
  ])("keeps the order in %s but masks the address", (input, kept, secret) => {
    const out = scrubPii(input);
    expect(out).toContain(kept);
    expect(out).not.toContain(secret);
    expect(out).toContain("***");
  });

  it("masks full-width digits and ids", () => {
    expect(scrubPii("手机１３８１２３４５６７８")).not.toMatch(/138|１３８/);
    expect(scrubPii("ｂｕｎｎｙ＿２０２４ 是我")).toBe("*** 是我");
    expect(scrubPii("周四能取吗？")).toBe("周四能取吗？");
  });
});
