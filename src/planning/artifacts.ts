import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { omxPlansDir } from '../utils/paths.js';

const PRD_PATTERN = /^prd-.*\.md$/i;
const TEST_SPEC_PATTERN = /^test-?spec-.*\.md$/i;
const DEEP_INTERVIEW_SPEC_PATTERN = /^deep-interview-.*\.md$/i;

export interface PlanningArtifacts {
  plansDir: string;
  specsDir: string;
  prdPaths: string[];
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
}

export interface ApprovedPlanContext {
  sourcePath: string;
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
}

export interface ApprovedExecutionLaunchHint extends ApprovedPlanContext {
  mode: 'team' | 'ralph';
  command: string;
  task: string;
  workerCount?: number;
  agentType?: string;
  linkedRalph?: boolean;
  contextPack?: ValidatedContextPack;
}

export interface LatestPlanningArtifactSelection {
  prdPath: string | null;
  testSpecPaths: string[];
  deepInterviewSpecPaths: string[];
}

export const CONTEXT_PACK_SCHEMA = 'omx-context-pack-v1';
export const CONTEXT_PACK_ROLES = ['scope', 'build', 'verify'] as const;

export type ContextPackRole = (typeof CONTEXT_PACK_ROLES)[number];

export interface ContextPackBasisFile {
  path: string;
  sha1: string;
}

export interface ContextPackBasis {
  prd: ContextPackBasisFile;
  testSpecs: ContextPackBasisFile[];
}

export interface ContextPackLineSelector {
  type: 'lines';
  start: number;
  end: number;
}

export interface ContextPackEntry {
  path: string;
  roles: ContextPackRole[];
  selector?: ContextPackLineSelector;
}

export interface ContextPackArtifact {
  schema: typeof CONTEXT_PACK_SCHEMA;
  slug?: string;
  basis: ContextPackBasis;
  entries: ContextPackEntry[];
}

export interface ValidatedContextPack {
  path: string;
  pack: ContextPackArtifact;
}

export type ContextPackReadResult =
  | { status: 'missing'; reason: string }
  | { status: 'valid'; contextPack: ValidatedContextPack }
  | { status: 'stale'; path: string; errors: string[]; expectedBasis: ContextPackBasis }
  | { status: 'malformed'; path: string; errors: string[] };

function readMatchingPaths(dir: string, pattern: RegExp): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  try {
    return readdirSync(dir)
      .filter((file) => pattern.test(file))
      .sort((a, b) => a.localeCompare(b))
      .map((file) => join(dir, file));
  } catch {
    return [];
  }
}

export function readPlanningArtifacts(cwd: string): PlanningArtifacts {
  const plansDir = omxPlansDir(cwd);
  const specsDir = join(cwd, '.omx', 'specs');

  return {
    plansDir,
    specsDir,
    prdPaths: readMatchingPaths(plansDir, PRD_PATTERN),
    testSpecPaths: readMatchingPaths(plansDir, TEST_SPEC_PATTERN),
    deepInterviewSpecPaths: readMatchingPaths(specsDir, DEEP_INTERVIEW_SPEC_PATTERN),
  };
}

export function isPlanningComplete(artifacts: PlanningArtifacts): boolean {
  return artifacts.prdPaths.length > 0 && artifacts.testSpecPaths.length > 0;
}

function decodeQuotedValue(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) return null;
  try {
    return JSON.parse(normalized) as string;
  } catch {
    if (
      (normalized.startsWith('"') && normalized.endsWith('"'))
      || (normalized.startsWith("'") && normalized.endsWith("'"))
    ) {
      return normalized.slice(1, -1);
    }
    return null;
  }
}

function artifactSlug(path: string, prefixPattern: RegExp): string | null {
  const file = basename(path);
  const match = file.match(prefixPattern);
  return match?.groups?.slug ?? null;
}

function filterArtifactsForSlug(paths: readonly string[], prefixPattern: RegExp, slug: string | null): string[] {
  if (!slug) return [];
  return paths.filter((path) => artifactSlug(path, prefixPattern) === slug);
}

