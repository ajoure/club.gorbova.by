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
  paidAmount?: number | null
  currency?: string | null
  paidAt?: string | null
  siteUrl?: string
}

const BRAND = '#B08D57' // тёплое золото Gorbova
const BRAND_DARK = '#8a6b3d'
const INK = '#1a1a1a'
const MUTED = '#6b6b6b'

const main = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  color: INK,
  margin: '0',
  padding: '0',
}

const outer = {
  padding: '32px 16px',
  backgroundColor: '#f5f2ec',
}

const container = {
  maxWidth: '600px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '14px',
  overflow: 'hidden',
  boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
}

const header = {
  backgroundColor: BRAND,
  padding: '28px 32px',
  textAlign: 'center' as const,
}

const headerBadge = {
  display: 'inline-block',
  padding: '6px 14px',
  borderRadius: '999px',
  backgroundColor: 'rgba(255,255,255,0.2)',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '0.5px',
  margin: '0 0 12px 0',
}

const headerTitle = {
  color: '#ffffff',
  fontSize: '26px',
  fontWeight: 700,
  margin: '0',
  lineHeight: '32px',
}

const body = {
  padding: '32px',
}

const greeting = {
  fontSize: '17px',
  lineHeight: '26px',
  margin: '0 0 16px 0',
  color: INK,
}

const paragraph = {
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 12px 0',
  color: '#333',
}

const productCard = {
  backgroundColor: '#faf7f2',
  border: `1px solid ${BRAND}22`,
  borderRadius: '10px',
  padding: '20px 22px',
  margin: '20px 0 8px 0',
}

const productLabel = {
  fontSize: '12px',
  color: MUTED,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.6px',
  margin: '0 0 6px 0',
  fontWeight: 600,
}

const productTitle = {
  fontSize: '18px',
  fontWeight: 700,
  color: INK,
  margin: '0 0 4px 0',
  lineHeight: '24px',
}

const tariffText = {
  fontSize: '14px',
  color: BRAND_DARK,
  margin: '0',
  fontWeight: 500,
}

const detailsTable = {
  width: '100%',
  margin: '16px 0 0 0',
  borderCollapse: 'collapse' as const,
}

const detailRow = {
  padding: '10px 0',
  fontSize: '14px',
  borderBottom: '1px solid #eee',
}

const detailLabel = {
  color: MUTED,
  fontWeight: 500,
  width: '45%',
}

const detailValue = {
  color: INK,
  fontWeight: 600,
  textAlign: 'right' as const,
}

const ctaWrap = {
  textAlign: 'center' as const,
  margin: '28px 0 8px 0',
}

const ctaLink = {
  display: 'inline-block',
  backgroundColor: BRAND,
  color: '#ffffff',
  padding: '13px 28px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontSize: '15px',
  fontWeight: 600,
}

const footer = {
  padding: '20px 32px 28px 32px',
  fontSize: '13px',
  color: MUTED,
  lineHeight: '20px',
}

