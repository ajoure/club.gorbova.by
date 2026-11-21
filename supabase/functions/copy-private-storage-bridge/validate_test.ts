import { validContentType, validUploadUrl } from "./validate.ts";

const ok = (u: string, bucket = "documents", name = "a/б c.pdf") => validUploadUrl({ bucket, name, upload_url: u }) !== null;
const base = "https://ypwsuumurrtkxatoyqhk.supabase.co/storage/v1/object/upload/sign/documents/";

Deno.test("accepts exact copy-project signed upload URL", () => {
  if (!ok(base + "a/%D0%B1%20c.pdf?token=t")) throw new Error("rejected valid");
});
Deno.test("rejects foreign origin", () => {
  if (ok("https://evil.example/storage/v1/object/upload/sign/documents/a/%D0%B1%20c.pdf?token=t")) throw new Error();
  if (ok("https://hdjgkjceownmmnrqqtuz.supabase.co/storage/v1/object/upload/sign/documents/a/%D0%B1%20c.pdf?token=t")) throw new Error();
});
Deno.test("rejects other path, bucket or rename", () => {
  if (ok(base + "other.pdf?token=t")) throw new Error();
  if (ok(base.replace("/documents/", "/avatars/") + "a/%D0%B1%20c.pdf?token=t")) throw new Error();
  if (ok("https://ypwsuumurrtkxatoyqhk.supabase.co/storage/v1/object/documents/a/%D0%B1%20c.pdf?token=t")) throw new Error();
});
Deno.test("rejects missing or extra parameters and credentials", () => {
  if (ok(base + "a/%D0%B1%20c.pdf")) throw new Error();
  if (ok(base + "a/%D0%B1%20c.pdf?token=t&x=1")) throw new Error();
  if (ok("https://u:p@ypwsuumurrtkxatoyqhk.supabase.co/storage/v1/object/upload/sign/documents/a/%D0%B1%20c.pdf?token=t")) throw new Error();
  if (ok("not a url")) throw new Error();
});

Deno.test("accepts names with double dots inside a segment", () => {
  if (validUploadUrl({ bucket: "documents", name: "a/Договор..docx", upload_url: base + "a/%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80..docx?token=t" }) === null) throw new Error();
});
Deno.test("content type is a plain mime type or ignored", () => {
  if (validContentType("application/octet-stream") !== "application/octet-stream") throw new Error();
  if (validContentType("text/html\r\nx: y") !== null || validContentType(5) !== null) throw new Error();
});