function contextDir(cwd: string): string {
  return join(cwd, '.omx', 'context');
}

function toRepoRelativePath(cwd: string, path: string): string {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
  return relative(cwd, absolutePath).replace(/\\/g, '/');
}

function resolveRepoPath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function sha1File(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex');
}

export function createContextPackBasis(
  cwd: string,
  selection: LatestPlanningArtifactSelection = readLatestPlanningArtifacts(cwd),
): ContextPackBasis | null {
  if (!selection.prdPath) return null;
  if (!existsSync(selection.prdPath)) return null;

  return {
    prd: {
      path: toRepoRelativePath(cwd, selection.prdPath),
      sha1: sha1File(selection.prdPath),
    },
    testSpecs: selection.testSpecPaths
      .filter((path) => existsSync(path))
      .map((path) => ({
        path: toRepoRelativePath(cwd, path),
        sha1: sha1File(path),
      })),
  };
}

export function createContextPackDraft(
  cwd: string,
  entries: ContextPackEntry[],
  options: { slug?: string; selection?: LatestPlanningArtifactSelection } = {},
): ContextPackArtifact | null {
  const basis = createContextPackBasis(cwd, options.selection ?? readLatestPlanningArtifacts(cwd));
  if (!basis) return null;
  return {
    schema: CONTEXT_PACK_SCHEMA,
    ...(options.slug ? { slug: options.slug } : {}),
    basis,
    entries,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function validateSha1(value: unknown, field: string, errors: string[]): value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) {
    errors.push(`${field} must be a SHA-1 hex digest`);
    return false;
  }
  return true;
}

function validateBasisFile(value: unknown, field: string, errors: string[]): ContextPackBasisFile | null {
  if (!isRecord(value)) {
    errors.push(`${field} must be an object`);
    return null;
  }
  const path = value.path;
  const sha1 = value.sha1;
  if (typeof path !== 'string' || path.trim() === '') {
    errors.push(`${field}.path must be a non-empty string`);
  }
  validateSha1(sha1, `${field}.sha1`, errors);
  if (typeof path !== 'string' || path.trim() === '' || typeof sha1 !== 'string') return null;
  return { path, sha1 };
}

function validateContextPackShape(value: unknown): { pack: ContextPackArtifact | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { pack: null, errors: ['context pack must be a JSON object'] };

  if (value.schema !== CONTEXT_PACK_SCHEMA) {
    errors.push(`schema must be ${CONTEXT_PACK_SCHEMA}`);
  }
  if (value.slug != null && (typeof value.slug !== 'string' || value.slug.trim() === '')) {
    errors.push('slug must be a non-empty string when present');
  }

  const basisValue = value.basis;
  let basis: ContextPackBasis | null = null;
  if (!isRecord(basisValue)) {
    errors.push('basis must be an object');
  } else {
    const prd = validateBasisFile(basisValue.prd, 'basis.prd', errors);
    const testSpecsValue = basisValue.testSpecs;
    const testSpecs: ContextPackBasisFile[] = [];
    if (!Array.isArray(testSpecsValue)) {
      errors.push('basis.testSpecs must be an array');
    } else {
      for (const [index, spec] of testSpecsValue.entries()) {
        const parsed = validateBasisFile(spec, `basis.testSpecs[${index}]`, errors);
        if (parsed) testSpecs.push(parsed);
      }
    }
    if (prd && Array.isArray(testSpecsValue)) basis = { prd, testSpecs };
  }

  const entriesValue = value.entries;
  const entries: ContextPackEntry[] = [];
  if (!Array.isArray(entriesValue) || entriesValue.length === 0) {
    errors.push('entries must be a non-empty array');
  } else {
    const allowedRoles = new Set<string>(CONTEXT_PACK_ROLES);
    for (const [index, entryValue] of entriesValue.entries()) {
      if (!isRecord(entryValue)) {
        errors.push(`entries[${index}] must be an object`);
        continue;
      }
      const path = entryValue.path;
      if (typeof path !== 'string' || path.trim() === '') {
        errors.push(`entries[${index}].path must be a non-empty string`);
      }
      const rolesValue = entryValue.roles;
      const roles: ContextPackRole[] = [];
      if (!Array.isArray(rolesValue) || rolesValue.length === 0) {
        errors.push(`entries[${index}].roles must be a non-empty array`);
      } else {
        for (const role of rolesValue) {
          if (typeof role !== 'string' || !allowedRoles.has(role)) {
            errors.push(`entries[${index}].roles contains invalid role ${JSON.stringify(role)}`);
          } else if (!roles.includes(role as ContextPackRole)) {
            roles.push(role as ContextPackRole);
          }
        }
      }

      let selector: ContextPackLineSelector | undefined;
      if (entryValue.selector != null) {
        if (!isRecord(entryValue.selector)) {
          errors.push(`entries[${index}].selector must be an object`);
        } else if (entryValue.selector.type !== 'lines') {
          errors.push(`entries[${index}].selector.type must be lines`);
        } else {
          const start = entryValue.selector.start;
          const end = entryValue.selector.end;
          if (typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
            errors.push(`entries[${index}].selector lines must use integer start/end with 1 <= start <= end`);
          } else {
            selector = { type: 'lines', start, end };
          }
        }
      }

      if (typeof path === 'string' && path.trim() !== '' && roles.length > 0) {
        entries.push({ path, roles, ...(selector ? { selector } : {}) });
      }
    }
  }

  if (errors.length > 0 || !basis || value.schema !== CONTEXT_PACK_SCHEMA) {
    return { pack: null, errors };
  }

  return {
    pack: {
      schema: CONTEXT_PACK_SCHEMA,
      ...(typeof value.slug === 'string' ? { slug: value.slug } : {}),
      basis,
      entries,
    },
    errors,
  };
}

