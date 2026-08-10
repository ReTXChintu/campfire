#!/usr/bin/env node
// release-it's after:bump hook (see .release-it.json) runs `npm version --workspaces` to sync
// apps/backend and apps/frontend's package.json — that command only touches npm workspaces, so
// apps/mobile/pubspec.yaml (not an npm package) needs its version line rewritten separately here.
// Keeps the Flutter build number ("+N") untouched — only the version-name part before "+" changes,
// since the build number is a monotonically-increasing counter, not something a release-name bump
// should reset.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const version = process.argv[2];
if (!version) {
  console.error("Usage: sync-mobile-version.mjs <version>");
  process.exit(1);
}

const pubspecPath = join(dirname(fileURLToPath(import.meta.url)), "..", "apps/mobile/pubspec.yaml");
const pubspec = readFileSync(pubspecPath, "utf-8");

const versionLine = /^version:\s*.+$/m;
if (!versionLine.test(pubspec)) {
  console.error(`No "version:" line found in ${pubspecPath}`);
  process.exit(1);
}

const updated = pubspec.replace(versionLine, (line) => {
  const buildNumber = line.match(/\+(\d+)/)?.[1] ?? "1";
  return `version: ${version}+${buildNumber}`;
});

writeFileSync(pubspecPath, updated);
console.log(`apps/mobile/pubspec.yaml -> version: ${version}`);
