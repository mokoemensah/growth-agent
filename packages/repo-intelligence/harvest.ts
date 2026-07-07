import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import type { RepoSnapshot } from "./types.js";

const MAX_README = 3_500;
const MAX_MANIFEST = 1_500;
const MAX_PATHS = 60;

interface GhRepoMeta {
  description: string | null;
  primaryLanguage: string | null;
  repositoryTopics: { name: string }[] | null;
  pushedAt: string | null;
  isArchived: boolean;
}

export interface HarvestFallback {
  description?: string | null;
  laymanPitch?: string | null;
  docsRoot?: string;
}

function ghJson<T>(args: string): T {
  const raw = execSync(`gh ${args}`, { encoding: "utf-8", maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(raw) as T;
}

function decodeReadme(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

function clip(text: string | null, max: number): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function hashSnapshot(parts: string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
}

function loadLocalDocs(slug: string, docsRoot: string): string | null {
  const dir = join(docsRoot, "docs", "products", slug);
  if (!existsSync(dir)) return null;

  const files = ["OFFER.md", "ICP.md", "PLAYBOOK.md", "VOICE.md"];
  const chunks: string[] = [];
  for (const file of files) {
    const path = join(dir, file);
    if (existsSync(path)) {
      chunks.push(`## ${file}\n${readFileSync(path, "utf-8")}`);
    }
  }
  return chunks.length > 0 ? clip(chunks.join("\n\n"), MAX_README) : null;
}

export function harvestRepoFromDocs(
  repo: string,
  slug: string,
  name: string,
  fallback: HarvestFallback,
): RepoSnapshot {
  const readmeExcerpt =
    loadLocalDocs(slug, fallback.docsRoot ?? process.cwd()) ??
    clip(fallback.laymanPitch ?? fallback.description ?? null, MAX_README);

  const snapshotHash = hashSnapshot([
    repo,
    fallback.description ?? "",
    readmeExcerpt ?? "",
    "local-docs-fallback",
  ]);

  return {
    repo,
    slug,
    name,
    description: fallback.description ?? null,
    primaryLanguage: null,
    topics: [],
    isArchived: false,
    pushedAt: null,
    readmeExcerpt,
    manifestExcerpt: null,
    filePaths: [],
    snapshotHash,
  };
}

export function harvestRepo(
  repo: string,
  slug: string,
  name: string,
  fallback?: HarvestFallback,
): RepoSnapshot {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(`Invalid repo: ${repo}`);
  }

  try {
    const meta = ghJson<GhRepoMeta>(
      `repo view ${repo} --json description,primaryLanguage,repositoryTopics,pushedAt,isArchived`,
    );

    let readmeExcerpt: string | null = null;
    try {
      const readme = ghJson<{ content?: string }>(`api repos/${owner}/${repoName}/readme`);
      if (readme.content) {
        readmeExcerpt = clip(decodeReadme(readme.content), MAX_README);
      }
    } catch {
      readmeExcerpt = null;
    }

    let manifestExcerpt: string | null = null;
    for (const path of ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"]) {
      try {
        const file = ghJson<{ content?: string }>(
          `api repos/${owner}/${repoName}/contents/${path}`,
        );
        if (file.content) {
          manifestExcerpt = clip(decodeReadme(file.content), MAX_MANIFEST);
          break;
        }
      } catch {
        // try next manifest
      }
    }

    let filePaths: string[] = [];
    try {
      const tree = ghJson<{ tree: { path: string; type: string }[] }>(
        `api repos/${owner}/${repoName}/git/trees/HEAD?recursive=1`,
      );
      filePaths = tree.tree
        .filter((n) => n.type === "blob")
        .map((n) => n.path)
        .filter((p) => !p.includes("node_modules/") && !p.startsWith(".git/"))
        .slice(0, MAX_PATHS);
    } catch {
      filePaths = [];
    }

    const snapshotHash = hashSnapshot([
      meta.description ?? "",
      meta.pushedAt ?? "",
      readmeExcerpt ?? "",
      manifestExcerpt ?? "",
      filePaths.join(","),
    ]);

    return {
      repo,
      slug,
      name,
      description: meta.description,
      primaryLanguage: meta.primaryLanguage,
      topics: (meta.repositoryTopics ?? []).map((t) => t.name),
      isArchived: meta.isArchived,
      pushedAt: meta.pushedAt,
      readmeExcerpt,
      manifestExcerpt,
      filePaths,
      snapshotHash,
    };
  } catch {
    if (!fallback) {
      throw new Error(`GitHub repo not found: ${repo}`);
    }
    console.warn(`  ↳ ${repo} not on GitHub yet — using local product docs`);
    return harvestRepoFromDocs(repo, slug, name, fallback);
  }
}
