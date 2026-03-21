import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type ModuleKey = 'habits' | 'performances'
type ViewKey = 'overview' | 'habits' | 'performances' | 'goals'
type InputKind = 'tristate' | 'score' | 'checklist' | 'numeric' | 'note'
type Priority = 'high' | 'medium' | 'low' | 'archived'
type EntryState = 'unknown' | 'success' | 'excused' | 'rest' | 'inactive'
type FrequencyKind = 'daily' | 'weekdays' | 'selected'
type OccurrenceKind = 'standard' | 'review'
type TargetMode = 'atLeast' | 'atMost' | 'exactly'
type GoalHorizon = 'week' | 'month' | 'quarter' | 'year' | 'life'

type TrackerItem = {
  id: string
  module: ModuleKey
  title: string
  description: string
  inputKind: InputKind
  priority: Priority
  checklistTemplate: string[]
  target: { mode: TargetMode; value: number; unit: string } | null
  frequency: { kind: FrequencyKind; days: number[] } | null
  restAfterSuccess: number
}

type TrackerEntry = {
  state: EntryState
  score: number | null
  checklist: boolean[]
  numericValue: number | null
  note: string
}

type TrackerOccurrence = {
  id: string
  module: ModuleKey
  kind: OccurrenceKind
  label: string
  key: number
  date: string | null
  createdAt: string
  entries: Record<string, TrackerEntry>
}

type Goal = {
  id: string
  title: string
  description: string
  horizon: GoalHorizon
  dueDate: string
  resultKind: InputKind
  priority: Priority
  reminder: boolean
  checklistTemplate: string[]
  target: { mode: TargetMode; value: number; unit: string } | null
  status: EntryState
  score: number | null
  checklist: boolean[]
  numericValue: number | null
  note: string
}

type AppState = {
  trackerItems: TrackerItem[]
  occurrences: TrackerOccurrence[]
  goals: Goal[]
}

type TrackerDraft = {
  module: ModuleKey
  title: string
  description: string
  inputKind: InputKind
  priority: Priority
  frequencyKind: FrequencyKind
  frequencyDays: number[]
  restAfterSuccess: number
  checklistText: string
  targetMode: TargetMode
  targetValue: number
  targetUnit: string
}

type GoalDraft = {
  title: string
  description: string
  horizon: GoalHorizon
  dueDate: string
  resultKind: InputKind
  priority: Priority
  reminder: boolean
  checklistText: string
  targetMode: TargetMode
  targetValue: number
  targetUnit: string
}

const storageKey = 'application-de-suivi-v2'
const today = '2026-03-21'
const todayDate = new Date(`${today}T00:00:00`)
const longDateFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

const priorityOrder: Priority[] = ['high', 'medium', 'low', 'archived']
const horizonOrder: GoalHorizon[] = ['week', 'month', 'quarter', 'year', 'life']
const dayLabels = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

const defaultTrackerDraft = (module: ModuleKey): TrackerDraft => ({
  module,
  title: '',
  description: '',
  inputKind: 'tristate',
  priority: 'medium',
  frequencyKind: 'daily',
  frequencyDays: [1, 2, 3, 4, 5],
  restAfterSuccess: 0,
  checklistText: '',
  targetMode: 'atLeast',
  targetValue: 1,
  targetUnit: '',
})

const defaultGoalDraft = (): GoalDraft => ({
  title: '',
  description: '',
  horizon: 'week',
  dueDate: today,
  resultKind: 'tristate',
  priority: 'medium',
  reminder: true,
  checklistText: '',
  targetMode: 'atLeast',
  targetValue: 1,
  targetUnit: '',
})

const seedTrackerItems: TrackerItem[] = []

const seedGoals: Goal[] = []

function emptyEntry(item: TrackerItem): TrackerEntry {
  return {
    state: 'unknown',
    score: null,
    checklist: item.inputKind === 'checklist' ? item.checklistTemplate.map(() => false) : [],
    numericValue: null,
    note: '',
  }
}

function compareNumeric(mode: TargetMode, value: number, target: number) {
  if (mode === 'atLeast') {
    return value >= target
  }
  if (mode === 'atMost') {
    return value <= target
  }
  return value === target
}

function deriveState(item: TrackerItem, entry: TrackerEntry): EntryState {
  if (entry.state === 'rest' || entry.state === 'inactive') {
    return entry.state
  }

  if (item.inputKind === 'tristate') {
    return entry.state
  }

  if (item.inputKind === 'score') {
    if (entry.score == null) {
      return 'unknown'
    }
    return entry.score >= 3 ? 'success' : 'unknown'
  }

  if (item.inputKind === 'checklist') {
    if (!entry.checklist.length) {
      return 'unknown'
    }
    return entry.checklist.every(Boolean) ? 'success' : 'unknown'
  }

  if (item.inputKind === 'numeric') {
    if (entry.numericValue == null || !item.target) {
      return 'unknown'
    }
    return compareNumeric(item.target.mode, entry.numericValue, item.target.value) ? 'success' : 'unknown'
  }

  return entry.note.trim() ? 'success' : 'unknown'
}

function goalState(goal: Goal): EntryState {
  if (goal.resultKind === 'tristate') {
    return goal.status
  }
  if (goal.resultKind === 'score') {
    return goal.score != null && goal.score >= 3 ? 'success' : 'unknown'
  }
  if (goal.resultKind === 'checklist') {
    return goal.checklist.length > 0 && goal.checklist.every(Boolean) ? 'success' : 'unknown'
  }
  if (goal.resultKind === 'numeric') {
    return goal.numericValue != null && goal.target
      ? compareNumeric(goal.target.mode, goal.numericValue, goal.target.value) ? 'success' : 'unknown'
      : 'unknown'
  }
  return goal.note.trim() ? 'success' : 'unknown'
}

function isHabitActive(item: TrackerItem, date: string) {
  const day = new Date(`${date}T00:00:00`).getDay()
  if (!item.frequency) {
    return true
  }
  if (item.frequency.kind === 'daily') {
    return true
  }
  if (item.frequency.kind === 'weekdays') {
    return day >= 1 && day <= 5
  }
  return item.frequency.days.includes(day)
}

