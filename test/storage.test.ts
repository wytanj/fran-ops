import { expect, test } from "bun:test";
import {
  assertContextpackRelativePath,
  assertNoBlobPayload,
  buildWarmPackMarkdown,
  placeholderColdUri,
  warmWaPackPath,
} from "../src/storage.ts";

test("assertContextpackRelativePath accepts warm paths and rejects escapes", () => {
  expect(assertContextpackRelativePath("contextpacks/wa/x.md")).toBe("contextpacks/wa/x.md");
  expect(() => assertContextpackRelativePath("/abs/path.md")).toThrow();
  expect(() => assertContextpackRelativePath("contextpacks/../secret.md")).toThrow();
  expect(() => assertContextpackRelativePath("tmp/out.md")).toThrow();
});

test("warmWaPackPath builds dated relative path", () => {
  const path = warmWaPackPath(new Date(Date.UTC(2026, 9, 1)), "chat-msg-1");
  expect(path).toBe("contextpacks/wa/2026/10/01/chat-msg-1.md");
});

test("assertNoBlobPayload rejects embedded bytes", () => {
  expect(() => assertNoBlobPayload({})).not.toThrow();
  expect(() => assertNoBlobPayload({ notes: "ok" })).not.toThrow();
  expect(() => assertNoBlobPayload({ bytes: new Uint8Array([1]) })).toThrow(/bytes/);
  expect(() => assertNoBlobPayload({ contentBase64: "aaa" })).toThrow(/contentBase64/);
});

test("buildWarmPackMarkdown returns short markdown with pointers", () => {
  const md = buildWarmPackMarkdown({
    title: "Sample",
    summary: "One line.",
    pointers: [{ label: "cold", uri: "drive://PENDING/whatsapp/x" }],
  });
  expect(md).toContain("# Sample");
  expect(md).toContain("One line.");
  expect(md).toContain("[cold](drive://PENDING/whatsapp/x)");
});

test("placeholderColdUri is drive PENDING shape", () => {
  expect(placeholderColdUri("whatsapp", "a/b")).toBe("drive://PENDING/whatsapp/a%2Fb");
});