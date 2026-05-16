import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { HitListClient } from './_components/HitListClient'
import { ScanResultsTab } from './_components/ScanResultsTab'

export const dynamic = 'force-dynamic'

export default async function HitListsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="w-full">
      <Tabs defaultValue="book-lists">
        <TabsList className="mb-4">
          <TabsTrigger value="book-lists">Book Lists</TabsTrigger>
          <TabsTrigger value="scan-results">Scan Results</TabsTrigger>
        </TabsList>
        <TabsContent value="book-lists">
          <HitListClient />
        </TabsContent>
        <TabsContent value="scan-results">
          <div className="px-4 pb-6">
            <div className="mb-4">
              <h1 className="text-foreground text-xl font-semibold">Scan Results</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Recent StockTrack deals — add to watchlist or skip
              </p>
            </div>
            <ScanResultsTab />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
