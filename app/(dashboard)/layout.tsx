import { CockpitNav } from '@/app/(cockpit)/_components/CockpitNav'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <CockpitNav />
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
