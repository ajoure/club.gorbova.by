/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  /** 6-digit OTP — primary way to confirm email. */
  token?: string
}

/**
 * OTP-first signup email (PATCH-INLINE-AUTH-EMAIL-OTP-FLOW Phase 2).
 *
 * Primary UX: large, monospace 6-digit code the user enters back in the app.
 * Secondary: fallback link for recovery cases (old emails / clients that
 * strip the code display). No JS/auto-copy — email clients block it.
 *
 * The extra plain-text line "Ваш код подтверждения: 123456" is critical for
 * iOS/macOS Mail AutoFill (`one-time-code`) parsing.
 */
export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
  token,
}: SignupEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>{token ? `Ваш код: ${token}` : `Подтвердите email для ${siteName}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Подтверждение email</Heading>
        <Text style={text}>
          Вы регистрируетесь в{' '}
          <Link href={siteUrl} style={link}>
            <strong>{siteName}</strong>
          </Link>
          . Введите этот код на странице, где вы начали действие — открывать
          ссылки и переходить в новую вкладку не нужно.
        </Text>

        {token ? (
          <>
            <Section style={codeBox}>
              <Text style={codeText}>{token}</Text>
            </Section>
            {/* Plain-text line — важно для iOS/macOS Mail one-time-code AutoFill */}
            <Text style={plainCode}>Ваш код подтверждения: {token}</Text>
            <Text style={text}>
              Код действителен 10 минут. Никому его не сообщайте.
            </Text>
          </>
        ) : null}

        <Text style={fallbackNote}>
          Если поле для кода недоступно, можно подтвердить по{' '}
          <Link href={confirmationUrl} style={link}>ссылке</Link>.
        </Text>

        <Text style={footer}>
          Если вы не регистрировались ({recipient}), просто проигнорируйте это письмо.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default SignupEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '24px 25px', maxWidth: '520px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 16px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 16px',
}
const link = { color: 'inherit', textDecoration: 'underline' }
const codeBox = {
  backgroundColor: '#F4F6FA',
  borderRadius: '12px',
  padding: '20px 12px',
  textAlign: 'center' as const,
  margin: '20px 0 12px',
}
const codeText = {
  fontFamily: 'Menlo, Consolas, "Courier New", monospace',
  fontSize: '44px',
  fontWeight: 'bold' as const,
  color: '#111111',
  letterSpacing: '10px',
  margin: '0',
  lineHeight: '1.2',
}
const plainCode = {
  fontSize: '13px',
  color: '#111111',
  textAlign: 'center' as const,
  margin: '0 0 20px',
}
const fallbackNote = {
  fontSize: '12px',
  color: '#777777',
  margin: '16px 0 0',
}
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
