import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import app from "../src/app.js";

test("health endpoint is public and protected APIs require authentication", async () => {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { ok: boolean }).ok, true);

    const projects = await fetch(`http://127.0.0.1:${port}/api/projects`);
    assert.equal(projects.status, 401);
    assert.equal((await projects.json() as { error: { code: string } }).error.code, "UNAUTHORIZED");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
