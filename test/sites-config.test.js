import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const configFiles = ["config/sites.json", "config/sites.example.json"];
const retiredHost = "blog.sportmassagefuengirola.com";

test("site configs exclude retired Sport Massage WordPress settings and keep Samuel", () => {
  for (const configFile of configFiles) {
    const config = JSON.parse(readFileSync(new URL(`../${configFile}`, import.meta.url), "utf8"));

    assert.ok(Array.isArray(config.sites), `${configFile} must contain a sites array`);
    assert.equal(config.sites.some((site) => site.id === "sportmassage"), false, `${configFile} must not configure Sport Massage`);
    assert.equal(JSON.stringify(config).includes(retiredHost), false, `${configFile} must not reference the retired WordPress host`);
    assert.ok(config.sites.some((site) => site.id === "samuel-coach"), `${configFile} must keep Samuel available`);
  }
});