function latestSuccessDate(itemId: string, occurrences: TrackerOccurrence[]) {
  return occurrences
    .filter((occurrence) => occurrence.module === 'habits' && occurrence.kind === 'standard' && occurrence.date)
    .sort((left, right) => right.key - left.key)
    .find((occurrence) => occurrence.entries[itemId]?.state === 'success')
    ?.date ?? null
}

function latestSuccessIteration(itemId: string, occurrences: TrackerOccurrence[]) {
  return occurrences
    .filter((occurrence) => occurrence.module === 'performances' && occurrence.kind === 'standard')
    .sort((left, right) => right.key - left.key)
    .find((occurrence) => occurrence.entries[itemId]?.state === 'success')
    ?.key ?? null
}

function daysBetween(start: string, end: string) {
  const a = new Date(`${start}T00:00:00`).getTime()
  const b = new Date(`${end}T00:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

function shiftDate(date: string, delta: number) {
  return new Date(new Date(`${date}T00:00:00`).getTime() + delta * 86400000).toISOString().slice(0, 10)
}

function formatLongDate(date: string | null | undefined) {
  if (!date) {
    return 'Aucun jour'
  }

  return longDateFormatter.format(new Date(`${date}T12:00:00`))
}

function createOccurrence(
  module: ModuleKey,
  kind: OccurrenceKind,
  items: TrackerItem[],
  occurrences: TrackerOccurrence[],
): TrackerOccurrence {
  if (module === 'habits') {
    const standardCount = occurrences.filter((occurrence) => occurrence.module === 'habits' && occurrence.kind === 'standard').length
    const reviewCount = occurrences.filter((occurrence) => occurrence.module === 'habits' && occurrence.kind === 'review').length
    const occurrenceDate = kind === 'standard'
      ? new Date(todayDate.getTime() + standardCount * 86400000).toISOString().slice(0, 10)
      : new Date(todayDate.getTime() + reviewCount * 7 * 86400000).toISOString().slice(0, 10)
    const key = Math.floor(new Date(`${occurrenceDate}T00:00:00`).getTime() / 86400000)
    const entries = Object.fromEntries(
      items
        .filter((item) => item.module === 'habits')
        .map((item) => {
          const base = emptyEntry(item)
          if (kind === 'review') {
            return [item.id, base]
          }
          const lastSuccess = latestSuccessDate(item.id, occurrences)
          const inRest = lastSuccess
            ? item.restAfterSuccess > 0 && daysBetween(lastSuccess, occurrenceDate) > 0 && daysBetween(lastSuccess, occurrenceDate) <= item.restAfterSuccess
            : false
          if (!isHabitActive(item, occurrenceDate)) {
            return [item.id, { ...base, state: 'inactive' as EntryState }]
          }
          if (inRest) {
            return [item.id, { ...base, state: 'rest' as EntryState }]
          }
          return [item.id, base]
        }),
    )

    return {
      id: crypto.randomUUID(),
      module,
      kind,
      label: kind === 'standard'
        ? formatLongDate(occurrenceDate)
        : `Bilan semaine ${reviewCount + 1}`,
      key,
      date: occurrenceDate,
      createdAt: new Date().toISOString(),
      entries,
    }
  }

  const standardCount = occurrences.filter((occurrence) => occurrence.module === 'performances' && occurrence.kind === 'standard').length
  const reviewCount = occurrences.filter((occurrence) => occurrence.module === 'performances' && occurrence.kind === 'review').length
  const key = kind === 'standard' ? standardCount + 1 : reviewCount + 1
  const entries = Object.fromEntries(
    items
      .filter((item) => item.module === 'performances')
      .map((item) => {
        const base = emptyEntry(item)
        if (kind === 'review') {
          return [item.id, base]
        }
        const lastSuccess = latestSuccessIteration(item.id, occurrences)
        const inRest = lastSuccess != null && item.restAfterSuccess > 0 && key - lastSuccess > 0 && key - lastSuccess <= item.restAfterSuccess
        if (inRest) {
          return [item.id, { ...base, state: 'rest' as EntryState }]
        }
        return [item.id, base]
      }),
  )

  return {
    id: crypto.randomUUID(),
    module,
    kind,
    label: kind === 'standard' ? `Iteration ${key}` : `Bilan iterations ${key}`,
    key,
    date: null,
    createdAt: new Date().toISOString(),
    entries,
  }
}

function seedState(): AppState {
  return { trackerItems: seedTrackerItems, occurrences: [], goals: seedGoals }
}

function loadState(): AppState {
  const raw = localStorage.getItem(storageKey)
  if (!raw) {
    return seedState()
  }

  try {
    const parsed = JSON.parse(raw) as AppState
    return parsed
  } catch {
    return seedState()
  }
}

function priorityLabel(priority: Priority) {
  return {
    high: 'Forte',
    medium: 'Intermediaire',
    low: 'Faible',
    archived: 'Archive',
  }[priority]
}

function entryLabel(state: EntryState) {
  return {
    unknown: 'A remplir',
    success: 'Reussi',
    excused: 'Excuse',
    rest: 'Repos',
    inactive: 'Non concerne',
  }[state]
}

function horizonLabel(horizon: GoalHorizon) {
  return {
    week: 'Semaine',
    month: 'Mois',
    quarter: 'Trimestre',
    year: 'Annee',
    life: 'Vie',
  }[horizon]
}

function periodLabel(goal: Goal) {
  if (goal.horizon === 'life') {
    return 'Long terme'
  }

  const date = new Date(`${goal.dueDate}T12:00:00`)
  if (goal.horizon === 'week') {
    return `Semaine du ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date)}`
  }
  if (goal.horizon === 'month') {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date)
  }
  if (goal.horizon === 'quarter') {
    return `T${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
  }
  return String(date.getFullYear())
}

