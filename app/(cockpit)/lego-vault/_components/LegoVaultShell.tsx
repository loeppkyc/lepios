'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { VaultTab } from './VaultTab'
import { AddSetTab } from './AddSetTab'
import { PriceCheckTab } from './PriceCheckTab'
import { AnalyticsTab } from './AnalyticsTab'
import { RadarTab } from './RadarTab'

export function LegoVaultShell() {
  return (
    <div className="min-h-screen bg-[var(--color-base)] px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-[var(--font-ui)] font-bold text-[var(--color-text-primary)]">
            Lego Vault
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Sealed set investment tracker — Amazon.ca pricing via Keepa
          </p>
        </div>

        <Tabs defaultValue="vault">
          <TabsList className="mb-6">
            <TabsTrigger value="vault">Vault</TabsTrigger>
            <TabsTrigger value="add">Add Set</TabsTrigger>
            <TabsTrigger value="price-check">Price Check</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="radar">Buy &amp; Hold Radar</TabsTrigger>
          </TabsList>

          <TabsContent value="vault">
            <VaultTab />
          </TabsContent>

          <TabsContent value="add">
            <AddSetTab />
          </TabsContent>

          <TabsContent value="price-check">
            <PriceCheckTab />
          </TabsContent>

          <TabsContent value="analytics">
            <AnalyticsTab />
          </TabsContent>

          <TabsContent value="radar">
            <RadarTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
