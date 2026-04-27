import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTEXT_PACK_SCHEMA,
  createContextPackDraft,
  isPlanningComplete,
  readApprovedContextPack,
  readApprovedExecutionLaunchHint,
  readPlanningArtifacts,
} from '../artifacts.js';

let tempDir: string;

async function setup(): Promise<void> {
  tempDir = await mkdtemp(join(tmpdir(), 'omx-planning-artifacts-'));
}

async function cleanup(): Promise<void> {
  if (tempDir && existsSync(tempDir)) {
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe('planning artifacts', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await cleanup(); });

  it('requires both PRD and test spec for planning completion', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    await mkdir(plansDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-issue-827.md'), '# PRD\n');

    const artifacts = readPlanningArtifacts(tempDir);
    assert.equal(isPlanningComplete(artifacts), false);
    assert.equal(artifacts.prdPaths.length, 1);
    assert.equal(artifacts.testSpecPaths.length, 0);
  });

  it('parses $ralph aliases with single-quoted task text for approved launch hints', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(
      join(plansDir, 'prd-issue-1072.md'),
      "# PRD\n\nLaunch via $ralph 'Execute approved issue 1072 plan'\n",
    );
    await writeFile(join(plansDir, 'test-spec-issue-1072.md'), '# Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-issue-1072.md'), '# Deep Interview Spec\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'ralph');
    assert.ok(hint);
    assert.equal(hint?.command, "$ralph 'Execute approved issue 1072 plan'");
    assert.equal(hint?.task, 'Execute approved issue 1072 plan');
    assert.equal(hint?.sourcePath, join(plansDir, 'prd-issue-1072.md'));
    assert.deepEqual(hint?.testSpecPaths, [join(plansDir, 'test-spec-issue-1072.md')]);
    assert.deepEqual(hint?.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-issue-1072.md')]);
  });

  it('includes approved Ralph launch context with test and deep-interview artifacts', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(
      join(plansDir, 'prd-issue-1072.md'),
      '# PRD\n\nLaunch via omx ralph "Execute approved issue 1072 plan"\n',
    );
    await writeFile(join(plansDir, 'test-spec-issue-1072.md'), '# Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-issue-1072.md'), '# Deep Interview Spec\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'ralph');
    assert.ok(hint);
    assert.equal(hint?.task, 'Execute approved issue 1072 plan');
    assert.equal(hint?.sourcePath, join(plansDir, 'prd-issue-1072.md'));
    assert.deepEqual(hint?.testSpecPaths, [join(plansDir, 'test-spec-issue-1072.md')]);
    assert.deepEqual(hint?.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-issue-1072.md')]);
  });

  it('parses $team aliases with single-quoted task text for approved launch hints', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(
      join(plansDir, 'prd-issue-1142.md'),
      "# PRD\n\nLaunch via $team ralph 4:debugger 'Execute approved issue 1142 plan'\n",
    );
    await writeFile(join(plansDir, 'test-spec-issue-1142.md'), '# Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-issue-1142.md'), '# Deep Interview Spec\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'team');
    assert.ok(hint);
    assert.equal(hint?.command, "$team ralph 4:debugger 'Execute approved issue 1142 plan'");
    assert.equal(hint?.task, 'Execute approved issue 1142 plan');
    assert.equal(hint?.workerCount, 4);
    assert.equal(hint?.agentType, 'debugger');
    assert.equal(hint?.linkedRalph, true);
    assert.equal(hint?.sourcePath, join(plansDir, 'prd-issue-1142.md'));
    assert.deepEqual(hint?.testSpecPaths, [join(plansDir, 'test-spec-issue-1142.md')]);
    assert.deepEqual(hint?.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-issue-1142.md')]);
  });

  it('includes approved team launch context with staffing and matching artifacts', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(
      join(plansDir, 'prd-issue-1142.md'),
      '# PRD\n\nLaunch via omx team ralph 4:debugger "Execute approved issue 1142 plan"\n',
    );
    await writeFile(join(plansDir, 'test-spec-issue-1142.md'), '# Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-issue-1142.md'), '# Deep Interview Spec\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'team');
    assert.ok(hint);
    assert.equal(hint?.task, 'Execute approved issue 1142 plan');
    assert.equal(hint?.workerCount, 4);
    assert.equal(hint?.agentType, 'debugger');
    assert.equal(hint?.linkedRalph, true);
    assert.equal(hint?.sourcePath, join(plansDir, 'prd-issue-1142.md'));
    assert.deepEqual(hint?.testSpecPaths, [join(plansDir, 'test-spec-issue-1142.md')]);
    assert.deepEqual(hint?.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-issue-1142.md')]);
  });

  it('binds approved team handoff context to the selected PRD slug in multi-plan repos', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-alpha.md'), '# Alpha\n\nLaunch via omx team 2:executor "Execute alpha"\n');
    await writeFile(join(plansDir, 'test-spec-alpha.md'), '# Alpha Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-alpha.md'), '# Alpha Deep Interview\n');
    await writeFile(join(plansDir, 'prd-zeta.md'), '# Zeta\n\nLaunch via omx team 5 "Execute zeta"\n');
    await writeFile(join(plansDir, 'test-spec-zeta.md'), '# Zeta Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-zeta.md'), '# Zeta Deep Interview\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'team');
    assert.ok(hint);
    assert.equal(hint?.task, 'Execute zeta');
    assert.equal(hint?.workerCount, 5);
    assert.equal(hint?.agentType, undefined);
    assert.equal(hint?.sourcePath, join(plansDir, 'prd-zeta.md'));
    assert.deepEqual(hint?.testSpecPaths, [join(plansDir, 'test-spec-zeta.md')]);
    assert.deepEqual(hint?.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-zeta.md')]);
  });

  it('binds approved handoff context to the selected PRD slug in multi-plan repos', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-alpha.md'), '# Alpha\n\nLaunch via omx ralph "Execute alpha"\n');
    await writeFile(join(plansDir, 'test-spec-alpha.md'), '# Alpha Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-alpha.md'), '# Alpha Deep Interview\n');
    await writeFile(join(plansDir, 'prd-zeta.md'), '# Zeta\n\nLaunch via omx ralph "Execute zeta"\n');
    await writeFile(join(plansDir, 'test-spec-zeta.md'), '# Zeta Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-zeta.md'), '# Zeta Deep Interview\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'ralph');
    assert.ok(hint);
    assert.equal(hint?.task, 'Execute zeta');
    assert.equal(hint?.sourcePath, join(plansDir, 'prd-zeta.md'));
    assert.deepEqual(hint?.testSpecPaths, [join(plansDir, 'test-spec-zeta.md')]);
    assert.deepEqual(hint?.deepInterviewSpecPaths, [join(specsDir, 'deep-interview-zeta.md')]);
  });

  it('validates a context pack with matching approved PRD/test-spec basis', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const contextDir = join(tempDir, '.omx', 'context');
    await mkdir(plansDir, { recursive: true });
    await mkdir(contextDir, { recursive: true });
    const prdPath = join(plansDir, 'prd-issue-1970.md');
    const testSpecPath = join(plansDir, 'test-spec-issue-1970.md');
    await writeFile(prdPath, '# PRD\n\nLaunch via omx ralph "Execute issue 1970"\n');
    await writeFile(testSpecPath, '# Test Spec\n');

    const draft = createContextPackDraft(tempDir, [
      { path: 'docs/context-packs.md', roles: ['scope'] },
      { path: 'src/planning/artifacts.ts', roles: ['build'], selector: { type: 'lines', start: 1, end: 80 } },
      { path: 'src/planning/__tests__/artifacts.test.ts', roles: ['verify'] },
    ], { slug: 'issue-1970' });
    assert.ok(draft);
    await writeFile(join(contextDir, 'context-issue-1970.json'), JSON.stringify(draft, null, 2));

    const hint = readApprovedExecutionLaunchHint(tempDir, 'ralph');
    assert.ok(hint);
    const result = readApprovedContextPack(tempDir, hint);
    assert.equal(result.status, 'valid');
    assert.equal(result.status === 'valid' ? result.contextPack.pack.schema : null, CONTEXT_PACK_SCHEMA);
    assert.deepEqual(
      result.status === 'valid' ? result.contextPack.pack.entries.map((entry) => entry.roles.join(',')) : [],
      ['scope', 'build', 'verify'],
    );
  });

  it('rejects context packs with stale approved PRD basis hashes', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const contextDir = join(tempDir, '.omx', 'context');
    await mkdir(plansDir, { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-issue-1970.md'), '# PRD v1\n\nLaunch via omx ralph "Execute issue 1970"\n');
    await writeFile(join(plansDir, 'test-spec-issue-1970.md'), '# Test Spec\n');
    const draft = createContextPackDraft(tempDir, [
      { path: 'src/planning/artifacts.ts', roles: ['build'] },
    ], { slug: 'issue-1970' });
    assert.ok(draft);
    await writeFile(join(contextDir, 'context-issue-1970.json'), JSON.stringify(draft, null, 2));
    await writeFile(join(plansDir, 'prd-issue-1970.md'), '# PRD v2\n\nLaunch via omx ralph "Execute issue 1970"\n');

    const hint = readApprovedExecutionLaunchHint(tempDir, 'ralph');
    assert.ok(hint);
    const result = readApprovedContextPack(tempDir, hint);
    assert.equal(result.status, 'stale');
    assert.match(result.status === 'stale' ? result.errors.join('\n') : '', /basis\.prd/);
  });

  it('rejects malformed context pack entries and line selectors', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const contextDir = join(tempDir, '.omx', 'context');
    await mkdir(plansDir, { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-issue-1970.md'), '# PRD\n\nLaunch via omx ralph "Execute issue 1970"\n');
    await writeFile(join(plansDir, 'test-spec-issue-1970.md'), '# Test Spec\n');
    const draft = createContextPackDraft(tempDir, [
      { path: 'src/planning/artifacts.ts', roles: ['build'] },
    ], { slug: 'issue-1970' });
    assert.ok(draft);
    await writeFile(join(contextDir, 'context-issue-1970.json'), JSON.stringify({
      ...draft,
      entries: [
        { path: '', roles: ['scope'] },
        { path: 'src/planning/artifacts.ts', roles: ['magic'] },
        { path: 'src/cli/ralph.ts', roles: ['build'], selector: { type: 'lines', start: 10, end: 2 } },
      ],
    }, null, 2));

    const hint = readApprovedExecutionLaunchHint(tempDir, 'ralph');
    assert.ok(hint);
    const result = readApprovedContextPack(tempDir, hint);
    assert.equal(result.status, 'malformed');
    const errors = result.status === 'malformed' ? result.errors.join('\n') : '';
    assert.match(errors, /path must be a non-empty string/);
    assert.match(errors, /invalid role/);
    assert.match(errors, /start\/end/);
  });

  it('does not discover context packs without an approved handoff context', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const contextDir = join(tempDir, '.omx', 'context');
    await mkdir(plansDir, { recursive: true });
    await mkdir(contextDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-issue-1970.md'), '# PRD without launch hint\n');
    await writeFile(join(plansDir, 'test-spec-issue-1970.md'), '# Test Spec\n');
    const draft = createContextPackDraft(tempDir, [
      { path: 'src/planning/artifacts.ts', roles: ['build'] },
    ], { slug: 'issue-1970' });
    assert.ok(draft);
    await writeFile(join(contextDir, 'context-issue-1970.json'), JSON.stringify(draft, null, 2));

    assert.equal(readApprovedExecutionLaunchHint(tempDir, 'ralph'), null);
    assert.equal(readApprovedExecutionLaunchHint(tempDir, 'team'), null);
  });

  it('surfaces deep-interview specs for downstream traceability', async () => {
    const plansDir = join(tempDir, '.omx', 'plans');
    const specsDir = join(tempDir, '.omx', 'specs');
    await mkdir(plansDir, { recursive: true });
    await mkdir(specsDir, { recursive: true });
    await writeFile(join(plansDir, 'prd-issue-827.md'), '# PRD\n');
    await writeFile(join(plansDir, 'test-spec-issue-827.md'), '# Test Spec\n');
    await writeFile(join(specsDir, 'deep-interview-issue-827.md'), '# Deep Interview Spec\n');

    const artifacts = readPlanningArtifacts(tempDir);
    assert.equal(isPlanningComplete(artifacts), true);
    assert.deepEqual(
      artifacts.deepInterviewSpecPaths.map((file) => file.split('/').pop()),
      ['deep-interview-issue-827.md'],
    );
  });
});
