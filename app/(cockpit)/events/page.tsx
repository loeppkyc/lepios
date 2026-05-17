// F18: bench=events_fetched>0 on any weekday; surface=agent_events WHERE action='events_fetched'
// module_metric: open_data_count + eventbrite_count per fetch run
// F17: exemption granted — display-only lifestyle module; logs events_viewed on page load
import { EventsPageClient } from './_components/EventsPageClient'

export const metadata = { title: 'Free Events — LepiOS' }

export default function Page() {
  return <EventsPageClient />
}