function basisFileMatches(cwd: string, actual: ContextPackBasisFile, expected: ContextPackBasisFile): boolean {
  return resolveRepoPath(cwd, actual.path) === resolveRepoPath(cwd, expected.path)
    && actual.sha1.toLowerCase() === expected.sha1.toLowerCase();
}

function basisPathsMatch(cwd: string, actual: ContextPackBasis, expected: ContextPackBasis): boolean {
  if (resolveRepoPath(cwd, actual.prd.path) !== resolveRepoPath(cwd, expected.prd.path)) return false;
  if (actual.testSpecs.length !== expected.testSpecs.length) return false;
  return actual.testSpecs.every((actualSpec, index) => (
    resolveRepoPath(cwd, actualSpec.path) === resolveRepoPath(cwd, expected.testSpecs[index]?.path ?? '')
  ));
}

function validateBasisFreshness(cwd: string, actual: ContextPackBasis, expected: ContextPackBasis): string[] {
  const errors: string[] = [];
  if (!basisFileMatches(cwd, actual.prd, expected.prd)) {
    errors.push(`basis.prd is stale or does not match ${expected.prd.path}`);
  }
  if (actual.testSpecs.length !== expected.testSpecs.length) {
    errors.push(`basis.testSpecs length ${actual.testSpecs.length} does not match expected ${expected.testSpecs.length}`);
  }
  for (const [index, expectedSpec] of expected.testSpecs.entries()) {
    const actualSpec = actual.testSpecs[index];
    if (!actualSpec || !basisFileMatches(cwd, actualSpec, expectedSpec)) {
      errors.push(`basis.testSpecs[${index}] is stale or does not match ${expectedSpec.path}`);
    }
  }
  return errors;
}

