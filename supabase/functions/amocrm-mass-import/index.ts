import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedContact {
  amo_id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  emails: string[];
  phone?: string;
  phones: string[];
  telegram_username?: string;
}

interface ImportOptions {
  updateExisting: boolean;
  dryRun?: boolean; // Preview mode - no actual changes
}

// SAFETY: This function ONLY performs INSERT and UPDATE operations.
// DELETE operations are strictly prohibited to prevent data loss.
console.log('🔒 SAFETY: amocrm-mass-import function loaded. This function NEVER deletes data.');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get auth token from request
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Требуется авторизация' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Неверный токен авторизации' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { contacts, options, jobId } = await req.json() as {
      contacts: ParsedContact[];
      options: ImportOptions;
      jobId?: string;
    };

    if (!contacts || contacts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Нет контактов для импорта' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const isDryRun = options.dryRun === true;
    console.log(`📊 Import request: ${contacts.length} contacts, dryRun=${isDryRun}, updateExisting=${options.updateExisting}`);

    // Create or update job (skip for dry run - no DB changes needed)
    let job: { id: string } | null = null;
    
    if (!isDryRun) {
      if (jobId) {
        job = { id: jobId };
        await supabase
          .from('import_jobs')
          .update({
            status: 'processing',
            started_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      } else {
        const { data, error } = await supabase
          .from('import_jobs')
          .insert({
            type: 'amocrm_contacts',
            total: contacts.length,
            status: 'processing',
            started_at: new Date().toISOString(),
            created_by: user.id,
          })
          .select()
          .single();
        
        if (error) throw error;
        job = data;
      }
    }

    // Load all existing profiles for matching
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, email, emails, phone, phones, telegram_username, external_id_amo');

    // Build lookup indexes
    const emailIndex = new Map<string, { id: string; name: string }>();
    const phoneIndex = new Map<string, { id: string; name: string }>();
    const telegramIndex = new Map<string, { id: string; name: string }>();
    const amoIdIndex = new Map<string, { id: string; name: string }>();

    const normalizeEmail = (email: string) => email?.toLowerCase().trim() || '';
    const normalizePhone = (phone: string) => {
      if (!phone) return '';
      let normalized = phone.replace(/[^\d+]/g, '');
      if (normalized.startsWith('+')) normalized = normalized.slice(1);
      if (normalized.startsWith('8') && normalized.length === 11) {
        normalized = '7' + normalized.slice(1);
      }
      if (normalized.length === 9 && ['29', '33', '44', '25'].some(p => normalized.startsWith(p))) {
        normalized = '375' + normalized;
      }
      return normalized;
    };

    for (const p of profiles || []) {
      if (p.email) emailIndex.set(normalizeEmail(p.email), { id: p.id, name: p.full_name || '' });
      if (p.phone) phoneIndex.set(normalizePhone(p.phone), { id: p.id, name: p.full_name || '' });
      if (p.telegram_username) telegramIndex.set(p.telegram_username.toLowerCase(), { id: p.id, name: p.full_name || '' });
      if (p.external_id_amo) amoIdIndex.set(p.external_id_amo, { id: p.id, name: p.full_name || '' });
      
      // Additional emails/phones
      const emails = p.emails as string[] | null;
      const phones = p.phones as string[] | null;
      if (emails) {
        emails.forEach(e => emailIndex.set(normalizeEmail(e), { id: p.id, name: p.full_name || '' }));
      }
      if (phones) {
        phones.forEach(ph => phoneIndex.set(normalizePhone(ph), { id: p.id, name: p.full_name || '' }));
      }
    }

    // Process contacts and calculate what would happen
    const BATCH_SIZE = 50;
    let processed = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let errorsCount = 0;
    let skippedCount = 0;
    const errorLog: { contact: string; error: string }[] = [];

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      
      for (const contact of batch) {
        try {
          // Find match
          let matchedProfileId: string | null = null;
          
          // Check amoCRM ID first
          const amoMatch = amoIdIndex.get(contact.amo_id);
          if (amoMatch) {
            matchedProfileId = amoMatch.id;
          }
          
          // Check emails
          if (!matchedProfileId) {
            for (const email of contact.emails) {
              const match = emailIndex.get(normalizeEmail(email));
              if (match) {
                matchedProfileId = match.id;
                break;
              }
            }
          }
          
          // Check phones
          if (!matchedProfileId) {
            for (const phone of contact.phones) {
              const match = phoneIndex.get(normalizePhone(phone));
              if (match) {
                matchedProfileId = match.id;
                break;
              }
            }
          }
          
          // Check telegram
          if (!matchedProfileId && contact.telegram_username) {
            const match = telegramIndex.get(contact.telegram_username.toLowerCase());
            if (match) {
              matchedProfileId = match.id;
            }
          }

          if (matchedProfileId && options.updateExisting) {
            // Update existing profile
            if (!isDryRun && job) {
              const updateData: Record<string, unknown> = {
                external_id_amo: contact.amo_id,
                import_batch_id: job.id, // Track which import updated this profile
              };
              
              if (contact.email) updateData.email = contact.email;
              if (contact.phone) updateData.phone = contact.phone;
              if (contact.telegram_username) updateData.telegram_username = contact.telegram_username;
              if (contact.emails.length > 0) updateData.emails = contact.emails;
              if (contact.phones.length > 0) updateData.phones = contact.phones.map(p => '+' + p);
              
              const { error } = await supabase
                .from('profiles')
                .update(updateData)
                .eq('id', matchedProfileId);
              
              if (error) {
                errorLog.push({ contact: contact.full_name, error: error.message });
                errorsCount++;
              } else {
                updatedCount++;
              }
            } else if (isDryRun) {
              updatedCount++; // Dry run: just count
            }
          } else if (!matchedProfileId) {
            // Create new profile
            if (!isDryRun && job) {
              const { error } = await supabase
                .from('profiles')
                .insert({
                  full_name: contact.full_name,
                  first_name: contact.first_name,
                  last_name: contact.last_name,
                  email: contact.email,
                  emails: contact.emails,
                  phone: contact.phone ? '+' + contact.phone : undefined,
                  phones: contact.phones.map(p => '+' + p),
                  telegram_username: contact.telegram_username,
                  external_id_amo: contact.amo_id,
                  status: 'ghost',
                  source: 'amocrm_import',
                  import_batch_id: job.id, // Track which import created this profile
                });
              
              if (error) {
                errorLog.push({ contact: contact.full_name, error: error.message });
                errorsCount++;
              } else {
                createdCount++;
                // Add to indexes to avoid duplicates in same batch
                if (contact.email) emailIndex.set(normalizeEmail(contact.email), { id: contact.amo_id, name: contact.full_name });
                for (const phone of contact.phones) {
                  phoneIndex.set(normalizePhone(phone), { id: contact.amo_id, name: contact.full_name });
                }
              }
            } else if (isDryRun) {
              createdCount++; // Dry run: just count
            }
          } else {
            skippedCount++; // Profile exists but updateExisting is false
          }
          
          processed++;
        } catch (err) {
          errorLog.push({ contact: contact.full_name, error: String(err) });
          errorsCount++;
          processed++;
        }
      }
      
      // Update job progress (only for real imports)
      if (!isDryRun && job) {
        await supabase
          .from('import_jobs')
          .update({
            processed,
            created_count: createdCount,
            updated_count: updatedCount,
            errors_count: errorsCount,
          })
          .eq('id', job.id);
      }
    }

    // Complete job (only for real imports)
    if (!isDryRun && job) {
      await supabase
        .from('import_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          processed,
          created_count: createdCount,
          updated_count: updatedCount,
          errors_count: errorsCount,
          error_log: errorLog.length > 0 ? errorLog : null,
        })
        .eq('id', job.id);
    }

    const logMessage = isDryRun 
      ? `🔍 Dry run completed: would create ${createdCount}, update ${updatedCount}, skip ${skippedCount}`
      : `✅ Import completed: ${createdCount} created, ${updatedCount} updated, ${errorsCount} errors`;
    console.log(logMessage);

    return new Response(
      JSON.stringify({
        success: true,
        dryRun: isDryRun,
        jobId: job?.id || null,
        wouldCreate: isDryRun ? createdCount : undefined,
        wouldUpdate: isDryRun ? updatedCount : undefined,
        wouldSkip: isDryRun ? skippedCount : undefined,
        created: isDryRun ? undefined : createdCount,
        updated: isDryRun ? undefined : updatedCount,
        skipped: skippedCount,
        errors: errorsCount,
        errorLog: errorLog.length > 0 ? errorLog.slice(0, 10) : undefined, // Return first 10 errors for preview
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Import error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
