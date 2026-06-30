/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="ru" dir="ltr">
    <Head />
    <Preview>Восстановление пароля — {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Сброс пароля</Heading>
        <Text style={text}>
          Мы получили запрос на восстановление пароля для вашего аккаунта на
          платформе «{siteName}». Чтобы установить новый пароль, нажмите
          кнопку ниже.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Установить новый пароль
        </Button>
        <Text style={text}>
          Если кнопка не работает, скопируйте ссылку в адресную строку
          браузера:
        </Text>
        <Text style={linkText}>{confirmationUrl}</Text>
        <Text style={footer}>
          Если вы не запрашивали восстановление пароля, просто проигнорируйте
          это письмо — пароль останется прежним. Ссылка действительна
          ограниченное время.
        </Text>
        <Text style={footer}>
          С уважением,<br />
          Команда «{siteName}»
        </Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '20px 25px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#000000',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#55575d',
  lineHeight: '1.5',
  margin: '0 0 20px',
}
const linkText = {
  fontSize: '12px',
  color: '#6366f1',
  wordBreak: 'break-all' as const,
  margin: '0 0 20px',
}
const button = {
  backgroundColor: '#6366f1',
  color: '#ffffff',
  fontSize: '14px',
  borderRadius: '8px',
  padding: '12px 20px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