const brandFoot = {
  fontSize: '12px',
  color: MUTED,
  textAlign: 'center' as const,
  padding: '0 0 24px 0',
  margin: '0',
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

function fmtMoney(amount?: number | null, currency?: string | null): string | null {
  if (amount == null || Number.isNaN(Number(amount))) return null
  const cur = (currency || 'BYN').toUpperCase()
  const sign = cur === 'BYN' ? 'BYN' : cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur
  const n = Number(amount)
  const formatted = n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return cur === 'BYN' ? `${formatted} BYN` : `${formatted} ${sign}`
}

const Email = ({
  recipientName,
  productName,
  tariffName,
  accessEndAt,
  accessInfoHtml,
  introHtml,
  orderNumber,
  paidAmount,
  currency,
  paidAt,
  siteUrl = 'https://gorbova.by',
}: Props) => {
  const product = productName || 'Продукт'
  const endDate = fmtDate(accessEndAt)
  const paidDate = fmtDate(paidAt)
  const money = fmtMoney(paidAmount, currency)

  return (
    <Html lang="ru" dir="ltr">
      <Head />
      <Preview>Оплата получена — доступ к «{product}» открыт</Preview>
      <Body style={main}>
        <Section style={outer}>
          <Container style={container}>
            <Section style={header}>
              <Text style={headerBadge}>✓ ОПЛАТА ПОЛУЧЕНА</Text>
              <Heading style={headerTitle}>Спасибо за покупку!</Heading>
            </Section>

            <Section style={body}>
              <Text style={greeting}>
                {recipientName ? `${recipientName}, здравствуйте!` : 'Здравствуйте!'}
              </Text>

              <Text style={paragraph}>
                Мы получили вашу оплату — доступ уже открыт в личном кабинете.
              </Text>

              {introHtml ? (
                <Text style={paragraph} dangerouslySetInnerHTML={{ __html: introHtml }} />
              ) : null}

              <Section style={productCard}>
                <Text style={productLabel}>Вы приобрели</Text>
                <Text style={productTitle}>{product}</Text>
                {tariffName && <Text style={tariffText}>Тариф: {tariffName}</Text>}

                <table style={detailsTable} cellPadding={0} cellSpacing={0}>
                  <tbody>
                    {money && (
                      <tr>
                        <td style={{ ...detailRow, ...detailLabel }}>Сумма оплаты</td>
                        <td style={{ ...detailRow, ...detailValue }}>{money}</td>
                      </tr>
                    )}
                    {paidDate && (
                      <tr>
                        <td style={{ ...detailRow, ...detailLabel }}>Дата оплаты</td>
                        <td style={{ ...detailRow, ...detailValue }}>{paidDate}</td>
                      </tr>
                    )}
                    {endDate && (
                      <tr>
                        <td style={{ ...detailRow, ...detailLabel }}>Доступ до</td>
                        <td style={{ ...detailRow, ...detailValue }}>{endDate}</td>
                      </tr>
                    )}
                    {orderNumber && (
                      <tr>
                        <td style={{ ...detailRow, ...detailLabel, borderBottom: 'none' }}>Номер заказа</td>
                        <td style={{ ...detailRow, ...detailValue, borderBottom: 'none' }}>{orderNumber}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Section>

              {accessInfoHtml && (
                <Text style={paragraph} dangerouslySetInnerHTML={{ __html: accessInfoHtml }} />
              )}

              <Section style={ctaWrap}>
                <Link href={`${siteUrl}/purchases`} style={ctaLink}>
                  Открыть личный кабинет →
                </Link>
              </Section>

              <Hr style={{ borderColor: '#eee', margin: '24px 0 16px 0' }} />

              <Text style={{ ...paragraph, color: MUTED, fontSize: '13px' }}>
                Если у вас возникнут вопросы — просто ответьте на это письмо, мы всегда на связи.
              </Text>
            </Section>

            <Section style={footer}>
              <Text style={{ margin: 0, color: MUTED }}>
                С уважением,<br />
                команда Екатерины Горбовой
              </Text>
            </Section>
          </Container>

          <Text style={brandFoot}>
            <Link href={siteUrl} style={{ color: MUTED, textDecoration: 'none' }}>
              gorbova.by
            </Link>
          </Text>
        </Section>
      </Body>
    </Html>
  )
}

export const template = {
  component: Email,
  subject: (data: Props) =>
    `✓ Оплата получена: ${data.productName || 'ваш продукт'}`,
  displayName: 'Уведомление о покупке продукта',
  previewData: {
    recipientName: 'Сергей',
    productName: 'Gorbova Club — идеология',
    tariffName: 'Доступ к +600 ответов',
    accessEndAt: new Date(Date.now() + 90 * 24 * 3600_000).toISOString(),
    paidAmount: 490,
    currency: 'BYN',
    paidAt: new Date().toISOString(),
    orderNumber: 'GC-1024',
  },
} satisfies TemplateEntry
