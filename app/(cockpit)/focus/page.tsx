// F18: bench=focus_sessions WHERE pomodoro_type='work' AND status='completed' per day vs 4-pomodoro target; surface=morning_digest focus line + /focus today header
// module_metric: focus_sessions (pomodoro completions, elapsed_seconds), open_loops (count), time_blocks (day plan)

import dynamic from 'next/dynamic'

const FocusPage = dynamic(() => import('./_components/FocusPage').then((m) => m.FocusPage))

export const metadata = { title: 'Focus — LepiOS' }

export default function Page() {
  return <FocusPage />
}
