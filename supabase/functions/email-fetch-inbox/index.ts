import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailAccount {
  id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_encryption: string;
  smtp_username: string;
  smtp_password: string;
  last_fetched_uid: string | null;
}

interface ParsedEmail {
  messageUid: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  receivedAt: Date;
  headers: Record<string, string>;
}

// Auto-detect IMAP settings based on email domain
function getImapSettings(email: string): { host: string; port: number } | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return null;

  const settings: Record<string, { host: string; port: number }> = {
    "gmail.com": { host: "imap.gmail.com", port: 993 },
    "googlemail.com": { host: "imap.gmail.com", port: 993 },
    "yandex.ru": { host: "imap.yandex.ru", port: 993 },
    "yandex.com": { host: "imap.yandex.com", port: 993 },
    "ya.ru": { host: "imap.yandex.ru", port: 993 },
    "mail.ru": { host: "imap.mail.ru", port: 993 },
    "inbox.ru": { host: "imap.mail.ru", port: 993 },
    "list.ru": { host: "imap.mail.ru", port: 993 },
    "bk.ru": { host: "imap.mail.ru", port: 993 },
    "outlook.com": { host: "outlook.office365.com", port: 993 },
    "hotmail.com": { host: "outlook.office365.com", port: 993 },
    "live.com": { host: "outlook.office365.com", port: 993 },
  };

  return settings[domain] || null;
}

// Decode MIME encoded words (e.g., =?UTF-8?B?...?=)
function decodeMimeWord(text: string): string {
  if (!text) return "";
  
  const mimePattern = /=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi;
  
  return text.replace(mimePattern, (match, charset, encoding, encodedText) => {
    try {
      if (encoding.toUpperCase() === "B") {
        // Base64 decoding
        const bytes = Uint8Array.from(atob(encodedText), (c: string) => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } else if (encoding.toUpperCase() === "Q") {
        // Quoted-printable decoding
        const decoded = encodedText
          .replace(/_/g, " ")
          .replace(/=([0-9A-F]{2})/gi, (_match: string, hex: string) => 
            String.fromCharCode(parseInt(hex, 16))
          );
        return decoded;
      }
    } catch (e) {
      console.error("MIME decode error:", e);
    }
    return match;
  });
}

// Parse email address from "Name <email@domain.com>" format
function parseEmailAddress(addr: string): { email: string; name: string | null } {
  if (!addr) return { email: "", name: null };
  
  const decoded = decodeMimeWord(addr.trim());
  const match = decoded.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+@[^>]+)>?$/);
  
  if (match) {
    return {
      name: match[1]?.trim() || null,
      email: match[2]?.trim().toLowerCase() || decoded.toLowerCase(),
    };
  }
  
  return { email: decoded.toLowerCase(), name: null };
}

// Parse MIME multipart content
function parseMimeContent(raw: string): { text: string; html: string } {
  let text = "";
  let html = "";

  // Check for multipart
  const boundaryMatch = raw.match(/boundary="?([^"\s;]+)"?/i);
  
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    
    for (const part of parts) {
      const contentTypeMatch = part.match(/Content-Type:\s*([^;\r\n]+)/i);
      if (!contentTypeMatch) continue;
      
      const contentType = contentTypeMatch[1].toLowerCase();
      
      // Find the body (after double newline)
      const bodyMatch = part.match(/\r?\n\r?\n([\s\S]*)/);
      if (!bodyMatch) continue;
      
      let body = bodyMatch[1].trim();
      
      // Check for transfer encoding
      const encodingMatch = part.match(/Content-Transfer-Encoding:\s*([^\r\n]+)/i);
      const encoding = encodingMatch?.[1]?.trim().toLowerCase();
      
      if (encoding === "base64") {
        try {
          const bytes = Uint8Array.from(atob(body.replace(/\s/g, "")), c => c.charCodeAt(0));
          body = new TextDecoder("utf-8").decode(bytes);
        } catch (e) {
          console.error("Base64 decode error:", e);
        }
      } else if (encoding === "quoted-printable") {
        body = body
          .replace(/=\r?\n/g, "")
          .replace(/=([0-9A-F]{2})/gi, (_, hex) => 
            String.fromCharCode(parseInt(hex, 16))
          );
      }
      
      if (contentType.includes("text/plain") && !text) {
        text = body;
      } else if (contentType.includes("text/html") && !html) {
        html = body;
      }
    }
  } else {
    // Simple message without multipart
    const bodyMatch = raw.match(/\r?\n\r?\n([\s\S]*)/);
    if (bodyMatch) {
      const contentTypeMatch = raw.match(/Content-Type:\s*([^;\r\n]+)/i);
      const contentType = contentTypeMatch?.[1]?.toLowerCase() || "text/plain";
      
      if (contentType.includes("text/html")) {
        html = bodyMatch[1];
      } else {
        text = bodyMatch[1];
      }
    }
  }

  return { text, html };
}

