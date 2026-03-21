import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

declare global {
  interface Window {
    __suiviDebugLog?: DebugEntry[]
    copySuiviLogs?: () => Promise<void>
    clearSuiviLogs?: () => void
  }
}

type ModuleKey = 'habits' | 'performances'
type ViewKey = 'habits' | 'performances' | 'goals'
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

type DebugEntry = {
  time: string
  event: string
  details?: Record<string, unknown>
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
const debugStorageKey = 'application-de-suivi-debug-v1'
const today = '2026-03-21'
const todayDate = new Date(`${today}T12:00:00`)
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
  if (mode === 'atLeast') return value >= target
  if (mode === 'atMost') return value <= target
  return value === target
}

function deriveState(item: TrackerItem, entry: TrackerEntry): EntryState {
  if (entry.state === 'rest' || entry.state === 'inactive') return entry.state
  if (item.inputKind === 'tristate') return entry.state
  if (item.inputKind === 'score') return entry.score != null && entry.score >= 3 ? 'success' : 'unknown'
  if (item.inputKind === 'checklist') return entry.checklist.length > 0 && entry.checklist.every(Boolean) ? 'success' : 'unknown'
  if (item.inputKind === 'numeric') {
    if (entry.numericValue == null || !item.target) return 'unknown'
    return compareNumeric(item.target.mode, entry.numericValue, item.target.value) ? 'success' : 'unknown'
  }
  return entry.note.trim() ? 'success' : 'unknown'
}

function goalState(goal: Goal): EntryState {
  if (goal.resultKind === 'tristate') return goal.status
  if (goal.resultKind === 'score') return goal.score != null && goal.score >= 3 ? 'success' : 'unknown'
  if (goal.resultKind === 'checklist') return goal.checklist.length > 0 && goal.checklist.every(Boolean) ? 'success' : 'unknown'
  if (goal.resultKind === 'numeric') {
    if (goal.numericValue == null || !goal.target) return 'unknown'
    return compareNumeric(goal.target.mode, goal.numericValue, goal.target.value) ? 'success' : 'unknown'
  }
  return goal.note.trim() ? 'success' : 'unknown'
}

function isHabitActive(item: TrackerItem, date: string) {
  const day = new Date(`${date}T00:00:00`).getDay()
  if (!item.frequency || item.frequency.kind === 'daily') return true
  if (item.frequency.kind === 'weekdays') return day >= 1 && day <= 5
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

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDate(date: string, delta: number) {
  const next = new Date(`${date}T12:00:00`)
  next.setDate(next.getDate() + delta)
  return formatDateKey(next)
}

function formatLongDate(date: string | null | undefined) {
  if (!date) return 'Aucun jour'
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
      ? formatDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + standardCount, 12))
      : formatDateKey(new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + reviewCount * 7, 12))
    const key = Math.floor(new Date(`${occurrenceDate}T00:00:00`).getTime() / 86400000)
    const entries = Object.fromEntries(
      items
        .filter((item) => item.module === 'habits')
        .map((item) => {
          const base = emptyEntry(item)
          if (kind === 'review') return [item.id, base]
          const lastSuccess = latestSuccessDate(item.id, occurrences)
          const inRest = lastSuccess
            ? item.restAfterSuccess > 0 && daysBetween(lastSuccess, occurrenceDate) > 0 && daysBetween(lastSuccess, occurrenceDate) <= item.restAfterSuccess
            : false
          if (!isHabitActive(item, occurrenceDate)) return [item.id, { ...base, state: 'inactive' as EntryState }]
          if (inRest) return [item.id, { ...base, state: 'rest' as EntryState }]
          return [item.id, base]
        }),
    )

    return {
      id: crypto.randomUUID(),
      module,
      kind,
      label: kind === 'standard' ? formatLongDate(occurrenceDate) : `Bilan semaine ${reviewCount + 1}`,
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
        if (kind === 'review') return [item.id, base]
        const lastSuccess = latestSuccessIteration(item.id, occurrences)
        const inRest = lastSuccess != null && item.restAfterSuccess > 0 && key - lastSuccess > 0 && key - lastSuccess <= item.restAfterSuccess
        if (inRest) return [item.id, { ...base, state: 'rest' as EntryState }]
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

function writeDebugLog(event: string, details?: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  const entry: DebugEntry = { time: new Date().toISOString(), event, details }
  const nextLog = [...(window.__suiviDebugLog ?? []), entry].slice(-200)
  window.__suiviDebugLog = nextLog
  localStorage.setItem(debugStorageKey, JSON.stringify(nextLog))
  console.info('[suivi-debug]', entry.time, event, details ?? {})
}

function setupDebugHelpers() {
  if (typeof window === 'undefined') return

  try {
    const raw = localStorage.getItem(debugStorageKey)
    window.__suiviDebugLog = raw ? JSON.parse(raw) as DebugEntry[] : []
  } catch {
    window.__suiviDebugLog = []
  }

  window.copySuiviLogs = async () => {
    const payload = JSON.stringify(window.__suiviDebugLog ?? [], null, 2)
    await navigator.clipboard.writeText(payload)
    console.info('[suivi-debug] logs copied to clipboard')
  }

  window.clearSuiviLogs = () => {
    window.__suiviDebugLog = []
    localStorage.removeItem(debugStorageKey)
    console.info('[suivi-debug] logs cleared')
  }
}

function loadState(): AppState {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return seedState()

  try {
    return JSON.parse(raw) as AppState
  } catch {
    return seedState()
  }
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
  if (goal.horizon === 'life') return 'Long terme'
  const date = new Date(`${goal.dueDate}T12:00:00`)
  if (goal.horizon === 'week') return `Semaine du ${new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(date)}`
  if (goal.horizon === 'month') return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date)
  if (goal.horizon === 'quarter') return `T${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`
  return String(date.getFullYear())
}

