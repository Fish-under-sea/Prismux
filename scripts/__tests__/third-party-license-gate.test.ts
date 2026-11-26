import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

import {
  auditLicenseConfigFile,
  evaluateRuntimePackageLicense,
  scanWorkspaceRuntimeLicenses,
} from "../lib/third-party-license-gate.ts";

const { describe, it } = NodeTest;
const assert = NodeAssert;

const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");

describe("third-party-license-gate", () => {
  it("verifies every local noticeFile path in third-party-licenses.config.json exists with zero dead apps/mobile/* paths", () => {
    const audit = auditLicenseConfigFile(REPO_ROOT);
    assert.ok(audit.checkedPaths.length >= 5, "Expected at least 5 configured local noticeFile paths");
    assert.deepEqual(audit.mobilePathRefs, [], `Found dead apps/mobile/* notice paths: ${audit.mobilePathRefs.join(", ")}`);
    assert.deepEqual(
      audit.missingPaths,
      [],
      `Found missing local noticeFile paths in third-party-licenses.config.json: ${audit.missingPaths.join(", ")}`,
    );
    const anthropicCarveOut = audit.proprietaryCarveOuts.find(
      (entry) => entry.name === "@anthropic-ai/claude-agent-sdk",
    );
    assert.ok(anthropicCarveOut, "third-party-licenses.config.json must declare @anthropic-ai/claude-agent-sdk proprietaryCarveOut");
    assert.match(anthropicCarveOut.legalTermsUrl, /code\.claude\.com\/docs\/en\/legal-and-compliance/);
    assert.match(anthropicCarveOut.copyright, /Anthropic PBC/);
  });

  it("rejects GPL, AGPL, LGPL, SSPL, heic-to, sharp, and undeclared proprietary runtime licenses while allowing dual-license permissive elections and documented carve-outs", () => {
    const allowlist = new Set(["@anthropic-ai/claude-agent-sdk"]);

    // Forbidden licenses & packages must fail closed
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "heic-to",
        license: "LGPL-3.0-or-later",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "sharp",
        license: "Apache-2.0 AND LGPL-3.0-or-later",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "gpl-pkg",
        license: "GPL-3.0-only",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "agpl-pkg",
        license: "AGPL-3.0-or-later",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "lgpl-pkg",
        license: "LGPL-2.1-only",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "sspl-pkg",
        license: "SSPL-1.0",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "mixed-copyleft-pkg",
        license: "MIT AND LGPL-3.0-or-later",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "undeclared-closed-sdk",
        license: "SEE LICENSE IN LICENSE.md",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );
    assert.ok(
      evaluateRuntimePackageLicense({
        packageName: "unlicensed-pkg",
        license: "UNLICENSED",
        proprietaryAllowlist: allowlist,
      }) !== null,
    );

    // Permissive licenses, dual-license permissive elections, and documented Anthropic carve-out pass
    assert.equal(
      evaluateRuntimePackageLicense({
        packageName: "jszip",
        license: "(MIT OR GPL-3.0-or-later)",
        overrideLicense: "MIT",
        proprietaryAllowlist: allowlist,
      }),
      null,
    );
    assert.equal(
      evaluateRuntimePackageLicense({
        packageName: "dompurify",
        license: "(MPL-2.0 OR Apache-2.0)",
        overrideLicense: "Apache-2.0",
        proprietaryAllowlist: allowlist,
      }),
      null,
    );
    assert.equal(
      evaluateRuntimePackageLicense({
        packageName: "@anthropic-ai/claude-agent-sdk",
        license: "SEE LICENSE IN README.md",
        proprietaryAllowlist: allowlist,
      }),
      null,
    );
    assert.equal(
      evaluateRuntimePackageLicense({
        packageName: "sqlite-vec",
        license: "MIT OR Apache-2.0",
        proprietaryAllowlist: allowlist,
      }),
      null,
    );
  });

  it("verifies THIRD_PARTY_NOTICES.md contains required proprietary carve-out, @pierre/* NOTICE attributions, 7za.exe LGPL-2.1, sqlite-vec, T3 Code, Cordis, Rust crates, and dual-license choices", () => {
    const notices = NodeFS.readFileSync(NodePath.join(REPO_ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");

    // P0-7 Anthropic proprietary carve-out
    assert.match(notices, /Proprietary Third-Party Component Carve-Out/);
    assert.match(notices, /@anthropic-ai\/claude-agent-sdk/);
    assert.match(notices, /Anthropic PBC\. All rights reserved\./);
    assert.match(notices, /https:\/\/code\.claude\.com\/docs\/en\/legal-and-compliance/);

    // P2-1 @pierre/* Apache-2.0 NOTICE.md attributions
    for (const requiredToken of [
      "@pierre/words",
      "WHATWG HTML",
      "EastAsianWidth.txt",
      "STIX Two Math",
      "@pierre/trees",
      "@headless-tree/core",
      "Lukas Bach",
      "@pierre/highlights",
      "tm-themes@1.12.10",
      "Mattia Astorino",
      "@pierre/patches",
      "jsdiff",
      "Kevin Decker",
      "@pierre/theme",
      "primer/github-vscode-theme",
    ]) {
      assert.ok(
        notices.includes(requiredToken),
        `THIRD_PARTY_NOTICES.md missing required @pierre/* attribution token: ${requiredToken}`,
      );
    }

    // 7za.exe, sqlite-vec, T3 Code, Cordis, Rust crates, dual-license choices & heic-to/sharp policy
    for (const requiredToken of [
      "7za.exe",
      "LGPL-2.1",
      "unRAR",
      "https://www.7-zip.org/",
      "sqlite-vec",
      "vec0.dll",
      "pingdotgg/t3code",
      "shigma/cordis",
      "sysinfo",
      "zbus",
      "wayland-client",
      "smithay-client-toolkit",
      "serde_json",
      "jszip",
      "dompurify",
      "sharp",
      "heic-to",
    ]) {
      assert.ok(
        notices.includes(requiredToken),
        `THIRD_PARTY_NOTICES.md missing required attribution token: ${requiredToken}`,
      );
    }
  });

  it("scans live workspace apps/*/package.json and packages/*/package.json production dependencies for blacklisted licenses", () => {
    const report = scanWorkspaceRuntimeLicenses(REPO_ROOT);
    assert.ok(report.scannedManifests.length >= 4, "Expected to scan apps/* and packages/* manifests");
    assert.ok(report.scannedPackages > 0, "Expected to scan resolved production packages");
    assert.deepEqual(
      report.violations,
      [],
      `Detected forbidden runtime license/package violations:\n${report.violations
        .map((v) => `- ${v.packageName}@${v.version} [${v.license}] in ${v.declaredIn}: ${v.reason}`)
        .join("\n")}`,
    );
  });
});
