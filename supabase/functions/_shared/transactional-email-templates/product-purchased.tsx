import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  recipientName?: string | null
  productName?: string | null
  tariffName?: string | null
  accessEndAt?: string | null
  accessInfoHtml?: string | null
  introHtml?: string | null
  orderNumber?: string | null
  siteUrl?: string
}

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Arial, Helvetica, sans-serif',
  color: '#1a1a1a',
}

const container = {
  padding: '24px',
  maxWidth: '600px',
  margin: '0 auto',
}

const heading = {
  fontSize: '22px',
  fontWeight: 700,
  margin: '0 0 16px 0',
}

const paragraph = {
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 12px 0',
}

const infoBlock = {
  backgroundColor: '#f6f6f6',
  padding: '16px 20px',
  borderRadius: '8px',
  margin: '16px 0',
}

const smallMuted = {
  fontSize: '13px',
  color: '#6b6b6b',
  margin: '16px 0 0 0',
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

const Email = ({
  recipientName,
  productName,
  tariffName,
  accessEndAt,
  accessInfoHtml,
  introHtml,
  orderNumber,
  siteUrl = 'https://gorbova.by',
}: Props) => {
  const product = productName || 'Продукт'
  const tariffLine = tariffName ? ` (тариф «${tariffName}»)` : ''
  const endDate = fmtDate(accessEndAt)

  return (
    <Html lang="ru" dir="ltr">
      <Head />
      <Preview>Оплата получена — доступ к «{product}» открыт</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Спасибо за покупку!</Heading>

          <Text style={paragraph}>
            {recipientName ? `${recipientName}, ` : ''}вы успешно оплатили{' '}
            <strong>{product}</strong>
            {tariffLine}.
          </Text>

          {introHtml ? (
            <Text
              style={paragraph}
              dangerouslySetInnerHTML={{ __html: introHtml }}
            />
          ) : (
            <Text style={paragraph}>
              Доступ уже активирован в вашем личном кабинете.
            </Text>
          )}

          <Section style={infoBlock}>
            {endDate && (
              <Text style={{ ...paragraph, margin: '0 0 6px 0' }}>
                <strong>Доступ действует до:</strong> {endDate}
              </Text>
            )}
            {orderNumber && (
              <Text style={{ ...paragraph, margin: '0 0 6px 0' }}>
                <strong>Номер заказа:</strong> {orderNumber}
              </Text>
            )}
            {accessInfoHtml && (
              <Text
                style={{ ...paragraph, margin: '6px 0 0 0' }}
                dangerouslySetInnerHTML={{ __html: accessInfoHtml }}
              />
            )}
          </Section>

          <Text style={paragraph}>
            Открыть личный кабинет:{' '}
            <Link href={`${siteUrl}/purchases`}>{siteUrl}/purchases</Link>
          </Text>

          <Hr />

          <Text style={smallMuted}>
            Если у вас возникнут вопросы — просто ответьте на это письмо, мы
            всегда на связи.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (data: Props) =>
    `Доступ открыт: ${data.productName || 'ваш продукт'}`,
  displayName: 'Уведомление о покупке продукта',
  previewData: {
    recipientName: 'Екатерина',
    productName: 'Клуб «Горбова»',
    tariffName: '3 месяца',
    accessEndAt: new Date(Date.now() + 90 * 24 * 3600_000).toISOString(),
    orderNumber: 'GC-1024',
  },
} satisfies TemplateEntry