function parseChecklist(text: string) {
  return text.split(',').map((item) => item.trim()).filter(Boolean)
}

function sortGoals(goals: Goal[]) {
  return [...goals].sort((left, right) => {
    const horizonDelta = horizonOrder.indexOf(left.horizon) - horizonOrder.indexOf(right.horizon)
    if (horizonDelta !== 0) return horizonDelta
    if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate)
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
        if (!isHabitActive(item, date)) return [item.id, { ...base, state: 'inactive' as EntryState }]
        if (inRest) return [item.id, { ...base, state: 'rest' as EntryState }]
        return [item.id, base]
      }),
  )

  const entries = source
    ? Object.fromEntries(
        Object.entries(baseEntries).map(([itemId, baseEntry]) => {
          const currentEntry = source.entries[itemId]
          if (!currentEntry) return [itemId, baseEntry]
          if (baseEntry.state === 'rest' || baseEntry.state === 'inactive') return [itemId, { ...currentEntry, state: baseEntry.state }]
          const item = items.find((candidate) => candidate.id === itemId)!
          return [itemId, { ...currentEntry, state: deriveState(item, currentEntry) }]
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
  const [selectedHabitDate, setSelectedHabitDate] = useState(today)
  const [performanceOccurrenceId, setPerformanceOccurrenceId] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modalView, setModalView] = useState<ModuleKey | 'goals' | null>(null)
  const [trackerDraft, setTrackerDraft] = useState<TrackerDraft>(defaultTrackerDraft('habits'))
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(defaultGoalDraft())

  useEffect(() => {
    setupDebugHelpers()
    writeDebugLog('app-ready', { trackerItems: state.trackerItems.length, goals: state.goals.length, occurrences: state.occurrences.length })
  }, [])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  const habitItems = state.trackerItems.filter((item) => item.module === 'habits')
  const performanceItems = state.trackerItems.filter((item) => item.module === 'performances')
  const habitOccurrences = state.occurrences
    .filter((occurrence) => occurrence.module === 'habits' && occurrence.kind === 'standard')
    .sort((left, right) => right.key - left.key)
  const performanceOccurrences = state.occurrences
    .filter((occurrence) => occurrence.module === 'performances' && occurrence.kind === 'standard')
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
  const activeViewTitle = view === 'habits' ? 'Habitudes' : view === 'performances' ? 'Performances' : 'Objectifs'

  function patchState(patch: Partial<AppState>) {
    setState((current) => ({ ...current, ...patch }))
  }

  function createNewOccurrence(module: ModuleKey, kind: OccurrenceKind) {
    const occurrence = createOccurrence(module, kind, state.trackerItems, state.occurrences)
    patchState({ occurrences: [...state.occurrences, occurrence] })
    writeDebugLog('create-occurrence', { module, kind, occurrenceId: occurrence.id, date: occurrence.date, key: occurrence.key })
    if (module === 'performances') {
      setPerformanceOccurrenceId(occurrence.id)
    }
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
      writeDebugLog('habit-entry-created-on-demand', { date: selectedHabitDate, itemId, state: next.state })
      return
    }

    patchState({
      occurrences: state.occurrences.map((occurrence) => {
        if (occurrence.id !== occurrenceId) return occurrence
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
    writeDebugLog('tracker-entry-updated', { occurrenceId, itemId, module: item.module, patchKeys: Object.keys(patch), selectedHabitDate })
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
      if (occurrence.module !== trackerDraft.module) return occurrence
      const synthetic = createOccurrence(occurrence.module, occurrence.kind, nextItems, state.occurrences.filter((candidate) => candidate.id !== occurrence.id))
      return {
        ...occurrence,
        entries: {
          ...occurrence.entries,
          [item.id]: synthetic.entries[item.id],
        },
      }
    })

    patchState({ trackerItems: nextItems, occurrences: nextOccurrences })
    writeDebugLog('tracker-item-added', { module: trackerDraft.module, title: trackerDraft.title, inputKind: trackerDraft.inputKind, priority: trackerDraft.priority })
    setTrackerDraft(defaultTrackerDraft(trackerDraft.module))
    setModalView(null)
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
    writeDebugLog('goal-added', { title: goal.title, horizon: goal.horizon, dueDate: goal.dueDate, resultKind: goal.resultKind })
    setGoalDraft(defaultGoalDraft())
    setModalView(null)
  }

  function updateGoal(goalId: string, patch: Partial<Goal>) {
    patchState({ goals: state.goals.map((goal) => goal.id === goalId ? { ...goal, ...patch } : goal) })
  }

  function stepHabitDate(direction: 'previous' | 'next') {
    const nextDate = direction === 'previous' ? previousHabitDate : nextHabitDate
    writeDebugLog('habit-date-step', { direction, from: selectedHabitDate, to: nextDate, existingOccurrence: Boolean(habitOccurrences.find((occurrence) => occurrence.date === nextDate)) })
    setSelectedHabitDate(nextDate)
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
          <input type="range" min="0" max="4" step="1" value={entry.score ?? 0} onChange={(event) => updateTrackerEntry(occurrence.id, item.id, { score: Number(event.target.value) })} />
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

    return <textarea value={entry.note} onChange={(event) => updateTrackerEntry(occurrence.id, item.id, { note: event.target.value })} placeholder="Observation, contexte, journal..." />
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

  function openTrackerModal(module: ModuleKey) {
    setTrackerDraft(defaultTrackerDraft(module))
    setModalView(module)
  }

  function openGoalModal() {
    setGoalDraft(defaultGoalDraft())
    setModalView('goals')
  }

  return (
    <div className="shell minimal-shell">
      <button type="button" className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar minimal-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-head">
          <h1>Suivi</h1>
          <button type="button" className="ghost-icon" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)}>×</button>
        </div>

        <nav className="nav">
          <button type="button" className={`nav-link ${view === 'habits' ? 'active' : ''}`} onClick={() => { setView('habits'); setSidebarOpen(false) }}>Habitudes</button>
          <button type="button" className={`nav-link ${view === 'performances' ? 'active' : ''}`} onClick={() => { setView('performances'); setSidebarOpen(false) }}>Performances</button>
          <button type="button" className={`nav-link ${view === 'goals' ? 'active' : ''}`} onClick={() => { setView('goals'); setSidebarOpen(false) }}>Objectifs</button>
        </nav>
      </aside>

      <main className="main minimal-main">
        <header className="page-head">
          <div className="page-head-main">
            <button type="button" className="hamburger-button" aria-label="Ouvrir le menu" onClick={() => setSidebarOpen(true)}>
              <span />
              <span />
              <span />
            </button>
            <h2>{activeViewTitle}</h2>
          </div>
        </header>

        {view === 'habits' && (
          <section className="panel surface-panel">
            <div className="surface-head">
              <div className="date-nav-controls">
                <button type="button" className="date-arrow" onClick={() => stepHabitDate('previous')} aria-label="Jour precedent">‹</button>
                <strong>{selectedHabitDateLabel}</strong>
                <button type="button" className="date-arrow" onClick={() => stepHabitDate('next')} aria-label="Jour suivant">›</button>
              </div>
              {habitItems.length > 0 && <button type="button" className="fab-button" aria-label="Ajouter une habitude" onClick={() => openTrackerModal('habits')}>+</button>}
            </div>

            <div className="tracker-list">
              {habitItems.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucune habitude</h3>
                  <p>Ajoute seulement tes propres consignes.</p>
                  <button type="button" className="fab-button empty-add" aria-label="Ajouter une habitude" onClick={() => openTrackerModal('habits')}>+</button>
                </article>
              )}
              {habitItems.map((item) => (
                <article key={item.id} className="tracker-card">
                  <div className="tracker-head">
                    <div>
                      <strong>{item.title}</strong>
                      <div className="tracker-meta">
                        <span className={`pill state-${resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown'}`}>{entryLabel(resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown')}</span>
                      </div>
                    </div>
                  </div>

                  {item.description && <p className="compact-description">{item.description}</p>}

                  <div className="history-row">
                    <div className="history-strip">
                      {habitHistory(item.id).length > 0 ? habitHistory(item.id).map((history) => (
                        <button
                          key={`${item.id}-${history.occurrenceId}`}
                          type="button"
                          className={`history-chip state-${history.state} ${history.date === selectedHabitDate ? 'active' : ''}`}
                          onClick={() => {
                            writeDebugLog('habit-history-select', { from: selectedHabitDate, to: history.date, state: history.state })
                            setSelectedHabitDate(history.date)
                          }}
                        >
                          <span>{formatLongDate(history.date)}</span>
                        </button>
                      )) : <span className="muted-inline">Pas encore d historique.</span>}
                    </div>
                  </div>

                  {renderTrackerInput(resolvedHabitOccurrence, item)}
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'performances' && (
          <section className="panel surface-panel">
            <div className="surface-head">
              <div className="surface-actions">
                <label className="field field-select">
                  <span>Iteration</span>
                  <select value={performanceOccurrenceId} onChange={(event) => setPerformanceOccurrenceId(event.target.value)}>
                    {performanceOccurrences.map((occurrence) => (
                      <option key={occurrence.id} value={occurrence.id}>{occurrence.label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="ghost-button" onClick={() => createNewOccurrence('performances', 'standard')}>Nouvelle iteration</button>
              </div>
              {performanceItems.length > 0 && <button type="button" className="fab-button" aria-label="Ajouter une performance" onClick={() => openTrackerModal('performances')}>+</button>}
            </div>

            <div className="tracker-list">
              {performanceItems.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucune performance</h3>
                  <p>Ajoute tes axes de progression avant de lancer une iteration.</p>
                  <button type="button" className="fab-button empty-add" aria-label="Ajouter une performance" onClick={() => openTrackerModal('performances')}>+</button>
                </article>
              )}
              {performanceItems.map((item) => (
                <article key={item.id} className="tracker-card">
                  <div className="tracker-head">
                    <div>
                      <strong>{item.title}</strong>
                      <div className="tracker-meta">
                        <span className={`pill state-${selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown'}`}>{entryLabel(selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown')}</span>
                      </div>
                    </div>
                  </div>
                  {item.description && <p className="compact-description">{item.description}</p>}
                  {selectedPerformanceOccurrence ? renderTrackerInput(selectedPerformanceOccurrence, item) : <p className="muted-inline">Cree d abord une iteration pour saisir tes performances.</p>}
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'goals' && (
          <section className="panel surface-panel">
            <div className="surface-head">
              <strong>Objectifs</strong>
              {sortedGoals.length > 0 && <button type="button" className="fab-button" aria-label="Ajouter un objectif" onClick={openGoalModal}>+</button>}
            </div>

            <div className="goal-list">
              {sortedGoals.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucun objectif</h3>
                  <p>Ajoute seulement les objectifs que tu veux suivre.</p>
                  <button type="button" className="fab-button empty-add" aria-label="Ajouter un objectif" onClick={openGoalModal}>+</button>
                </article>
              )}
              {sortedGoals.map((goal) => (
                <article key={goal.id} className={`goal-card horizon-${goal.horizon}`}>
                  <div className="goal-head">
                    <div>
                      <strong>{goal.title}</strong>
                      <div className="tracker-meta">
                        <span className={`pill state-${goalState(goal)}`}>{entryLabel(goalState(goal))}</span>
                        <span className="ghost-pill">{periodLabel(goal)}</span>
                      </div>
                    </div>
                    <small>{formatLongDate(goal.dueDate)}</small>
                  </div>
                  {goal.description && <p className="compact-description">{goal.description}</p>}
                  {renderGoalInput(goal)}
                </article>
              ))}
            </div>
          </section>
        )}

        {modalView && (
          <div className="modal-backdrop" role="presentation" onClick={() => setModalView(null)}>
            <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{modalView === 'goals' ? 'Ajouter un objectif' : modalView === 'habits' ? 'Ajouter une habitude' : 'Ajouter une performance'}</h3>
                <button type="button" className="ghost-icon" aria-label="Fermer" onClick={() => setModalView(null)}>×</button>
              </div>

              {modalView === 'goals' ? (
                <form className="form-grid compact-form" onSubmit={addGoal}>
                  <input required value={goalDraft.title} onChange={(event) => setGoalDraft({ ...goalDraft, title: event.target.value })} placeholder="Titre" />
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
                  <label className="toggle">
                    <input type="checkbox" checked={goalDraft.reminder} onChange={(event) => setGoalDraft({ ...goalDraft, reminder: event.target.checked })} />
                    Rappel
                  </label>
                  {goalDraft.resultKind === 'checklist' && (
                    <input value={goalDraft.checklistText} onChange={(event) => setGoalDraft({ ...goalDraft, checklistText: event.target.value })} placeholder="Checklist, separee par virgules" />
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
                  <button type="submit">Ajouter</button>
                </form>
              ) : (
                <form className="form-grid compact-form" onSubmit={addTrackerItem}>
                  <input required value={trackerDraft.title} onChange={(event) => setTrackerDraft({ ...trackerDraft, title: event.target.value, module: modalView })} placeholder="Titre" />
                  <textarea value={trackerDraft.description} onChange={(event) => setTrackerDraft({ ...trackerDraft, description: event.target.value, module: modalView })} placeholder="Description" />
                  <select value={trackerDraft.inputKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, inputKind: event.target.value as InputKind, module: modalView })}>
                    <option value="tristate">Validation simple</option>
                    <option value="score">Score 0-4</option>
                    <option value="checklist">Checklist</option>
                    <option value="numeric">Valeur chiffree</option>
                    <option value="note">Note libre</option>
                  </select>
                  {modalView === 'habits' && (
                    <>
                      <select value={trackerDraft.frequencyKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, frequencyKind: event.target.value as FrequencyKind, module: modalView })}>
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
                                  module: modalView,
                                })}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <input type="number" min="0" value={trackerDraft.restAfterSuccess} onChange={(event) => setTrackerDraft({ ...trackerDraft, restAfterSuccess: Number(event.target.value), module: modalView })} placeholder="Repos apres succes" />
                  {trackerDraft.inputKind === 'checklist' && (
                    <input value={trackerDraft.checklistText} onChange={(event) => setTrackerDraft({ ...trackerDraft, checklistText: event.target.value, module: modalView })} placeholder="Checklist, separee par virgules" />
                  )}
                  {trackerDraft.inputKind === 'numeric' && (
                    <>
                      <select value={trackerDraft.targetMode} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetMode: event.target.value as TargetMode, module: modalView })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={trackerDraft.targetValue} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetValue: Number(event.target.value), module: modalView })} placeholder="Cible" />
                      <input value={trackerDraft.targetUnit} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetUnit: event.target.value, module: modalView })} placeholder="Unite" />
                    </>
                  )}
                  <button type="submit">Ajouter</button>
                </form>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
