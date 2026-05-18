'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Search, Archive, ExternalLink, Trash2, Edit2, X } from 'lucide-react'

interface ArchiveItem {
  id: string
  title: string
  category: string
  tags: string[]
  file_url: string | null
  notes: string | null
  created_at: string
}

const CATEGORIES = ['Documents', 'Photos', 'Videos', 'Reference', 'Projects', 'Finance', 'Other']

function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState('')

  function addTag(tag: string) {
    const trimmed = tag.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
    }
    setInput('')
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag))
  }

  return (
    <div className="border border-border rounded p-2 flex flex-wrap gap-1 min-h-9">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="flex items-center gap-1 text-xs">
          {tag}
          <button onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">
            <X className="w-2.5 h-2.5" />
          </button>
        </Badge>
      ))}
      <input
        className="flex-1 min-w-16 bg-transparent text-sm outline-none"
        placeholder="Add tag..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input) }
        }}
        onBlur={() => { if (input.trim()) addTag(input) }}
      />
    </div>
  )
}

function ItemDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initial?: Partial<ArchiveItem>
  onSave: (data: Partial<ArchiveItem>) => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'Documents')
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [fileUrl, setFileUrl] = useState(initial?.file_url ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setTitle(initial?.title ?? '')
    setCategory(initial?.category ?? 'Documents')
    setTags(initial?.tags ?? [])
    setFileUrl(initial?.file_url ?? '')
    setNotes(initial?.notes ?? '')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial])

  function handleSave() {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      category,
      tags,
      file_url: fileUrl || null,
      notes: notes || null,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{initial?.id ? 'Edit Item' : 'New Archive Item'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="item-title">Title</Label>
            <Input id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Item name" />
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
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} />
          </div>
          <div>
            <Label htmlFor="file-url">File URL</Label>
            <Input id="file-url" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label htmlFor="item-notes">Notes</Label>
            <Input id="item-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button className="w-full" onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ArchiveClient() {
  const [items, setItems] = useState<ArchiveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editItem, setEditItem] = useState<ArchiveItem | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('q', search)
    if (categoryFilter !== 'All') params.set('category', categoryFilter)
    const res = await fetch(`/api/archive/items?${params.toString()}`)
    const data = await res.json()
    setItems(data.items ?? [])
    setLoading(false)
  }, [search, categoryFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const timer = setTimeout(() => { void fetchData() }, 300)
    return () => clearTimeout(timer)
  }, [fetchData])

  async function handleSave(data: Partial<ArchiveItem>) {
    if (editItem) {
      await fetch(`/api/archive/items/${editItem.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } else {
      await fetch('/api/archive/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    }
    setEditItem(null)
    fetchData()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/archive/items/${id}`, { method: 'DELETE' })
    fetchData()
  }

  const categories = ['All', ...CATEGORIES]

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Personal Archive</h1>
          <p className="text-muted-foreground text-sm mt-1">Your personal reference library</p>
        </div>
        <Button onClick={() => { setEditItem(null); setDialogOpen(true) }}>
          <Plus className="w-4 h-4 mr-2" /> Add Item
        </Button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search archive..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Archive className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No items found.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.id} className="border border-border">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.category}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.file_url && (
                      <a href={item.file_url} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setDialogOpen(true) }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(item.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {item.notes && (
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{item.notes}</p>
                )}
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editItem ?? undefined}
        onSave={handleSave}
      />
    </div>
  )
}