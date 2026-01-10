import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AmoCRMContact {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  position: string;
  workEmail: string;
  personalEmail: string;
  otherEmail: string;
  workPhone: string;
  mobilePhone: string;
  telegram: string;
  telegramNickname: string;
  isClubMember: boolean;
  consent: boolean;
  birthDate: string;
  createdAt: string;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  // Remove all non-digits except leading +
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length < 9) return null;
  return cleaned;
}

function normalizeTelegram(username: string | null): string | null {
  if (!username) return null;
  // Remove http://@, @, spaces
  let cleaned = username.trim()
    .replace(/^https?:\/\/@?/i, '')
    .replace(/^@/, '')
    .replace(/\s+/g, '');
  if (!cleaned || cleaned.length < 2) return null;
  return cleaned.toLowerCase();
}

function parseContacts(csvData: string): AmoCRMContact[] {
  const lines = csvData.split('\n');
  const contacts: AmoCRMContact[] = [];
  
  // Find header line (starts with |ID|)
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('|ID|') && lines[i].includes('|Наименование|')) {
      headerIndex = i;
      break;
    }
  }
  
  if (headerIndex === -1) return contacts;
  
  const headerLine = lines[headerIndex];
  const headers = headerLine.split('|').map(h => h.trim()).filter(h => h);
  
  // Find column indices
  const cols = {
    id: headers.indexOf('ID'),
    name: headers.indexOf('Наименование'),
    firstName: headers.indexOf('Имя'),
    lastName: headers.indexOf('Фамилия'),
    position: headers.indexOf('Должность (контакт)'),
    workEmail: headers.indexOf('Рабочий email'),
    personalEmail: headers.indexOf('Личный email'),
    otherEmail: headers.indexOf('Другой email'),
    workPhone: headers.indexOf('Рабочий телефон'),
    mobilePhone: headers.indexOf('Мобильный телефон'),
    telegram: headers.indexOf('Телеграм (контакт)'),
    telegramNickname: headers.indexOf('Никнейм Телеграм (контакт)'),
    isClubMember: headers.indexOf('К - Gorbova Club (контакт)'),
    consent: headers.indexOf('Пользовательское соглашение (контакт)'),
    birthDate: headers.indexOf('Дата рождения (контакт)'),
    createdAt: headers.indexOf('Дата создания'),
  };
  
  // Parse data lines (skip header and separator)
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !line.includes('|')) continue;
    
    const values = line.split('|').map(v => v.trim()).filter((_, idx) => idx > 0);
    
    const getValue = (idx: number): string => {
      if (idx === -1 || idx >= values.length) return '';
      return values[idx]?.replace(/\\@/g, '@').replace(/\\:/g, ':') || '';
    };
    
    const id = getValue(cols.id);
    if (!id || id === 'ID' || id === '-') continue;
    
    // Skip spam/bot entries
    const name = getValue(cols.name);
    if (name.includes('Telegram code:') || /^\d+$/.test(name)) continue;
    
    contacts.push({
      id,
      name,
      firstName: getValue(cols.firstName),
      lastName: getValue(cols.lastName),
      position: getValue(cols.position),
      workEmail: getValue(cols.workEmail),
      personalEmail: getValue(cols.personalEmail),
      otherEmail: getValue(cols.otherEmail),
      workPhone: getValue(cols.workPhone),
      mobilePhone: getValue(cols.mobilePhone),
      telegram: getValue(cols.telegram),
      telegramNickname: getValue(cols.telegramNickname),
      isClubMember: getValue(cols.isClubMember) === '1' || getValue(cols.isClubMember).toLowerCase() === 'да',
      consent: getValue(cols.consent) === '1' || getValue(cols.consent).toLowerCase() === 'да',
      birthDate: getValue(cols.birthDate),
      createdAt: getValue(cols.createdAt),
    });
  }
  
  return contacts;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { csvData, dryRun = true } = await req.json();
    
    if (!csvData) {
      return new Response(JSON.stringify({ error: "csvData is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contacts = parseContacts(csvData);
    console.log(`Parsed ${contacts.length} contacts from amoCRM export`);

    interface ProfileRecord {
      id: string;
      email: string | null;
      phone: string | null;
      phones: string[] | null;
      emails: string[] | null;
      telegram_username: string | null;
      full_name: string | null;
      first_name: string | null;
      last_name: string | null;
      status: string | null;
      user_id: string | null;
      position: string | null;
      was_club_member: boolean | null;
    }

    // Get existing profiles for matching
    const { data: existingProfiles } = await supabase
      .from('profiles')
      .select('id, email, phone, phones, emails, telegram_username, full_name, first_name, last_name, status, user_id, position, was_club_member');

    const profilesByEmail = new Map<string, ProfileRecord>();
    const profilesByPhone = new Map<string, ProfileRecord>();
    const profilesByTelegram = new Map<string, ProfileRecord>();
    const profilesByName = new Map<string, ProfileRecord>();

    for (const p of (existingProfiles || []) as ProfileRecord[]) {
      if (p.email) profilesByEmail.set(p.email.toLowerCase(), p);
      if (p.phone) {
        const normalizedPhone = normalizePhone(p.phone);
        if (normalizedPhone) {
          profilesByPhone.set(normalizedPhone.slice(-9), p);
        }
      }
      if (p.telegram_username) {
        profilesByTelegram.set(p.telegram_username.toLowerCase(), p);
      }
      const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim().toLowerCase();
      if (fullName) profilesByName.set(fullName, p);
    }

    const results = {
      total: contacts.length,
      updated: 0,
      created: 0,
      skipped: 0,
      updates: [] as any[],
      creates: [] as any[],
      errors: [] as string[],
    };

    for (const contact of contacts) {
      try {
        // Collect all contact data
        const emails = [contact.personalEmail, contact.workEmail, contact.otherEmail].filter(e => e && e.includes('@'));
        const phones = [contact.mobilePhone, contact.workPhone].map(normalizePhone).filter(Boolean) as string[];
        const telegram = normalizeTelegram(contact.telegramNickname) || normalizeTelegram(contact.telegram);
        const fullName = contact.name || `${contact.firstName} ${contact.lastName}`.trim();
        
        // Skip if no useful data
        if (!emails.length && !phones.length && !telegram && !fullName) {
          results.skipped++;
          continue;
        }

        // Find existing profile
        let existingProfile: ProfileRecord | null = null;
        let matchType = '';

        // Priority 1: Email match
        for (const email of emails) {
          if (profilesByEmail.has(email.toLowerCase())) {
            existingProfile = profilesByEmail.get(email.toLowerCase())!;
            matchType = 'email';
            break;
          }
        }

        // Priority 2: Phone match
        if (!existingProfile) {
          for (const phone of phones) {
            const key = phone.slice(-9);
            if (profilesByPhone.has(key)) {
              existingProfile = profilesByPhone.get(key)!;
              matchType = 'phone';
              break;
            }
          }
        }

        // Priority 3: Telegram match
        if (!existingProfile && telegram) {
          if (profilesByTelegram.has(telegram)) {
            existingProfile = profilesByTelegram.get(telegram)!;
            matchType = 'telegram';
          }
        }

        // Priority 4: Name match (only if unique and has other data)
        if (!existingProfile && fullName && (emails.length || phones.length)) {
          const nameKey = fullName.toLowerCase();
          if (profilesByName.has(nameKey)) {
            existingProfile = profilesByName.get(nameKey)!;
            matchType = 'name';
          }
        }

        if (existingProfile) {
          // Update existing profile with missing data
          const updates: Record<string, any> = {};
          const enrichments: string[] = [];

          // Add phone if missing
          if (!existingProfile.phone && phones.length > 0) {
            updates.phone = phones[0];
            enrichments.push(`phone: ${phones[0]}`);
          }

          // Add telegram_username if missing
          if (!existingProfile.telegram_username && telegram) {
            updates.telegram_username = telegram;
            enrichments.push(`telegram: @${telegram}`);
          }

          // Add position if missing
          if (!existingProfile.position && contact.position) {
            updates.position = contact.position;
            enrichments.push(`position: ${contact.position}`);
          }

          // Set was_club_member if they were in club
          if (contact.isClubMember && !existingProfile.was_club_member) {
            updates.was_club_member = true;
            enrichments.push('was_club_member: true');
          }

          // Add first/last name if missing
          if (!existingProfile.first_name && contact.firstName) {
            updates.first_name = contact.firstName;
            enrichments.push(`first_name: ${contact.firstName}`);
          }
          if (!existingProfile.last_name && contact.lastName) {
            updates.last_name = contact.lastName;
            enrichments.push(`last_name: ${contact.lastName}`);
          }

          // Merge additional phones and emails into arrays
          const existingPhones = (existingProfile.phones as string[]) || [];
          const existingEmails = (existingProfile.emails as string[]) || [];
          
          const newPhones = phones.filter(p => 
            p !== existingProfile!.phone && !existingPhones.includes(p)
          );
          const newEmails = emails.filter(e => 
            e.toLowerCase() !== existingProfile!.email?.toLowerCase() && 
            !existingEmails.map(x => x.toLowerCase()).includes(e.toLowerCase())
          );

          if (newPhones.length > 0) {
            updates.phones = [...existingPhones, ...newPhones];
            enrichments.push(`phones[]: +${newPhones.length}`);
          }
          if (newEmails.length > 0) {
            updates.emails = [...existingEmails, ...newEmails];
            enrichments.push(`emails[]: +${newEmails.length}`);
          }

          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            
            if (!dryRun) {
              await supabase
                .from('profiles')
                .update(updates)
                .eq('id', existingProfile.id);
            }
            
            results.updated++;
            results.updates.push({
              profile_id: existingProfile.id,
              email: existingProfile.email,
              name: fullName,
              matchType,
              enrichments,
            });
          } else {
            results.skipped++;
          }
        } else {
          // Create new archived profile
          const newProfile = {
            email: emails[0] || null,
            phone: phones[0] || null,
            phones: phones.slice(1),
            emails: emails.slice(1),
            telegram_username: telegram,
            full_name: fullName,
            first_name: contact.firstName || null,
            last_name: contact.lastName || null,
            position: contact.position || null,
            was_club_member: contact.isClubMember,
            status: 'archived',
            meta: {
              source: 'amocrm_import',
              amocrm_id: contact.id,
              imported_at: new Date().toISOString(),
              consent: contact.consent,
            },
          };

          if (!dryRun) {
            const { error } = await supabase
              .from('profiles')
              .insert(newProfile);
            
            if (error) {
              results.errors.push(`Failed to create profile for ${fullName}: ${error.message}`);
              continue;
            }
          }

          results.created++;
          results.creates.push({
            name: fullName,
            email: emails[0],
            phone: phones[0],
            telegram,
            position: contact.position,
            isClubMember: contact.isClubMember,
          });
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        results.errors.push(`Error processing contact ${contact.id}: ${errorMessage}`);
      }
    }

    console.log(`Import results: ${results.updated} updated, ${results.created} created, ${results.skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in amocrm-contacts-import:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
