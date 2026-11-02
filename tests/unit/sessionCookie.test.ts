import { describe, expect, it } from "vitest";
import { cookieIsSecure } from "@/server/session";

describe("cookieIsSecure", () => {
  it("is Secure in production and on https, as before", () => {
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "https://bunbunnybakes.shop" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "development", siteUrl: "https://example.test" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://192.168.1.121:3181" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "development", siteUrl: "http://localhost:3000" })).toBe(false);
  });

  it("QA flag drops Secure only for a plain-http LAN site", () => {
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://192.168.1.121:3181", qaInsecure: "1" })).toBe(false);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://10.0.0.5:3181", qaInsecure: "1" })).toBe(false);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://172.20.1.2", qaInsecure: "1" })).toBe(false);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://localhost:3180", qaInsecure: "1" })).toBe(false);
  });

  it("QA flag set by mistake never weakens an https or public site", () => {
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "https://bunbunnybakes.shop", qaInsecure: "1" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://bunbunnybakes.shop", qaInsecure: "1" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://8.8.8.8", qaInsecure: "1" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://172.32.0.1", qaInsecure: "1" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: undefined, qaInsecure: "1" })).toBe(true);
    expect(cookieIsSecure({ nodeEnv: "production", siteUrl: "http://192.168.1.121:3181", qaInsecure: "true" })).toBe(true);
  });
});
