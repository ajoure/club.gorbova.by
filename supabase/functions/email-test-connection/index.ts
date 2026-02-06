import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { account_id } = await req.json();

    if (!account_id) {
      return new Response(JSON.stringify({ error: 'account_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch account details
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Аккаунт не найден' 
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if IMAP is configured
    if (!account.imap_host || !account.imap_port) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'IMAP не настроен. Укажите хост и порт IMAP.',
        details: {
          imap_host: account.imap_host,
          imap_port: account.imap_port,
          imap_enabled: account.imap_enabled
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!account.smtp_password) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Пароль не указан. Настройте пароль SMTP/IMAP.',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try to connect to IMAP server using Deno.connect
    // Note: Full IMAP implementation would require a library
    // Here we do a basic TCP connection test
    try {
      const hostname = account.imap_host;
      const port = account.imap_port || 993;
      
      console.log(`[TEST-IMAP] Testing connection to ${hostname}:${port}`);
      
      // For SSL/TLS connections (port 993)
      const conn = await Deno.connectTls({
        hostname,
        port,
      });

      // Read initial greeting
      const buf = new Uint8Array(1024);
      const n = await conn.read(buf);
      const greeting = n ? new TextDecoder().decode(buf.slice(0, n)) : '';
      
      console.log(`[TEST-IMAP] Server greeting: ${greeting.slice(0, 100)}`);

      // Check if we got a valid IMAP greeting
      const isImapServer = greeting.includes('IMAP') || greeting.includes('OK') || greeting.includes('*');
      
      // Try LOGIN command
      const loginCmd = `A001 LOGIN "${account.smtp_username || account.email}" "${account.smtp_password}"\r\n`;
      await conn.write(new TextEncoder().encode(loginCmd));
      
      const loginBuf = new Uint8Array(1024);
      const loginN = await conn.read(loginBuf);
      const loginResponse = loginN ? new TextDecoder().decode(loginBuf.slice(0, loginN)) : '';
      
      console.log(`[TEST-IMAP] Login response: ${loginResponse.slice(0, 200)}`);
      
      // Logout gracefully
      await conn.write(new TextEncoder().encode('A002 LOGOUT\r\n'));
      conn.close();

      // Check login result
      if (loginResponse.includes('A001 OK') || loginResponse.includes('LOGIN completed')) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Подключение успешно! IMAP работает.',
          details: {
            server: hostname,
            port: port,
            greeting: greeting.slice(0, 100)
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else if (loginResponse.includes('NO') || loginResponse.includes('AUTHENTICATIONFAILED') || loginResponse.includes('Invalid')) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Ошибка авторизации. Проверьте логин и пароль.',
          details: {
            server: hostname,
            response: loginResponse.slice(0, 200)
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else if (isImapServer) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Сервер доступен, но авторизация требует проверки.',
          details: {
            server: hostname,
            port: port,
            response: loginResponse.slice(0, 200)
          }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Сервер не отвечает как IMAP сервер.',
          details: { greeting: greeting.slice(0, 100) }
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (connError) {
      console.error('[TEST-IMAP] Connection error:', connError);
      
      let errorMessage = 'Не удалось подключиться к IMAP серверу.';
      const errStr = connError instanceof Error ? connError.message : String(connError);
      
      if (errStr.includes('connection refused')) {
        errorMessage = 'Соединение отклонено. Проверьте хост и порт.';
      } else if (errStr.includes('timed out')) {
        errorMessage = 'Таймаут соединения. Сервер не отвечает.';
      } else if (errStr.includes('certificate')) {
        errorMessage = 'Ошибка сертификата SSL. Проверьте настройки шифрования.';
      } else if (errStr.includes('dns') || errStr.includes('resolve')) {
        errorMessage = 'Не удалось найти сервер. Проверьте имя хоста.';
      }

      return new Response(JSON.stringify({ 
        success: false, 
        error: errorMessage,
        details: {
          technical: errStr,
          host: account.imap_host,
          port: account.imap_port
        }
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('[TEST-IMAP] Unexpected error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Внутренняя ошибка сервера',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
