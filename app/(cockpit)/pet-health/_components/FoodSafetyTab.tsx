'use client'

import { cardStyle, captionStyle, sectionTitle } from './PetCommon'

// Static toxic food lists — not user-editable per acceptance doc
// Pet Poison Helpline: 1-855-764-7661 (hardcoded per domain rule)

const CAT_TOXIC: { food: string; risk: string }[] = [
  { food: 'Onions & Garlic', risk: 'Hemolytic anemia — destroys red blood cells' },
  { food: 'Grapes & Raisins', risk: 'Kidney failure' },
  { food: 'Chocolate', risk: 'Theobromine toxicity — tremors, seizures' },
  { food: 'Xylitol (sugar-free)', risk: 'Liver failure, hypoglycemia' },
  { food: 'Alcohol', risk: 'CNS depression, respiratory failure' },
  { food: 'Caffeine', risk: 'Rapid heart rate, tremors' },
  { food: 'Raw dough / yeast', risk: 'Bloat, ethanol production in stomach' },
  { food: 'Macadamia nuts', risk: 'Weakness, hyperthermia' },
  { food: 'Raw fish (tuna, salmon)', risk: 'Thiamine deficiency with long-term feeding' },
  { food: 'Milk (large amounts)', risk: 'Lactose intolerance — vomiting, diarrhea' },
]

const DOG_TOXIC: { food: string; risk: string }[] = [
  { food: 'Grapes & Raisins', risk: 'Acute kidney failure — even small amounts' },
  { food: 'Chocolate', risk: 'Theobromine toxicity — tremors, seizures, death' },
  { food: 'Xylitol (sugar-free)', risk: 'Severe hypoglycemia, liver failure' },
  { food: 'Onions & Garlic', risk: 'Hemolytic anemia — destroys red blood cells' },
  { food: 'Macadamia nuts', risk: 'Weakness, vomiting, hyperthermia' },
  { food: 'Alcohol', risk: 'CNS depression, respiratory failure' },
  { food: 'Avocado', risk: 'Persin toxicity — vomiting, diarrhea' },
  { food: 'Caffeine', risk: 'Rapid heart rate, seizures' },
  { food: 'Raw dough / yeast', risk: 'Bloat, ethanol production in stomach' },
  { food: 'Cooked bones', risk: 'Splintering — intestinal perforation' },
  { food: 'Salt (large amounts)', risk: 'Sodium ion poisoning — tremors, seizures' },
  { food: 'Nutmeg', risk: 'Hallucinations, seizures (myristicin toxicity)' },
]

function ToxicTable({ items }: { items: { food: string; risk: string }[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
                textAlign: 'left',
                padding: '8px 12px',
                borderBottom: '1px solid var(--color-border)',
                whiteSpace: 'nowrap',
              }}
            >
              Food / Substance
            </th>
            <th
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-nano)',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-text-disabled)',
                textAlign: 'left',
                padding: '8px 12px',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              Why it&apos;s dangerous
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.food}>
              <td
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  fontWeight: 600,
                  color: 'var(--color-critical)',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  verticalAlign: 'top',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.food}
              </td>
              <td
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-small)',
                  color: 'var(--color-text-primary)',
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--color-border)',
                  verticalAlign: 'top',
                }}
              >
                {item.risk}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FoodSafetyTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Emergency banner */}
      <div
        style={{
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '2px solid var(--color-critical)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-nano)',
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--color-critical)',
              marginBottom: 4,
            }}
          >
            Pet Poison Emergency
          </div>
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-heading)',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '0.04em',
            }}
          >
            1-855-764-7661
          </div>
          <div style={captionStyle}>Pet Poison Helpline — 24/7</div>
        </div>
        <div style={captionStyle}>
          If you suspect poisoning, call immediately. Do not wait for symptoms to worsen.
        </div>
      </div>

      {/* Cat toxic foods */}
      <div style={cardStyle}>
        <span style={sectionTitle}>Cat — Toxic Foods</span>
        <ToxicTable items={CAT_TOXIC} />
      </div>

      {/* Dog toxic foods */}
      <div style={cardStyle}>
        <span style={sectionTitle}>Dog — Toxic Foods</span>
        <ToxicTable items={DOG_TOXIC} />
      </div>

      <p
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-nano)',
          color: 'var(--color-text-disabled)',
          margin: 0,
        }}
      >
        This list is a reference guide. When in doubt, contact your vet or the Pet Poison Helpline
        before giving any human food to your pet.
      </p>
    </div>
  )
}
