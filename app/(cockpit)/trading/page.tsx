// F18: bench=trading_page_load<500ms; surface=trades count + AI picks today
// module_metric: trades WHERE person_handle='colin' AND created_at > now()-7d
import dynamic from 'next/dynamic'

const TradingPage = dynamic(() => import('./_components/TradingPage').then((m) => m.TradingPage), {
  ssr: false,
})

export const metadata = { title: 'Trading Journal — LepiOS' }

export default function Page() {
  return <TradingPage />
}
