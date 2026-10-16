import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "config", "sites.json"), "utf8"));

test("Web Fuengirola is available as a local static blog", () => {
  const site = config.sites.find((entry) => entry.id === "web-fuengirola");

  assert.deepEqual(site, {
    id: "web-fuengirola",
    name: "Web Fuengirola",
    root: "/Users/sam/Desktop/webs/web fuengirola",
    baseUrl: "https://webfuengirola.com",
    postsDirectory: "blog",
    imageDirectory: "img/blog",
    siteAuditCommand: "npm run test:unit",
    templatePost: "diseno-web-para-negocio-local-en-fuengirola",
    aliases: {},
  });
});
