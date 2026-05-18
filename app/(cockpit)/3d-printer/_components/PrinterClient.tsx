'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Printer, Trash2, Edit2 } from 'lucide-react'

interface PrinterProject {
  id: string
  name: string
  status: string
  material: string | null
  filament_grams: number | null
  print_time_min: number | null
  notes: string | null
  created_at: string
}

const STATUSES = ['queued', 'printing', 'done', 'failed', 'paused']

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  printing: 'bg-blue-500/20 text-blue-400',
  done: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  paused: 'bg-yellow-500/20 text-yellow-400',
}

function ProjectDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Partial<PrinterProject>
  onSave: (data: Partial<PrinterProject>) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [status, setStatus] = useState(initial?.status ?? 'queued')
  const [material, setMaterial] = useState(initial?.material ?? '')
  const [grams, setGrams] = useState(String(initial?.filament_grams ?? ''))
  const [printTime, setPrintTime] = useState(String(initial?.print_time_min ?? ''))
  const [notes, setNotes] = useState(initial?.notes ?? '')

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setName(initial?.name ?? '')
    setStatus(initial?.status ?? 'queued')
    setMaterial(initial?.material ?? '')
    setGrams(String(initial?.filament_grams ?? ''))
    setPrintTime(String(initial?.print_time_min ?? ''))
    setNotes(initial?.notes ?? '')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial])

  function handleSave() {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      status,
      material: material || null,
      filament_grams: grams ? parseInt(grams) : null,
      print_time_min: printTime ? parseInt(printTime) : null,
      notes: notes || null,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit Project' : 'New Project'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="project-name">Name</Label>
            <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Phone stand" />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="material">Material</Label>
              <Input id="material" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="PLA" />
            </div>
            <div>
              <Label htmlFor="grams">Filament (g)</Label>
              <Input id="grams" type="number" value={grams} onChange={(e) => setGrams(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="print-time">Print time (min)</Label>
            <Input id="print-time" type="number" value={printTime} onChange={(e) => setPrintTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="proj-notes">Notes</Label>
            <Input id="proj-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="w-full" onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function KanbanColumn({
  status,
  projects,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  status: string
  projects: PrinterProject[]
  onEdit: (p: PrinterProject) => void
  onDelete: (id: string) => void
  onStatusChange: (id: string, status: string) => void
}) {
  return (
    <div className="flex-1 min-w-48">
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_COLORS[status]}`}>
          {status}
        </span>
        <span className="text-xs text-muted-foreground">{projects.length}</span>
      </div>
      <div className="space-y-3">
        {projects.map((p) => (
          <Card key={p.id} className="border border-border">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-1">
                <div className="font-medium text-sm leading-tight">{p.name}</div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(p)}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDelete(p.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              {(p.material || p.filament_grams) && (
                <div className="text-xs text-muted-foreground mt-1">
                  {p.material && <span>{p.material}</span>}
                  {p.filament_grams && <span> · {p.filament_grams}g</span>}
                  {p.print_time_min && <span> · {Math.round(p.print_time_min / 60)}h</span>}
                </div>
              )}
              <Select value={p.status} onValueChange={(v) => onStatusChange(p.id, v)}>
                <SelectTrigger className="h-6 text-xs mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        ))}
        {projects.length === 0 && (
          <div className="border border-dashed border-border rounded p-3 text-xs text-muted-foreground text-center">
            Empty
          </div>
        )}
      </div>
    </div>
  )
}

export function PrinterClient() {
  const [projects, setProjects] = useState<PrinterProject[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editProject, setEditProject] = useState<PrinterProject | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/3d-printer/projects')
    const data = await res.json()
    setProjects(data.projects ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData()
  }, [fetchData])

  async function handleSave(data: Partial<PrinterProject>) {
    if (editProject) {
      await fetch(`/api/3d-printer/projects/${editProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } else {
      await fetch('/api/3d-printer/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    setEditProject(null)
    fetchData()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/3d-printer/projects/${id}`, { method: 'DELETE' })
    fetchData()
  }

  async function handleStatusChange(id: string, status: string) {
    await fetch(`/api/3d-printer/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchData()
  }

  const byStatus = (s: string) => projects.filter((p) => p.status === s)
  const totalGrams = projects.filter((p) => p.status === 'done').reduce((acc, p) => acc + (p.filament_grams ?? 0), 0)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">3D Printer HQ</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage your print queue and project history</p>
        </div>
        <Button onClick={() => { setEditProject(null); setDialogOpen(true) }}>
          <Plus className="w-4 h-4 mr-2" /> New Project
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{projects.length}</div>
            <div className="text-sm text-muted-foreground flex items-center gap-1"><Printer className="w-3.5 h-3.5" /> Total projects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-blue-400">{byStatus('printing').length}</div>
            <div className="text-sm text-muted-foreground">Currently printing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-400">{totalGrams}g</div>
            <div className="text-sm text-muted-foreground">Filament used (done)</div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {STATUSES.map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              projects={byStatus(s)}
              onEdit={(p) => { setEditProject(p); setDialogOpen(true) }}
              onDelete={handleDelete}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editProject ?? undefined}
        onSave={handleSave}
      />
    </div>
  )
}