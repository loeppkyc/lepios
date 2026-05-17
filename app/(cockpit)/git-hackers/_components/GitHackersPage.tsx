'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitHubTrendingTab } from './GitHubTrendingTab'
import { HNHiringTab } from './HNHiringTab'

export function GitHackersPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">GitHackers</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          GitHub trending repos and HN hiring posts — market signal for the stack
        </p>
      </div>

      <Tabs defaultValue="github">
        <TabsList>
          <TabsTrigger value="github">GitHub Trending</TabsTrigger>
          <TabsTrigger value="hn">HN Who&apos;s Hiring</TabsTrigger>
        </TabsList>

        <TabsContent value="github" className="mt-4">
          <GitHubTrendingTab />
        </TabsContent>

        <TabsContent value="hn" className="mt-4">
          <HNHiringTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