// Parse raw email into structured format
function parseEmail(raw: string, uid: string): ParsedEmail {
  const headers: Record<string, string> = {};
  
  // Parse headers
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerSection = headerEnd > 0 ? raw.substring(0, headerEnd) : raw;
  
  const headerLines = headerSection.split(/\r?\n/);
  let currentHeader = "";
  
  for (const line of headerLines) {
    if (line.match(/^\s+/)) {
      // Continuation of previous header
      currentHeader += " " + line.trim();
    } else {
      if (currentHeader) {
        const colonIdx = currentHeader.indexOf(":");
        if (colonIdx > 0) {
          const key = currentHeader.substring(0, colonIdx).toLowerCase();
          const value = currentHeader.substring(colonIdx + 1).trim();
          headers[key] = value;
        }
      }
      currentHeader = line;
    }
  }
  
  // Handle last header
  if (currentHeader) {
    const colonIdx = currentHeader.indexOf(":");
    if (colonIdx > 0) {
      const key = currentHeader.substring(0, colonIdx).toLowerCase();
      const value = currentHeader.substring(colonIdx + 1).trim();
      headers[key] = value;
    }
  }

  const from = parseEmailAddress(headers["from"] || "");
  const to = parseEmailAddress(headers["to"] || "");
  const subject = decodeMimeWord(headers["subject"] || "(без темы)");
  
  // Parse date
  let receivedAt = new Date();
  if (headers["date"]) {
    try {
      receivedAt = new Date(headers["date"]);
    } catch (e) {
      console.error("Date parse error:", e);
    }
  }

  const { text, html } = parseMimeContent(raw);

  return {
    messageUid: uid,
    fromEmail: from.email,
    fromName: from.name,
    toEmail: to.email,
    subject,
    bodyText: text,
    bodyHtml: html,
    receivedAt,
    headers,
  };
}

// IMAP command helper
async function imapCommand(
  conn: Deno.TlsConn,
  tag: string,
  command: string,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
): Promise<string[]> {
  const encoder = new TextEncoder();
  await conn.write(encoder.encode(`${tag} ${command}\r\n`));
  
  const lines: string[] = [];
  let buffer = "";
  
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    
    // Split into lines
    const parts = buffer.split("\r\n");
    buffer = parts.pop() || "";
    
    for (const line of parts) {
      lines.push(line);
      
      // Check if this is the tagged response (end of command)
      if (line.startsWith(`${tag} `)) {
        return lines;
      }
    }
  }
  
  return lines;
}