function parseChecklist(text: string) {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

function sortGoals(goals: Goal[]) {
  return [...goals].sort((left, right) => {
    const horizonDelta = horizonOrder.indexOf(left.horizon) - horizonOrder.indexOf(right.horizon)
    if (horizonDelta !== 0) {
      return horizonDelta
    }

    if (left.dueDate !== right.dueDate) {
      return left.dueDate.localeCompare(right.dueDate)
    }

    return priorityOrder.indexOf(left.priority) - priorityOrder.indexOf(right.priority)
  })
}

function buildHabitOccurrenceForDate(
  date: string,
  items: TrackerItem[],
  occurrences: TrackerOccurrence[],
  source?: TrackerOccurrence,
): TrackerOccurrence {
  const key = Math.floor(new Date(`${date}T00:00:00`).getTime() / 86400000)
  const baseEntries = Object.fromEntries(
    items
      .filter((item) => item.module === 'habits')
      .map((item) => {
        const base = emptyEntry(item)
        const lastSuccess = latestSuccessDate(item.id, occurrences)
        const inRest = lastSuccess
          ? item.restAfterSuccess > 0 && daysBetween(lastSuccess, date) > 0 && daysBetween(lastSuccess, date) <= item.restAfterSuccess
          : false
        if (!isHabitActive(item, date)) {
          return [item.id, { ...base, state: 'inactive' as EntryState }]
        }
        if (inRest) {
          return [item.id, { ...base, state: 'rest' as EntryState }]
        }
        return [item.id, base]
      }),
  )

  const entries = source
    ? Object.fromEntries(
        Object.entries(baseEntries).map(([itemId, baseEntry]) => {
          const currentEntry = source.entries[itemId]
          if (!currentEntry) {
            return [itemId, baseEntry]
          }

          if (baseEntry.state === 'rest' || baseEntry.state === 'inactive') {
            return [itemId, { ...currentEntry, state: baseEntry.state }]
          }

          const item = items.find((candidate) => candidate.id === itemId)!
          const merged = { ...currentEntry, state: deriveState(item, currentEntry) }
          return [itemId, merged]
        }),
      )
    : baseEntries

  return {
    id: source?.id ?? `preview-${date}`,
    module: 'habits',
    kind: 'standard',
    label: formatLongDate(date),
    key,
    date,
    createdAt: source?.createdAt ?? new Date().toISOString(),
    entries,
  }
}

function createHabitOccurrenceForDate(date: string, items: TrackerItem[], occurrences: TrackerOccurrence[]) {
  const preview = buildHabitOccurrenceForDate(date, items, occurrences)
  return {
    ...preview,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
}

function App() {
  const [view, setView] = useState<ViewKey>('habits')
  const [state, setState] = useState<AppState>(() => loadState())
  const [habitPriorityFilter, setHabitPriorityFilter] = useState<'all' | Priority>('all')
  const [performancePriorityFilter, setPerformancePriorityFilter] = useState<'all' | Priority>('all')
  const [goalView, setGoalView] = useState<'week' | 'month' | 'year' | 'all'>('all')
  const [showHabitDetails, setShowHabitDetails] = useState(false)
  const [showPerformanceDetails, setShowPerformanceDetails] = useState(false)
  const [hideRestingPerformances, setHideRestingPerformances] = useState(true)
  const [selectedHabitDate, setSelectedHabitDate] = useState(today)
  const [performanceOccurrenceId, setPerformanceOccurrenceId] = useState('')
  const [trackerDraft, setTrackerDraft] = useState<TrackerDraft>(defaultTrackerDraft('habits'))
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(defaultGoalDraft())
  const [reminderPreview, setReminderPreview] = useState<string[]>([])
  const [adminMessage, setAdminMessage] = useState('Pret a synchroniser le systeme.')
  const importFieldId = useId()
  const [importJson, setImportJson] = useState('')

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  const habitItems = state.trackerItems.filter((item) => item.module === 'habits')
  const performanceItems = state.trackerItems.filter((item) => item.module === 'performances')
  const habitOccurrences = state.occurrences
    .filter((occurrence) => occurrence.module === 'habits' && occurrence.kind === 'standard')
    .sort((left, right) => right.key - left.key)
  const performanceOccurrences = state.occurrences
    .filter((occurrence) => occurrence.module === 'performances')
    .sort((left, right) => right.key - left.key)

  useEffect(() => {
    if (!performanceOccurrenceId && performanceOccurrences[0]) {
      setPerformanceOccurrenceId(performanceOccurrences[0].id)
    }
  }, [performanceOccurrences, performanceOccurrenceId])

  const selectedHabitOccurrence = habitOccurrences.find((occurrence) => occurrence.date === selectedHabitDate)
  const resolvedHabitOccurrence = buildHabitOccurrenceForDate(selectedHabitDate, state.trackerItems, state.occurrences, selectedHabitOccurrence)
  const selectedPerformanceOccurrence = performanceOccurrences.find((occurrence) => occurrence.id === performanceOccurrenceId) ?? performanceOccurrences[0]
  const selectedHabitDateLabel = formatLongDate(selectedHabitDate)
  const previousHabitDate = shiftDate(selectedHabitDate, -1)
  const nextHabitDate = shiftDate(selectedHabitDate, 1)

  const sortedGoals = sortGoals(state.goals)
  const visibleGoals = sortedGoals.filter((goal) => {
    if (goalView === 'all') {
      return true
    }
    if (goalView === 'week') {
      return goal.horizon === 'week'
    }
    if (goalView === 'month') {
      return goal.horizon === 'month'
    }
    return goal.horizon === 'year' || goal.horizon === 'quarter' || goal.horizon === 'life'
  })

  const dueTodayGoals = sortedGoals.filter((goal) => goal.reminder && goal.dueDate === today)

  function patchState(patch: Partial<AppState>) {
    setState((current) => ({ ...current, ...patch }))
  }

  function recalcModule(module: ModuleKey) {
    const rebuilt = state.occurrences
      .filter((occurrence) => occurrence.module !== module)
      .concat(
        state.occurrences
          .filter((occurrence) => occurrence.module === module)
          .sort((left, right) => left.key - right.key)
          .reduce<TrackerOccurrence[]>((rebuiltModule, occurrence) => {
            const rebuiltOccurrence = createOccurrence(module, occurrence.kind, state.trackerItems, rebuilt.concat(rebuiltModule))
            const mergedEntries = Object.fromEntries(
              Object.entries(rebuiltOccurrence.entries).map(([itemId, baseEntry]) => {
                const currentEntry = occurrence.entries[itemId]
                if (!currentEntry) {
                  return [itemId, baseEntry]
                }

                if (baseEntry.state === 'rest' || baseEntry.state === 'inactive') {
                  return [itemId, { ...currentEntry, state: baseEntry.state }]
                }

                const item = state.trackerItems.find((candidate) => candidate.id === itemId)!
                const merged = { ...currentEntry, state: deriveState(item, currentEntry) }
                return [itemId, merged]
              }),
            )

            rebuiltModule.push({ ...occurrence, entries: mergedEntries })
            return rebuiltModule
          }, []),
      )

    patchState({ occurrences: rebuilt })
    setAdminMessage(`Synchronisation ${module === 'habits' ? 'Habitudes' : 'Performances'} terminee.`)
  }

  function createNewOccurrence(module: ModuleKey, kind: OccurrenceKind) {
    const occurrence = createOccurrence(module, kind, state.trackerItems, state.occurrences)
    patchState({ occurrences: [...state.occurrences, occurrence] })
    if (module === 'performances') {
      setPerformanceOccurrenceId(occurrence.id)
    }
    setAdminMessage(`${kind === 'review' ? 'Bilan' : module === 'habits' ? 'Nouveau jour' : 'Nouvelle iteration'} cree.`)
  }

  function updateTrackerEntry(occurrenceId: string, itemId: string, patch: Partial<TrackerEntry>) {
    const item = state.trackerItems.find((candidate) => candidate.id === itemId)!
    const existingOccurrence = state.occurrences.find((occurrence) => occurrence.id === occurrenceId)

    if (!existingOccurrence && item.module === 'habits') {
      const createdOccurrence = createHabitOccurrenceForDate(selectedHabitDate, state.trackerItems, state.occurrences)
      const current = createdOccurrence.entries[itemId]
      const next = { ...current, ...patch }
      next.state = deriveState(item, next)

      patchState({
        occurrences: [...state.occurrences, {
          ...createdOccurrence,
          entries: {
            ...createdOccurrence.entries,
            [itemId]: next,
          },
        }],
      })
      return
    }

    patchState({
      occurrences: state.occurrences.map((occurrence) => {
        if (occurrence.id !== occurrenceId) {
          return occurrence
        }

        const current = occurrence.entries[itemId]
        const next = { ...current, ...patch }
        next.state = deriveState(item, next)

        return {
          ...occurrence,
          entries: {
            ...occurrence.entries,
            [itemId]: next,
          },
        }
      }),
    })
  }

  function setTriState(occurrenceId: string, itemId: string, stateValue: EntryState) {
    updateTrackerEntry(occurrenceId, itemId, { state: stateValue })
  }

  function addTrackerItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checklistTemplate = trackerDraft.inputKind === 'checklist' ? parseChecklist(trackerDraft.checklistText) : []
    const item: TrackerItem = {
      id: crypto.randomUUID(),
      module: trackerDraft.module,
      title: trackerDraft.title,
      description: trackerDraft.description,
      inputKind: trackerDraft.inputKind,
      priority: trackerDraft.priority,
      checklistTemplate,
      target: trackerDraft.inputKind === 'numeric'
        ? { mode: trackerDraft.targetMode, value: Number(trackerDraft.targetValue), unit: trackerDraft.targetUnit }
        : null,
      frequency: trackerDraft.module === 'habits'
        ? { kind: trackerDraft.frequencyKind, days: trackerDraft.frequencyDays }
        : null,
      restAfterSuccess: Number(trackerDraft.restAfterSuccess),
    }

    const nextItems = [...state.trackerItems, item]
    const nextOccurrences = state.occurrences.map((occurrence) => {
      if (occurrence.module !== trackerDraft.module) {
        return occurrence
      }

      const synthetic = createOccurrence(occurrence.module, occurrence.kind, nextItems, state.occurrences.filter((candidate) => candidate.id !== occurrence.id))
      const baseEntry = synthetic.entries[item.id]
      return {
        ...occurrence,
        entries: {
          ...occurrence.entries,
          [item.id]: baseEntry,
        },
      }
    })

    patchState({ trackerItems: nextItems, occurrences: nextOccurrences })
    setTrackerDraft(defaultTrackerDraft(trackerDraft.module))
    setAdminMessage(`${trackerDraft.module === 'habits' ? 'Habitude' : 'Performance'} ajoutee.`)
  }

  function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const goal: Goal = {
      id: crypto.randomUUID(),
      title: goalDraft.title,
      description: goalDraft.description,
      horizon: goalDraft.horizon,
      dueDate: goalDraft.dueDate,
      resultKind: goalDraft.resultKind,
      priority: goalDraft.priority,
      reminder: goalDraft.reminder,
      checklistTemplate: goalDraft.resultKind === 'checklist' ? parseChecklist(goalDraft.checklistText) : [],
      target: goalDraft.resultKind === 'numeric'
        ? { mode: goalDraft.targetMode, value: Number(goalDraft.targetValue), unit: goalDraft.targetUnit }
        : null,
      status: 'unknown',
      score: null,
      checklist: goalDraft.resultKind === 'checklist' ? parseChecklist(goalDraft.checklistText).map(() => false) : [],
      numericValue: null,
      note: '',
    }

    patchState({ goals: [...state.goals, goal] })
    setGoalDraft(defaultGoalDraft())
    setAdminMessage('Objectif ajoute.')
  }

  function updateGoal(goalId: string, patch: Partial<Goal>) {
    patchState({
      goals: state.goals.map((goal) => goal.id === goalId ? { ...goal, ...patch } : goal),
    })
  }

  function testReminders() {
    setReminderPreview(
      dueTodayGoals.length > 0
        ? dueTodayGoals.map((goal) => `${horizonLabel(goal.horizon)} · ${goal.title} · ${periodLabel(goal)}`)
        : ['Aucun objectif a echeance aujourd hui.'],
    )
    setAdminMessage('Test rappels execute.')
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'application-de-suivi-export.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function importState() {
    if (!importJson.trim()) {
      return
    }

    try {
      const parsed = JSON.parse(importJson) as AppState
      setState(parsed)
      setAdminMessage('Import JSON charge.')
      setImportJson('')
    } catch {
      setAdminMessage('Import JSON invalide.')
    }
  }

  function stepHabitDate(direction: 'previous' | 'next') {
    setSelectedHabitDate(direction === 'previous' ? previousHabitDate : nextHabitDate)
  }

  function habitHistory(itemId: string) {
    return habitOccurrences.slice(0, 7).map((occurrence) => ({
      occurrenceId: occurrence.id,
      date: occurrence.date ?? '',
      state: occurrence.entries[itemId]?.state ?? 'unknown',
    }))
  }

  function renderTrackerInput(occurrence: TrackerOccurrence, item: TrackerItem) {
    const entry = occurrence.entries[item.id]

    if (entry.state === 'rest' || entry.state === 'inactive') {
      return <span className={`pill state-${entry.state}`}>{entryLabel(entry.state)}</span>
    }

    if (item.inputKind === 'tristate') {
      return (
        <div className="tri-state">
          <button type="button" className={entry.state === 'unknown' ? 'active' : ''} onClick={() => setTriState(occurrence.id, item.id, 'unknown')}>Neutre</button>
          <button type="button" className={entry.state === 'success' ? 'active' : ''} onClick={() => setTriState(occurrence.id, item.id, 'success')}>Valide</button>
          <button type="button" className={entry.state === 'excused' ? 'active' : ''} onClick={() => setTriState(occurrence.id, item.id, 'excused')}>Excuse</button>
        </div>
      )
    }

    if (item.inputKind === 'score') {
      return (
        <div className="inline-field">
          <input
            type="range"
            min="0"
            max="4"
            step="1"
            value={entry.score ?? 0}
            onChange={(event) => updateTrackerEntry(occurrence.id, item.id, { score: Number(event.target.value) })}
          />
          <strong>{entry.score ?? 0}/4</strong>
        </div>
      )
    }

    if (item.inputKind === 'checklist') {
      return (
        <div className="checklist-box">
          {item.checklistTemplate.map((label, index) => (
            <label key={label} className="check-item">
              <input
                type="checkbox"
                checked={entry.checklist[index] ?? false}
                onChange={(event) => {
                  const next = [...entry.checklist]
                  next[index] = event.target.checked
                  updateTrackerEntry(occurrence.id, item.id, { checklist: next })
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )
    }

    if (item.inputKind === 'numeric') {
      return (
        <div className="inline-field">
          <input
            type="number"
            value={entry.numericValue ?? ''}
            onChange={(event) => updateTrackerEntry(occurrence.id, item.id, { numericValue: event.target.value === '' ? null : Number(event.target.value) })}
          />
          <span className="muted-inline">{item.target ? `${item.target.mode === 'atLeast' ? '>= ' : item.target.mode === 'atMost' ? '<= ' : '= '}${item.target.value} ${item.target.unit}` : ''}</span>
        </div>
      )
    }

    return (
      <textarea
        value={entry.note}
        onChange={(event) => updateTrackerEntry(occurrence.id, item.id, { note: event.target.value })}
        placeholder="Observation, contexte, journal..."
      />
    )
  }

  function renderGoalInput(goal: Goal) {
    if (goal.resultKind === 'tristate') {
      return (
        <div className="tri-state">
          <button type="button" className={goal.status === 'unknown' ? 'active' : ''} onClick={() => updateGoal(goal.id, { status: 'unknown' })}>Neutre</button>
          <button type="button" className={goal.status === 'success' ? 'active' : ''} onClick={() => updateGoal(goal.id, { status: 'success' })}>Realise</button>
          <button type="button" className={goal.status === 'excused' ? 'active' : ''} onClick={() => updateGoal(goal.id, { status: 'excused' })}>Reporte</button>
        </div>
      )
    }

    if (goal.resultKind === 'score') {
      return (
        <div className="inline-field">
          <input type="range" min="0" max="4" step="1" value={goal.score ?? 0} onChange={(event) => updateGoal(goal.id, { score: Number(event.target.value) })} />
          <strong>{goal.score ?? 0}/4</strong>
        </div>
      )
    }

    if (goal.resultKind === 'checklist') {
      return (
        <div className="checklist-box">
          {goal.checklistTemplate.map((label, index) => (
            <label key={label} className="check-item">
              <input
                type="checkbox"
                checked={goal.checklist[index] ?? false}
                onChange={(event) => {
                  const next = [...goal.checklist]
                  next[index] = event.target.checked
                  updateGoal(goal.id, { checklist: next })
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )
    }

    if (goal.resultKind === 'numeric') {
      return (
        <div className="inline-field">
          <input
            type="number"
            value={goal.numericValue ?? ''}
            onChange={(event) => updateGoal(goal.id, { numericValue: event.target.value === '' ? null : Number(event.target.value) })}
          />
          <span className="muted-inline">{goal.target ? `${goal.target.mode === 'atLeast' ? '>= ' : goal.target.mode === 'atMost' ? '<= ' : '= '}${goal.target.value} ${goal.target.unit}` : ''}</span>
        </div>
      )
    }

    return <textarea value={goal.note} onChange={(event) => updateGoal(goal.id, { note: event.target.value })} placeholder="Resultat, apprentissage, synthese..." />
  }

  const visibleHabitItems = habitItems.filter((item) => habitPriorityFilter === 'all' || item.priority === habitPriorityFilter)
  const visiblePerformanceItems = performanceItems
    .filter((item) => performancePriorityFilter === 'all' || item.priority === performancePriorityFilter)
    .filter((item) => !hideRestingPerformances || selectedPerformanceOccurrence?.entries[item.id]?.state !== 'rest')

  return (
    <div className="shell compact-shell">
      <aside className="sidebar compact-sidebar">
        <div className="brand compact-brand">
          <div className="brand-mark">DS</div>
          <div>
            <h1>Application de suivi</h1>
            <p>{habitItems.length} habitudes · {performanceItems.length} performances · {sortedGoals.length} objectifs</p>
          </div>
        </div>

        <nav className="nav compact-nav">
          <button type="button" className={`nav-link ${view === 'habits' ? 'active' : ''}`} onClick={() => { setView('habits'); setTrackerDraft(defaultTrackerDraft('habits')) }}>Habitudes</button>
          <button type="button" className={`nav-link ${view === 'performances' ? 'active' : ''}`} onClick={() => { setView('performances'); setTrackerDraft(defaultTrackerDraft('performances')) }}>Performances</button>
          <button type="button" className={`nav-link ${view === 'goals' ? 'active' : ''}`} onClick={() => setView('goals')}>Objectifs</button>
        </nav>

        <div className="status-pills">
          <span className="ghost-pill">Jour: {selectedHabitDateLabel}</span>
          <span className="ghost-pill">Rappels: {dueTodayGoals.length}</span>
        </div>

        <details className="settings-menu">
          <summary aria-label="Reglages globaux">⚙</summary>
          <div className="menu-popover">
            <button type="button" className="ghost-button" onClick={() => recalcModule('habits')}>Sync habitudes</button>
            <button type="button" className="ghost-button" onClick={() => recalcModule('performances')}>Sync performances</button>
            <button type="button" className="ghost-button" onClick={exportJson}>Exporter JSON</button>
          </div>
        </details>

        <details className="panel compact-panel">
          <summary>Importer un export JSON</summary>
          <div className="form-grid compact-form">
            <label htmlFor={importFieldId} className="muted-label">Coller un export JSON</label>
            <textarea id={importFieldId} value={importJson} onChange={(event) => setImportJson(event.target.value)} placeholder="Coller un export JSON pour recharger l'app" />
            <button type="button" className="ghost-button" onClick={importState}>Importer</button>
          </div>
        </details>

        <p className="sidebar-note">{adminMessage}</p>
      </aside>

      <main className="main compact-main">
        <section className="topbar panel">
          <div>
            <span className="eyebrow">{view === 'habits' ? 'Habitudes' : view === 'performances' ? 'Performances' : 'Objectifs'}</span>
            <div><h2>{view === 'habits' ? 'Une vue journaliere nette, avec historique integre.' : view === 'performances' ? 'Des iterations simples, lisibles et sans bruit.' : 'Des echeances calmes, mais visibles au bon moment.'}</h2><p className="topbar-copy">Interface compacte, menus discrets, cartes plus nettes et lecture plus editoriale.</p></div>
          </div>
          <div className="status-pills">
            <span className="ghost-pill">Local-first</span>
            <span className="ghost-pill">JSON export</span>
          </div>
        </section>

        {view === 'habits' && (
          <section className="workspace-grid compact-grid">
            <article className="panel panel-large">
              <div className="panel-head compact-head">
                <div>
                  <span className="eyebrow">Habitudes</span>
                  <h3>{selectedHabitDateLabel}</h3>
                </div>
                <details className="settings-menu inline-settings">
                  <summary aria-label="Reglages habitudes">⚙</summary>
                  <div className="menu-popover">
                    <button type="button" className="ghost-button" onClick={() => createNewOccurrence('habits', 'review')}>Nouveau bilan</button>
                    <button type="button" className="ghost-button" onClick={() => recalcModule('habits')}>Recalcul global</button>
                  </div>
                </details>
              </div>

              <div className="toolbar compact-toolbar">
                <div className="date-nav">
                  <span>Jour</span>
                  <div className="date-nav-controls">
                    <button type="button" className="date-arrow" onClick={() => stepHabitDate('previous')} aria-label="Jour precedent">‹</button>
                    <strong>{selectedHabitDateLabel}</strong>
                    <button type="button" className="date-arrow" onClick={() => stepHabitDate('next')} aria-label="Jour suivant">›</button>
                  </div>
                </div>
                <label className="field">
                  <span>Priorite</span>
                  <select value={habitPriorityFilter} onChange={(event) => setHabitPriorityFilter(event.target.value as 'all' | Priority)}>
                    <option value="all">Toutes</option>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                </label>
                <label className="toggle"><input type="checkbox" checked={showHabitDetails} onChange={(event) => setShowHabitDetails(event.target.checked)} /> Details</label>
              </div>

              <div className="tracker-list">
                {visibleHabitItems.length === 0 && (
                  <article className="panel empty-panel">
                    <span className="eyebrow">Habitudes</span>
                    <h3>Aucune habitude pour le moment</h3>
                    <p>Tu n as encore rien ajoute. Commence par creer ta premiere consigne personnelle.</p>
                  </article>
                )}
                {visibleHabitItems.map((item) => (
                  <article key={item.id} className="tracker-card compact-card">
                    <div className="tracker-head">
                      <div>
                        <strong>{item.title}</strong>
                        <div className="tracker-meta">
                          <span className={`pill priority-${item.priority}`}>{priorityLabel(item.priority)}</span>
                          <span className={`pill state-${resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown'}`}>{entryLabel(resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown')}</span>
                        </div>
                      </div>
                    </div>

                    {showHabitDetails && <p className="compact-description">{item.description}</p>}

                    <div className="history-row">
                      <span className="history-label">Historique</span>
                      <div className="history-strip">
                        {habitHistory(item.id).length > 0 ? habitHistory(item.id).map((history) => (
                          <button
                            key={`${item.id}-${history.occurrenceId}`}
                            type="button"
                            className={`history-chip state-${history.state} ${history.date === selectedHabitDate ? 'active' : ''}`}
                            onClick={() => setSelectedHabitDate(history.date)}
                          >
                            <span>{history.date.slice(5)}</span>
                            <strong>{entryLabel(history.state)}</strong>
                          </button>
                        )) : <span className="muted-inline">Pas encore d historique.</span>}
                      </div>
                    </div>

                    {renderTrackerInput(resolvedHabitOccurrence, item)}
                  </article>
                ))}
              </div>
            </article>

            <article className="stack">
              <details className="panel compact-panel">
                <summary>Ajouter une habitude</summary>
                <form className="form-grid compact-form" onSubmit={addTrackerItem}>
                  <input required value={trackerDraft.title} onChange={(event) => setTrackerDraft({ ...trackerDraft, title: event.target.value, module: 'habits' })} placeholder="Nom de l'habitude" />
                  <textarea value={trackerDraft.description} onChange={(event) => setTrackerDraft({ ...trackerDraft, description: event.target.value, module: 'habits' })} placeholder="Consigne ou description" />
                  <select value={trackerDraft.inputKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, inputKind: event.target.value as InputKind, module: 'habits' })}>
                    <option value="tristate">Validation tri-etat</option>
                    <option value="score">Score 0-4</option>
                    <option value="checklist">Checklist</option>
                    <option value="numeric">Valeur chiffree</option>
                    <option value="note">Note libre</option>
                  </select>
                  <select value={trackerDraft.priority} onChange={(event) => setTrackerDraft({ ...trackerDraft, priority: event.target.value as Priority, module: 'habits' })}>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                  <select value={trackerDraft.frequencyKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, frequencyKind: event.target.value as FrequencyKind, module: 'habits' })}>
                    <option value="daily">Tous les jours</option>
                    <option value="weekdays">Jours de semaine</option>
                    <option value="selected">Certains jours</option>
                  </select>
                  {trackerDraft.frequencyKind === 'selected' && (
                    <div className="weekday-picker">
                      {dayLabels.map((label, day) => (
                        <label key={label} className="weekday-chip">
                          <input
                            type="checkbox"
                            checked={trackerDraft.frequencyDays.includes(day)}
                            onChange={(event) => setTrackerDraft({
                              ...trackerDraft,
                              frequencyDays: event.target.checked
                                ? [...trackerDraft.frequencyDays, day].sort((a, b) => a - b)
                                : trackerDraft.frequencyDays.filter((value) => value !== day),
                              module: 'habits',
                            })}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <input type="number" min="0" value={trackerDraft.restAfterSuccess} onChange={(event) => setTrackerDraft({ ...trackerDraft, restAfterSuccess: Number(event.target.value), module: 'habits' })} placeholder="Repos apres succes" />
                  {trackerDraft.inputKind === 'checklist' && (
                    <input value={trackerDraft.checklistText} onChange={(event) => setTrackerDraft({ ...trackerDraft, checklistText: event.target.value, module: 'habits' })} placeholder="Checklist separee par virgules" />
                  )}
                  {trackerDraft.inputKind === 'numeric' && (
                    <>
                      <select value={trackerDraft.targetMode} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetMode: event.target.value as TargetMode, module: 'habits' })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={trackerDraft.targetValue} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetValue: Number(event.target.value), module: 'habits' })} placeholder="Cible" />
                      <input value={trackerDraft.targetUnit} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetUnit: event.target.value, module: 'habits' })} placeholder="Unite" />
                    </>
                  )}
                  <button type="submit">Ajouter l'habitude</button>
                </form>
              </details>
            </article>
          </section>
        )}

        {view === 'performances' && (
          <section className="workspace-grid compact-grid">
            <article className="panel panel-large">
              <div className="panel-head compact-head">
                <div>
                  <span className="eyebrow">Performances</span>
                  <h3>{selectedPerformanceOccurrence ? selectedPerformanceOccurrence.label : 'Aucune iteration creee pour le moment'}</h3>
                </div>
                <details className="settings-menu inline-settings">
                  <summary aria-label="Reglages performances">⚙</summary>
                  <div className="menu-popover">
                    <button type="button" className="ghost-button" onClick={() => createNewOccurrence('performances', 'standard')}>Nouvelle iteration</button>
                    <button type="button" className="ghost-button" onClick={() => createNewOccurrence('performances', 'review')}>Nouveau bilan</button>
                    <button type="button" className="ghost-button" onClick={() => recalcModule('performances')}>Recalcul global</button>
                  </div>
                </details>
              </div>

              <div className="toolbar compact-toolbar">
                <label className="field">
                  <span>Iteration</span>
                  <select value={performanceOccurrenceId} onChange={(event) => setPerformanceOccurrenceId(event.target.value)}>
                    {performanceOccurrences.map((occurrence) => (
                      <option key={occurrence.id} value={occurrence.id}>{occurrence.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Priorite</span>
                  <select value={performancePriorityFilter} onChange={(event) => setPerformancePriorityFilter(event.target.value as 'all' | Priority)}>
                    <option value="all">Toutes</option>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                </label>
                <label className="toggle"><input type="checkbox" checked={showPerformanceDetails} onChange={(event) => setShowPerformanceDetails(event.target.checked)} /> Details</label>
                <label className="toggle"><input type="checkbox" checked={hideRestingPerformances} onChange={(event) => setHideRestingPerformances(event.target.checked)} /> Masquer repos</label>
              </div>

              <div className="tracker-list">
                {visiblePerformanceItems.length === 0 && (
                  <article className="panel empty-panel">
                    <span className="eyebrow">Performances</span>
                    <h3>Aucune performance pour le moment</h3>
                    <p>Ajoute tes propres axes de progression avant de lancer une iteration.</p>
                  </article>
                )}
                {visiblePerformanceItems.map((item) => (
                  <article key={item.id} className="tracker-card compact-card">
                    <div className="tracker-head">
                      <div>
                        <strong>{item.title}</strong>
                        <div className="tracker-meta">
                          <span className={`pill priority-${item.priority}`}>{priorityLabel(item.priority)}</span>
                          <span className={`pill state-${selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown'}`}>{entryLabel(selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown')}</span>
                        </div>
                      </div>
                    </div>
                    {showPerformanceDetails && <p className="compact-description">{item.description}</p>}
                    {selectedPerformanceOccurrence ? renderTrackerInput(selectedPerformanceOccurrence, item) : <p className="muted-inline">Cree d abord une iteration pour saisir tes performances.</p>}
                  </article>
                ))}
              </div>
            </article>

            <article className="stack">
              <details className="panel compact-panel">
                <summary>Ajouter une performance</summary>
                <form className="form-grid compact-form" onSubmit={addTrackerItem}>
                  <input required value={trackerDraft.title} onChange={(event) => setTrackerDraft({ ...trackerDraft, title: event.target.value, module: 'performances' })} placeholder="Nom de la performance" />
                  <textarea value={trackerDraft.description} onChange={(event) => setTrackerDraft({ ...trackerDraft, description: event.target.value, module: 'performances' })} placeholder="Consigne ou description" />
                  <select value={trackerDraft.inputKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, inputKind: event.target.value as InputKind, module: 'performances' })}>
                    <option value="tristate">Validation tri-etat</option>
                    <option value="score">Score 0-4</option>
                    <option value="checklist">Checklist</option>
                    <option value="numeric">Valeur chiffree</option>
                    <option value="note">Note libre</option>
                  </select>
                  <select value={trackerDraft.priority} onChange={(event) => setTrackerDraft({ ...trackerDraft, priority: event.target.value as Priority, module: 'performances' })}>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                  <input type="number" min="0" value={trackerDraft.restAfterSuccess} onChange={(event) => setTrackerDraft({ ...trackerDraft, restAfterSuccess: Number(event.target.value), module: 'performances' })} placeholder="Repos apres succes" />
                  {trackerDraft.inputKind === 'checklist' && (
                    <input value={trackerDraft.checklistText} onChange={(event) => setTrackerDraft({ ...trackerDraft, checklistText: event.target.value, module: 'performances' })} placeholder="Checklist separee par virgules" />
                  )}
                  {trackerDraft.inputKind === 'numeric' && (
                    <>
                      <select value={trackerDraft.targetMode} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetMode: event.target.value as TargetMode, module: 'performances' })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={trackerDraft.targetValue} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetValue: Number(event.target.value), module: 'performances' })} placeholder="Cible" />
                      <input value={trackerDraft.targetUnit} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetUnit: event.target.value, module: 'performances' })} placeholder="Unite" />
                    </>
                  )}
                  <button type="submit">Ajouter la performance</button>
                </form>
              </details>
            </article>
          </section>
        )}

        {view === 'goals' && (
          <section className="workspace-grid compact-grid">
            <article className="panel panel-large">
              <div className="panel-head compact-head">
                <div>
                  <span className="eyebrow">Objectifs</span>
                  <h3>Echeances et progression</h3>
                </div>
                <details className="settings-menu inline-settings">
                  <summary aria-label="Reglages objectifs">⚙</summary>
                  <div className="menu-popover">
                    <button type="button" className="ghost-button" onClick={() => patchState({ goals: sortGoals(state.goals) })}>Trier</button>
                    <button type="button" className="ghost-button" onClick={testReminders}>Tester les rappels</button>
                  </div>
                </details>
              </div>

              <div className="toolbar compact-toolbar">
                <label className="field">
                  <span>Vue</span>
                  <select value={goalView} onChange={(event) => setGoalView(event.target.value as 'week' | 'month' | 'year' | 'all')}>
                    <option value="all">Tous les objectifs</option>
                    <option value="week">Cette semaine</option>
                    <option value="month">Ce mois</option>
                    <option value="year">Cette annee et +</option>
                  </select>
                </label>
              </div>

              <div className="goal-list">
                {visibleGoals.length === 0 && (
                  <article className="panel empty-panel">
                    <span className="eyebrow">Objectifs</span>
                    <h3>Aucun objectif pour le moment</h3>
                    <p>Ajoute seulement les objectifs que tu veux vraiment suivre.</p>
                  </article>
                )}
                {visibleGoals.map((goal) => (
                  <article key={goal.id} className={`goal-card horizon-${goal.horizon}`}>
                    <div className="goal-head">
                      <div>
                        <strong>{goal.title}</strong>
                        <div className="tracker-meta">
                          <span className={`pill priority-${goal.priority}`}>{priorityLabel(goal.priority)}</span>
                          <span className={`pill state-${goalState(goal)}`}>{entryLabel(goalState(goal))}</span>
                          <span className="ghost-pill">{periodLabel(goal)}</span>
                        </div>
                      </div>
                      <small>{goal.dueDate}</small>
                    </div>
                    <p className="compact-description">{goal.description}</p>
                    {renderGoalInput(goal)}
                    <label className="toggle">
                      <input type="checkbox" checked={goal.reminder} onChange={(event) => updateGoal(goal.id, { reminder: event.target.checked })} />
                      Rappel actif
                    </label>
                  </article>
                ))}
              </div>
            </article>

            <article className="stack">
              <details className="panel compact-panel">
                <summary>Ajouter un objectif</summary>
                <form className="form-grid compact-form" onSubmit={addGoal}>
                  <input required value={goalDraft.title} onChange={(event) => setGoalDraft({ ...goalDraft, title: event.target.value })} placeholder="Nom de l'objectif" />
                  <textarea value={goalDraft.description} onChange={(event) => setGoalDraft({ ...goalDraft, description: event.target.value })} placeholder="Description" />
                  <select value={goalDraft.horizon} onChange={(event) => setGoalDraft({ ...goalDraft, horizon: event.target.value as GoalHorizon })}>
                    {horizonOrder.map((horizon) => <option key={horizon} value={horizon}>{horizonLabel(horizon)}</option>)}
                  </select>
                  <input type="date" value={goalDraft.dueDate} onChange={(event) => setGoalDraft({ ...goalDraft, dueDate: event.target.value })} />
                  <select value={goalDraft.resultKind} onChange={(event) => setGoalDraft({ ...goalDraft, resultKind: event.target.value as InputKind })}>
                    <option value="tristate">Validation simple</option>
                    <option value="score">Score 0-4</option>
                    <option value="checklist">Checklist</option>
                    <option value="numeric">Valeur chiffree</option>
                    <option value="note">Note libre</option>
                  </select>
                  <select value={goalDraft.priority} onChange={(event) => setGoalDraft({ ...goalDraft, priority: event.target.value as Priority })}>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                  <label className="toggle">
                    <input type="checkbox" checked={goalDraft.reminder} onChange={(event) => setGoalDraft({ ...goalDraft, reminder: event.target.checked })} />
                    Activer un rappel
                  </label>
                  {goalDraft.resultKind === 'checklist' && (
                    <input value={goalDraft.checklistText} onChange={(event) => setGoalDraft({ ...goalDraft, checklistText: event.target.value })} placeholder="Checklist separee par virgules" />
                  )}
                  {goalDraft.resultKind === 'numeric' && (
                    <>
                      <select value={goalDraft.targetMode} onChange={(event) => setGoalDraft({ ...goalDraft, targetMode: event.target.value as TargetMode })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={goalDraft.targetValue} onChange={(event) => setGoalDraft({ ...goalDraft, targetValue: Number(event.target.value) })} placeholder="Cible" />
                      <input value={goalDraft.targetUnit} onChange={(event) => setGoalDraft({ ...goalDraft, targetUnit: event.target.value })} placeholder="Unite" />
                    </>
                  )}
                  <button type="submit">Ajouter l'objectif</button>
                </form>
              </details>

              <article className="panel compact-panel">
                <span className="eyebrow">Preview rappels</span>
                <div className="activity-list">
                  {reminderPreview.length > 0 ? reminderPreview.map((line) => (
                    <div key={line} className="activity-item">
                      <strong>{line}</strong>
                    </div>
                  )) : (
                    <div className="activity-item">
                      <strong>Aucune simulation lancee</strong>
                      <p>Utilise la roue dentee pour tester les rappels.</p>
                    </div>
                  )}
                </div>
              </article>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}

export default App
