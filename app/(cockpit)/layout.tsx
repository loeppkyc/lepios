import { CockpitNav } from './_components/CockpitNav'

export default function CockpitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <CockpitNav />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