// Fetch emails from IMAP server
async function fetchEmails(account: EmailAccount): Promise<ParsedEmail[]> {
  const emails: ParsedEmail[] = [];
  
  console.log(`Connecting to IMAP: ${account.imap_host}:${account.imap_port}`);
  
  let conn: Deno.TlsConn;
  try {
    conn = await Deno.connectTls({
      hostname: account.imap_host,
      port: account.imap_port,
    });
  } catch (e) {
    console.error("IMAP connection failed:", e);
    throw new Error(`Не удалось подключиться к ${account.imap_host}:${account.imap_port}`);
  }

  const decoder = new TextDecoder();
  const reader = conn.readable.getReader();
  
  let tagCounter = 0;
  const nextTag = () => `A${String(++tagCounter).padStart(4, "0")}`;

  try {
    // Read greeting
    const { value: greeting } = await reader.read();
    console.log("IMAP greeting:", decoder.decode(greeting));

    // Login
    const loginTag = nextTag();
    const loginResponse = await imapCommand(
      conn, 
      loginTag, 
      `LOGIN "${account.smtp_username || account.email}" "${account.smtp_password}"`,
      reader,
      decoder
    );
    
    const loginResult = loginResponse.find(l => l.startsWith(`${loginTag} `));
    if (!loginResult?.includes("OK")) {
      throw new Error("IMAP login failed: " + loginResult);
    }
    console.log("IMAP login successful");

    // Select INBOX
    const selectTag = nextTag();
    const selectResponse = await imapCommand(conn, selectTag, "SELECT INBOX", reader, decoder);
    console.log("INBOX selected");

    // Search for recent emails (last 7 days or after last UID)
    const searchTag = nextTag();
    let searchCriteria = "ALL";
    
    if (account.last_fetched_uid) {
      searchCriteria = `UID ${parseInt(account.last_fetched_uid) + 1}:*`;
    } else {
      // First fetch: get emails from last 7 days
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const sinceStr = since.toLocaleDateString("en-US", { 
        day: "2-digit", 
        month: "short", 
        year: "numeric" 
      }).replace(",", "");
      searchCriteria = `SINCE ${sinceStr}`;
    }
    
    const searchResponse = await imapCommand(conn, searchTag, `UID SEARCH ${searchCriteria}`, reader, decoder);
    
    // Parse UIDs from search result
    const searchLine = searchResponse.find(l => l.startsWith("* SEARCH"));
    const uids = searchLine ? searchLine.replace("* SEARCH", "").trim().split(/\s+/).filter(Boolean) : [];
    
    console.log(`Found ${uids.length} emails to fetch`);

    // Fetch each email (limit to 50 at a time)
    const uidsToFetch = uids.slice(0, 50);
    
    for (const uid of uidsToFetch) {
      try {
        const fetchTag = nextTag();
        const fetchResponse = await imapCommand(
          conn, 
          fetchTag, 
          `UID FETCH ${uid} (RFC822)`,
          reader,
          decoder
        );
        
        // Extract raw email from response
        const rawEmail = fetchResponse
          .filter(l => !l.startsWith("*") && !l.startsWith(fetchTag))
          .join("\r\n");
        
        // Also check for inline data
        let emailData = "";
        for (const line of fetchResponse) {
          if (line.includes("RFC822}")) {
            // Start of email data
            const startIdx = fetchResponse.indexOf(line) + 1;
            emailData = fetchResponse.slice(startIdx).join("\r\n");
            break;
          }
        }
        
        if (emailData || rawEmail) {
          const parsed = parseEmail(emailData || rawEmail, uid);
          emails.push(parsed);
        }
      } catch (e) {
        console.error(`Error fetching UID ${uid}:`, e);
      }
    }

    // Logout
    const logoutTag = nextTag();
    await imapCommand(conn, logoutTag, "LOGOUT", reader, decoder);
    
  } finally {
    reader.releaseLock();
    conn.close();
  }

  return emails;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { account_id, test_only } = await req.json().catch(() => ({}));

    // Get email accounts with IMAP enabled
    let query = supabase
      .from("email_accounts")
      .select("*")
      .eq("imap_enabled", true)
      .eq("is_active", true);
    
    if (account_id) {
      query = query.eq("id", account_id);
    }

    const { data: accounts, error: accountsError } = await query;
    
    if (accountsError) throw accountsError;
    if (!accounts?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No IMAP accounts configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { account: string; fetched: number; errors: string[] }[] = [];

    for (const account of accounts) {
      const result = { account: account.email, fetched: 0, errors: [] as string[] };
      
      try {
        // Auto-detect IMAP settings if not configured
        let imapHost = account.imap_host;
        let imapPort = account.imap_port || 993;
        
        if (!imapHost) {
          const detected = getImapSettings(account.email);
          if (detected) {
            imapHost = detected.host;
            imapPort = detected.port;
          } else {
            result.errors.push("IMAP settings not configured and could not be auto-detected");
            results.push(result);
            continue;
          }
        }

        if (test_only) {
          // Just test connection
          const conn = await Deno.connectTls({
            hostname: imapHost,
            port: imapPort,
          });
          conn.close();
          result.fetched = -1; // Indicates test success
          results.push(result);
          continue;
        }

        const emails = await fetchEmails({
          ...account,
          imap_host: imapHost,
          imap_port: imapPort,
        });

        let maxUid = account.last_fetched_uid ? parseInt(account.last_fetched_uid) : 0;

        for (const email of emails) {
          // Try to link to profile by email
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("email", email.fromEmail)
            .maybeSingle();

          // Insert into inbox
          const { error: insertError } = await supabase
            .from("email_inbox")
            .upsert({
              email_account_id: account.id,
              message_uid: email.messageUid,
              from_email: email.fromEmail,
              from_name: email.fromName,
              to_email: email.toEmail,
              subject: email.subject,
              body_text: email.bodyText,
              body_html: email.bodyHtml,
              received_at: email.receivedAt.toISOString(),
              headers: email.headers,
              linked_profile_id: profile?.id || null,
            }, {
              onConflict: "email_account_id,message_uid",
            });

          if (insertError) {
            result.errors.push(`Failed to save email ${email.messageUid}: ${insertError.message}`);
          } else {
            result.fetched++;
            const uid = parseInt(email.messageUid);
            if (uid > maxUid) maxUid = uid;
          }
        }

        // Update last fetched UID
        if (maxUid > 0) {
          await supabase
            .from("email_accounts")
            .update({
              last_fetched_at: new Date().toISOString(),
              last_fetched_uid: String(maxUid),
            })
            .eq("id", account.id);
        }

      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        result.errors.push(errMsg);
      }

      results.push(result);
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error:", error);
    const errMsg = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});