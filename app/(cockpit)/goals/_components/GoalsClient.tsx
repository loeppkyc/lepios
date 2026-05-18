'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Plus, Flame, Target, Trash2, Edit2 } from 'lucide-react'

interface Habit {
  id: string
  name: string
  category: string
  frequency: string
  target_days_per_week: number
  active: boolean
  created_at: string
}

interface HabitEntry {
  id: string
  habit_id: string
  completed_on: string
  note: string | null
}

const CATEGORIES = ['Health', 'Fitness', 'Learning', 'Finance', 'Mindset', 'Social', 'Other']
const FREQUENCIES = ['daily', 'weekly']

function formatDateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getStreakCount(entries: HabitEntry[], habitId: string): number {
  const dates = entries
    .filter((e) => e.habit_id === habitId)
    .map((e) => e.completed_on)
    .sort()
    .reverse()
  if (dates.length === 0) return 0
  let streak = 0
  const today = new Date()
  const cursor = new Date(today)
  for (let i = 0; i < 90; i++) {
    const key = formatDateKey(cursor)
    if (dates.includes(key)) {
      streak++
    } else if (i > 0) {
      break
    }
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function HeatmapCalendar({ entries, habitId }: { entries: HabitEntry[]; habitId: string }) {
  const completedDates = new Set(entries.filter((e) => e.habit_id === habitId).map((e) => e.completed_on))
  const days: Date[] = []
  const today = new Date()
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    days.push(d)
  }
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {days.map((d) => {
        const key = formatDateKey(d)
        const done = completedDates.has(key)
        return (
          <div
            key={key}
            title={key}
            className={`w-4 h-4 rounded-sm ${done ? 'bg-green-500' : 'bg-muted'}`}
          />
        )
      })}
    </div>
  )
}

function HabitDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Partial<Habit>
  onSave: (data: Partial<Habit>) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'Health')
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'daily')
  const [targetDays, setTargetDays] = useState(String(initial?.target_days_per_week ?? 7))

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(initial?.name ?? '')
    setCategory(initial?.category ?? 'Health')
    setFrequency(initial?.frequency ?? 'daily')
    setTargetDays(String(initial?.target_days_per_week ?? 7))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial])

  function handleSave() {
    if (!name.trim()) return
    onSave({ name: name.trim(), category, frequency, target_days_per_week: parseInt(targetDays) })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit Habit' : 'New Habit'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="habit-name">Name</Label>
            <Input id="habit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning walk" />
          </div>
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="target-days">Target days/week</Label>
            <Input
              id="target-days"
              type="number"
              min={1}
              max={7}
              value={targetDays}
              onChange={(e) => setTargetDays(e.target.value)}
            />
          </div>
          <Button className="w-full" onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function HabitCard({
  habit,
  entries,
  todayKey,
  onToggle,
  onEdit,
  onDelete,
}: {
  habit: Habit
  entries: HabitEntry[]
  todayKey: string
  onToggle: (habitId: string, checked: boolean) => void
  onEdit: (habit: Habit) => void
  onDelete: (id: string) => void
}) {
  const streak = getStreakCount(entries, habit.id)
  const completedToday = entries.some((e) => e.habit_id === habit.id && e.completed_on === todayKey)

  return (
    <Card className="border border-border">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={completedToday}
              onChange={(e) => onToggle(habit.id, e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
            <div>
              <div className="font-medium text-sm">{habit.name}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">{habit.category}</Badge>
                <span className="text-xs text-muted-foreground">{habit.frequency}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {streak > 0 && (
              <div className="flex items-center gap-1 text-orange-500 text-sm">
                <Flame className="w-3.5 h-3.5" />
                <span className="font-semibold">{streak}</span>
              </div>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(habit)}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => onDelete(habit.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <HeatmapCalendar entries={entries} habitId={habit.id} />
      </CardContent>
    </Card>
  )
}

export function GoalsClient() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [entries, setEntries] = useState<HabitEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('All')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editHabit, setEditHabit] = useState<Habit | null>(null)

  const todayKey = formatDateKey(new Date())

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [hRes, eRes] = await Promise.all([
      fetch('/api/goals/habits'),
      fetch(`/api/goals/entries?since=${formatDateKey(new Date(Date.now() - 27 * 86400000))}`),
    ])
    const hData = await hRes.json()
    const eData = await eRes.json()
    setHabits(hData.habits ?? [])
    setEntries(eData.entries ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData()
  }, [fetchData])

  async function handleSaveHabit(data: Partial<Habit>) {
    if (editHabit) {
      await fetch(`/api/goals/habits/${editHabit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } else {
      await fetch('/api/goals/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    setEditHabit(null)
    fetchData()
  }

  async function handleToggle(habitId: string, checked: boolean) {
    if (checked) {
      await fetch('/api/goals/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ habit_id: habitId, completed_on: todayKey }),
      })
    } else {
      const entry = entries.find((e) => e.habit_id === habitId && e.completed_on === todayKey)
      if (entry) {
        await fetch(`/api/goals/entries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ habit_id: habitId, completed_on: todayKey, _delete: true }),
        })
      }
    }
    fetchData()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/goals/habits/${id}`, { method: 'DELETE' })
    fetchData()
  }

  const categories = ['All', ...Array.from(new Set(habits.map((h) => h.category)))]
  const filtered = activeCategory === 'All' ? habits : habits.filter((h) => h.category === activeCategory)
  const completedToday = habits.filter((h) => entries.some((e) => e.habit_id === h.id && e.completed_on === todayKey)).length
  const totalStreakDays = habits.reduce((acc, h) => acc + getStreakCount(entries, h.id), 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Goals & Habits</h1>
          <p className="text-muted-foreground text-sm mt-1">Build momentum through daily consistency</p>
        </div>
        <Button onClick={() => { setEditHabit(null); setDialogOpen(true) }}>
          <Plus className="w-4 h-4 mr-2" /> New Habit
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{habits.length}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1"><Target className="w-3.5 h-3.5" /> Active habits</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-500">{completedToday}</div>
            <div className="text-sm text-muted-foreground">Done today</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-orange-500 flex items-center gap-1"><Flame className="w-5 h-5" />{totalStreakDays}</div>
            <div className="text-sm text-muted-foreground">Total streak days</div>
          </CardContent>
        </Card>
      </div>

      {categories.length > 2 && (
        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList>
            {categories.map((c) => <TabsTrigger key={c} value={c}>{c}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No habits yet. Add your first habit to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((h) => (
            <HabitCard
              key={h.id}
              habit={h}
              entries={entries}
              todayKey={todayKey}
              onToggle={handleToggle}
              onEdit={(habit) => { setEditHabit(habit); setDialogOpen(true) }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <HabitDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editHabit ?? undefined}
        onSave={handleSaveHabit}
      />
    </div>
  )
}