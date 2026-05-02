import { CockpitSidebar } from './_components/CockpitSidebar'

export default function CockpitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <CockpitSidebar />
      <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
    </div>
  )
}
