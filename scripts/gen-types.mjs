#!/usr/bin/env node
/**
 * Regenerate src/integrations/supabase/types.ts from the linked Supabase
 * project, with graceful fallback to the committed types when:
 *
 *   (a) the `supabase` CLI isn't on PATH (Vercel's build sandbox,
 *       fresh clones that haven't installed it, etc.), or
 *   (b) the CLI is present but the project isn't linked / the user
 *       isn't logged in / the API call fails, or
 *   (c) the CLI runs but returns empty output (would truncate types.ts
 *       if we used naive `>` redirection).
 *
 * This lets the prebuild step be aspirational — refresh when we can,
 * fall back silently otherwise. The committed types.ts is the source of
 * truth for any environment that can't reach Supabase.
 *
 * Cross-platform: no shell redirection, writes UTF-8 explicitly so
 * Windows PowerShell can't reintroduce the UTF-16 corruption that broke
 * the build in earlier sessions.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";

const OUT = "src/integrations/supabase/types.ts";

function log(msg) {
  // Prefix so the message is obvious in Vercel / CI build logs.
  console.log(`[gen-types] ${msg}`);
}

// ---------------------------------------------------------------------
// 1. Is `supabase` on PATH?
// ---------------------------------------------------------------------
const version = spawnSync("supabase", ["--version"], {
  stdio: "ignore",
  shell: process.platform === "win32",
});

if (version.status !== 0) {
  if (existsSync(OUT)) {
    log("supabase CLI not found — using committed types.ts");
    process.exit(0);
  }
  log(
    "supabase CLI not found AND no committed types.ts — cannot proceed.\n" +
      "  Install the CLI (https://supabase.com/docs/guides/cli) and run:\n" +
      "    supabase login\n" +
      "    supabase link --project-ref esycmohgumryeqteiwla"
  );
  process.exit(1);
}

// ---------------------------------------------------------------------
// 2. Try the regen call. Write to memory first so a partial/failed
//    stdout doesn't truncate the file.
// ---------------------------------------------------------------------
const result = spawnSync(
  "supabase",
  ["gen", "types", "typescript", "--linked"],
  {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  }
);

if (result.status !== 0 || !result.stdout || result.stdout.length < 100) {
  // stderr is common here: "project not linked", "unauthenticated",
  // "no access token", etc. Surface it so debugging is possible, but
  // don't fail the build if we have a committed fallback.
  if (result.stderr) {
    log(`supabase gen returned stderr: ${result.stderr.trim().split("\n").pop()}`);
  }
  if (existsSync(OUT)) {
    log("regen skipped — using committed types.ts");
    process.exit(0);
  }
  log("regen failed AND no committed types.ts — cannot proceed.");
  process.exit(1);
}

// ---------------------------------------------------------------------
// 3. Write the fresh types. UTF-8, no BOM.
// ---------------------------------------------------------------------
writeFileSync(OUT, result.stdout, "utf-8");
log(`wrote ${result.stdout.length} bytes to ${OUT}`);
