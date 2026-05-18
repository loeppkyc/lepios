'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Trash2 } from 'lucide-react'

interface CalendarNote {
  id: string
  note_date: string
  title: string
  category: string
  content: string | null
  created_at: string
}

const CATEGORIES = ['Personal', 'Work', 'Finance', 'Health', 'Family', 'Reminder', 'Other']

const CATEGORY_COLORS: Record<string, string> = {
  Personal: 'bg-purple-500',
  Work: 'bg-blue-500',
  Finance: 'bg-green-500',
  Health: 'bg-red-500',
  Family: 'bg-orange-500',
  Reminder: 'bg-yellow-500',
  Other: 'bg-gray-500',
}

function NoteDialog({
  open,
  onOpenChange,
  defaultDate,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultDate: string
  onSave: (data: Partial<CalendarNote>) => void
}) {
  const [date, setDate] = useState(defaultDate)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Personal')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setDate(defaultDate)
    setTitle('')
    setCategory('Personal')
    setContent('')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, defaultDate])

  function handleSave() {
    if (!title.trim() || !date) return
    onSave({ note_date: date, title: title.trim(), category, content: content || null })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Note</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="note-date">Date</Label>
            <Input id="note-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="note-title">Title</Label>
            <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Note title" />
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
            <Label htmlFor="note-content">Content</Label>
            <textarea
              id="note-content"
              className="w-full text-sm bg-muted rounded p-2 border border-border resize-none h-24 focus:outline-none focus:ring-1 focus:ring-ring"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Optional details..."
            />
          </div>
          <Button className="w-full" onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function formatYM(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function formatDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function CalendarClient() {
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [notes, setNotes] = useState<CalendarNote[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogDate, setDialogDate] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/calendar/notes?year=${viewYear}&month=${viewMonth + 1}`)
    const data = await res.json()
    setNotes(data.notes ?? [])
    setLoading(false)
  }, [viewYear, viewMonth])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData()
  }, [fetchData])

  async function handleSave(data: Partial<CalendarNote>) {
    await fetch('/api/calendar/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    fetchData()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/calendar/notes/${id}`, { method: 'DELETE' })
    fetchData()
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11) }
    else setViewMonth(viewMonth - 1)
    setSelectedDay(null)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0) }
    else setViewMonth(viewMonth + 1)
    setSelectedDay(null)
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const monthName = new Date(viewYear, viewMonth).toLocaleString('default', { month: 'long' })

  const notesByDate: Record<string, CalendarNote[]> = {}
  for (const n of notes) {
    if (!notesByDate[n.note_date]) notesByDate[n.note_date] = []
    notesByDate[n.note_date].push(n)
  }

  const todayKey = formatDateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const selectedNotes = selectedDay ? (notesByDate[selectedDay] ?? []) : []

  const upcoming14 = notes
    .filter((n) => n.note_date >= todayKey)
    .sort((a, b) => a.note_date.localeCompare(b.note_date))
    .slice(0, 14)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
          <p className="text-muted-foreground text-sm mt-1">Notes and reminders by date</p>
        </div>
        <Button onClick={() => { setDialogDate(todayKey); setDialogOpen(true) }}>
          <Plus className="w-4 h-4 mr-2" /> Add Note
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{monthName} {viewYear}</CardTitle>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prevMonth}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={nextMonth}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-px mb-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="text-xs text-muted-foreground text-center font-medium py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-10" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const dateKey = formatDateKey(viewYear, viewMonth, day)
                  const dayNotes = notesByDate[dateKey] ?? []
                  const isToday = dateKey === todayKey
                  const isSelected = dateKey === selectedDay

                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDay(isSelected ? null : dateKey)}
                      className={`h-10 rounded text-sm flex flex-col items-center justify-start pt-1 transition-colors relative
                        ${isToday ? 'bg-primary text-primary-foreground' : ''}
                        ${isSelected && !isToday ? 'bg-accent' : ''}
                        ${!isToday && !isSelected ? 'hover:bg-muted' : ''}
                      `}
                    >
                      <span>{day}</span>
                      {dayNotes.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5">
                          {dayNotes.slice(0, 3).map((n) => (
                            <div
                              key={n.id}
                              className={`w-1 h-1 rounded-full ${CATEGORY_COLORS[n.category] ?? 'bg-gray-400'}`}
                            />
                          ))}
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {selectedDay && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{selectedDay}</CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setDialogDate(selectedDay); setDialogOpen(true) }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {selectedNotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes for this day.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedNotes.map((n) => (
                      <div key={n.id} className="flex items-start justify-between gap-2 p-2 rounded bg-muted">
                        <div>
                          <div className="text-sm font-medium">{n.title}</div>
                          <Badge variant="outline" className="text-xs mt-0.5">{n.category}</Badge>
                          {n.content && <p className="text-xs text-muted-foreground mt-1">{n.content}</p>}
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => handleDelete(n.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CalendarDays className="w-4 h-4" /> Upcoming 14 days
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming14.length === 0 ? (
                <p className="text-xs text-muted-foreground">No upcoming notes.</p>
              ) : (
                <div className="space-y-2">
                  {upcoming14.map((n) => (
                    <div key={n.id} className="flex items-start gap-2">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${CATEGORY_COLORS[n.category] ?? 'bg-gray-400'}`} />
                      <div>
                        <div className="text-xs text-muted-foreground">{n.note_date}</div>
                        <div className="text-sm font-medium leading-tight">{n.title}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <NoteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultDate={dialogDate}
        onSave={handleSave}
      />
    </div>
  )
}