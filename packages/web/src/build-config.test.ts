import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageConfig {
  scripts?: Record<string, string>;
}

const packageConfig: PackageConfig = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

describe("production build configuration", () => {
  it("uses webpack for the build consumed by OpenNext", () => {
    expect(packageConfig.scripts?.build).toBe("next build --webpack");
  });
});