function readContextPackJson(path: string): { pack: ContextPackArtifact | null; errors: string[] } {
  try {
    return validateContextPackShape(JSON.parse(readFileSync(path, 'utf-8')) as unknown);
  } catch (error) {
    return { pack: null, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

export function readApprovedContextPack(cwd: string, approvedContext: ApprovedPlanContext): ContextPackReadResult {
  const expectedBasis = createContextPackBasis(cwd, {
    prdPath: approvedContext.sourcePath,
    testSpecPaths: approvedContext.testSpecPaths,
    deepInterviewSpecPaths: approvedContext.deepInterviewSpecPaths,
  });
  if (!expectedBasis) return { status: 'missing', reason: 'approved planning basis is incomplete' };

  const dir = contextDir(cwd);
  if (!existsSync(dir)) return { status: 'missing', reason: '.omx/context does not exist' };

  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a))
      .map((file) => join(dir, file));
  } catch {
    return { status: 'missing', reason: '.omx/context is not readable' };
  }

  for (const path of files) {
    const { pack, errors } = readContextPackJson(path);
    if (!pack) return { status: 'malformed', path, errors };
    if (!basisPathsMatch(cwd, pack.basis, expectedBasis)) continue;
    const staleErrors = validateBasisFreshness(cwd, pack.basis, expectedBasis);
    if (staleErrors.length > 0) return { status: 'stale', path, errors: staleErrors, expectedBasis };
    return { status: 'valid', contextPack: { path, pack } };
  }

  return { status: 'missing', reason: 'no context pack matches the approved planning basis' };
}

function readApprovedPlanText(cwd: string): { content: string; context: ApprovedPlanContext } | null {
  const artifacts = readPlanningArtifacts(cwd);
  if (!isPlanningComplete(artifacts)) return null;

  const selection = selectLatestPlanningArtifacts(artifacts);
  const latestPrdPath = selection.prdPath;
  if (!latestPrdPath || !existsSync(latestPrdPath)) return null;

  try {
    return {
      content: readFileSync(latestPrdPath, 'utf-8'),
      context: {
        sourcePath: latestPrdPath,
        testSpecPaths: selection.testSpecPaths,
        deepInterviewSpecPaths: selection.deepInterviewSpecPaths,
      },
    };
  } catch {
    return null;
  }
}

export function selectLatestPlanningArtifacts(
  artifacts: PlanningArtifacts,
): LatestPlanningArtifactSelection {
  const latestPrdPath = artifacts.prdPaths.at(-1) ?? null;
  const slug = latestPrdPath
    ? artifactSlug(latestPrdPath, /^prd-(?<slug>.*)\.md$/i)
    : null;

  return {
    prdPath: latestPrdPath,
    testSpecPaths: filterArtifactsForSlug(
      artifacts.testSpecPaths,
      /^test-?spec-(?<slug>.*)\.md$/i,
      slug,
    ),
    deepInterviewSpecPaths: filterArtifactsForSlug(
      artifacts.deepInterviewSpecPaths,
      /^deep-interview-(?<slug>.*)\.md$/i,
      slug,
    ),
  };
}

export function readLatestPlanningArtifacts(cwd: string): LatestPlanningArtifactSelection {
  return selectLatestPlanningArtifacts(readPlanningArtifacts(cwd));
}

export function readApprovedExecutionLaunchHint(
  cwd: string,
  mode: 'team' | 'ralph',
): ApprovedExecutionLaunchHint | null {
  const approvedPlan = readApprovedPlanText(cwd);
  if (!approvedPlan) return null;

  if (mode === 'team') {
    const teamPattern = /(?<command>(?:omx\s+team|\$team)\s+(?<ralph>ralph\s+)?(?<count>\d+)(?::(?<role>[a-z][a-z0-9-]*))?\s+(?<task>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))/gi;
    const matches = [...approvedPlan.content.matchAll(teamPattern)];
    const last = matches.at(-1);
    if (!last?.groups) return null;
    const task = decodeQuotedValue(last.groups.task);
    if (!task) return null;
    return {
      mode,
      command: last.groups.command,
      task,
      workerCount: Number.parseInt(last.groups.count, 10),
      agentType: last.groups.role || undefined,
      linkedRalph: Boolean(last.groups.ralph?.trim()),
      ...approvedPlan.context,
    };
  }

  const ralphPattern = /(?<command>(?:omx\s+ralph|\$ralph)\s+(?<task>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))/gi;
  const matches = [...approvedPlan.content.matchAll(ralphPattern)];
  const last = matches.at(-1);
  if (!last?.groups) return null;
  const task = decodeQuotedValue(last.groups.task);
  if (!task) return null;
  return {
    mode,
    command: last.groups.command,
    task,
    ...approvedPlan.context,
  };
}
