import { expect, test } from "bun:test";
import {
  assertContextpackRelativePath,
  assertNoBlobPayload,
  buildSupabaseObjectPath,
  buildWarmPackMarkdown,
  DEFAULT_STORAGE_BUCKET,
  mintSignedUrl,
  placeholderSupabaseObjectPath,
  warmWaPackPath,
} from "../src/storage.ts";
import { ingestWaMedia, linkDriveFolderPurpose } from "../src/wacli/ingest.ts";

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

test("assertNoBlobPayload rejects embedded bytes and signed URL fields", () => {
  expect(() => assertNoBlobPayload({})).not.toThrow();
  expect(() => assertNoBlobPayload({ notes: "ok" })).not.toThrow();
  expect(() => assertNoBlobPayload({ bytes: new Uint8Array([1]) })).toThrow(/bytes/);
  expect(() => assertNoBlobPayload({ contentBase64: "aaa" })).toThrow(/contentBase64/);
  expect(() => assertNoBlobPayload({ signed_url: "https://x" })).toThrow(/signed_url/);
  expect(() => assertNoBlobPayload({ signed_url_hint: "https://x" })).toThrow(/signed_url_hint/);
});

test("buildWarmPackMarkdown returns short markdown with pointers", () => {
  const md = buildWarmPackMarkdown({
    title: "Sample",
    summary: "One line.",
    pointers: [{ label: "storage", uri: "supabase://fran-ops-media/pending/whatsapp/x" }],
  });
  expect(md).toContain("# Sample");
  expect(md).toContain("One line.");
  expect(md).toContain("[storage](supabase://fran-ops-media/pending/whatsapp/x)");
});

test("buildSupabaseObjectPath and placeholder use bucket/key shape", () => {
  expect(placeholderSupabaseObjectPath("whatsapp", "a/b")).toBe(
    `${DEFAULT_STORAGE_BUCKET}/pending/whatsapp/a/b`,
  );
  expect(
    buildSupabaseObjectPath({
      source: "upload",
      externalRef: "ignored",
      bucket: "my-bucket",
      objectKey: "wa/2026/10/01/file.pdf",
    }),
  ).toBe("my-bucket/wa/2026/10/01/file.pdf");
  expect(() =>
    buildSupabaseObjectPath({ source: "agent", externalRef: "x", bucket: "bad/bucket" }),
  ).toThrow(/bucket/);
  expect(() =>
    buildSupabaseObjectPath({ source: "agent", externalRef: "x", objectKey: "../escape" }),
  ).toThrow(/\.\./);
});

test("mintSignedUrl is a stub that does not invent durable URLs", async () => {
  await expect(mintSignedUrl("fran-ops-media/pending/whatsapp/x")).rejects.toThrow(/TODO/);
});

test("ingestWaMedia points at Supabase Storage path, not Drive dump", () => {
  const result = ingestWaMedia({
    chatJid: "120363@g.us",
    messageId: "ABCD",
    kind: "image",
    occurredAt: "2026-10-01T04:00:00.000Z",
    mimeHint: "image/jpeg",
  });
  expect(result.warmPackPath).toContain("contextpacks/wa/2026/10/01/");
  expect(result.mediaIndexInsert.supabase_object_path).toBe(
    `${DEFAULT_STORAGE_BUCKET}/pending/whatsapp/120363@g.us/ABCD`,
  );
  expect(result.mediaIndexInsert).not.toHaveProperty("cold_uri");
  expect(result.warmMarkdown).toContain("supabase://");
});

test("linkDriveFolderPurpose builds a purpose-only Drive folder insert", () => {
  const row = linkDriveFolderPurpose({
    folderId: "drive-folder-abc",
    name: "Ops receipts",
    purpose: "Monthly franchisee receipt drops for humans",
    contextpackPath: "contextpacks/wa/_example.md",
  });
  expect(row.folder_id).toBe("drive-folder-abc");
  expect(row.purpose).toContain("receipt");
  expect(row.contextpack_path).toBe("contextpacks/wa/_example.md");
});
