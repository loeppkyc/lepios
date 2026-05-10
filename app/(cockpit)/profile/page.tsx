// F18: bench=profile_save_latency<200ms; surface=agent_events event_type=profile_update
// module_metric: agent_events WHERE event_type = 'profile_update'
import { ProfilePage } from './_components/ProfilePage'

export const metadata = { title: 'Profile — LepiOS' }
export default function Page() {
  return <ProfilePage />
}
