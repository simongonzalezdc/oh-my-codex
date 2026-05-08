import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

describe("notify-hook non-OMX project guard", () => {
	it("exits without creating .omx artifacts for unmanaged cwd", async () => {
		const wd = await mkdtemp(join(tmpdir(), "omx-notify-unmanaged-"));
		try {
			const payload = JSON.stringify({
				cwd: wd,
				type: "agent-turn-complete",
				"turn-id": "t1",
			});
			const result = spawnSync(
				process.execPath,
				["dist/scripts/notify-hook.js", payload],
				{
					cwd: process.cwd(),
					encoding: "utf-8",
				},
			);
			assert.equal(result.status, 0);
			assert.equal(existsSync(join(wd, ".omx")), false);
		} finally {
			await rm(wd, { recursive: true, force: true });
		}
	});
});
