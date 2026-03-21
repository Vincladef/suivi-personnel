import { useEffect, useRef, useState } from 'react'
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
type EntryState = 'unknown' | 'success' | 'failed' | 'excused' | 'rest' | 'inactive'
type FrequencyKind = 'daily' | 'weekdays' | 'selected'
type OccurrenceKind = 'standard' | 'review'
type TargetMode = 'atLeast' | 'atMost' | 'exactly'
type GoalHorizon = 'week' | 'month' | 'quarter' | 'year' | 'life'
type ChecklistStatus = 'unknown' | 'done' | 'failed' | 'excused'

type TargetConfig = { mode: TargetMode; value: number; unit: string }

type TrackerSubItem = {
  id: string
  title: string
  inputKind: InputKind
  checklistTemplate: string[]
  target: TargetConfig | null
}

type TrackerSubEntry = {
  state: EntryState
  score: number | null
  checklist: ChecklistStatus[]
  numericValue: number | null
  note: string
}

type TrackerItem = {
  id: string
  module: ModuleKey
  title: string
  description: string
  inputKind: InputKind
  priority: Priority
  checklistTemplate: string[]
  target: TargetConfig | null
  frequency: { kind: FrequencyKind; days: number[] } | null
  restAfterSuccess: number
  subItems: TrackerSubItem[]
}

type TrackerEntry = {
  state: EntryState
  score: number | null
  checklist: ChecklistStatus[]
  numericValue: number | null
  note: string
  subEntries: Record<string, TrackerSubEntry>
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
  checklist: ChecklistStatus[]
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

type TrackerSubDraft = {
  id: string
  title: string
  inputKind: InputKind
  checklistItems: string[]
  newChecklistItem: string
  targetMode: TargetMode
  targetValue: number
  targetUnit: string
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
  checklistItems: string[]
  newChecklistItem: string
  targetMode: TargetMode
  targetValue: number
  targetUnit: string
  subItems: TrackerSubDraft[]
}

type TrackerEditorState = {
  module: ModuleKey
  occurrenceId: string
  itemId: string
  date?: string
}

type HistoryItem = {
  occurrenceId: string
  date: string
  state: EntryState
}

type GoalDraft = {
  title: string
  description: string
  horizon: GoalHorizon
  dueDate: string
  resultKind: InputKind
  priority: Priority
  reminder: boolean
  checklistItems: string[]
  newChecklistItem: string
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
const likertOptions = [
  { value: 4, label: 'Oui' },
  { value: 3, label: 'Plutot oui' },
  { value: 2, label: 'Neutre' },
  { value: 1, label: 'Plutot non' },
  { value: 0, label: 'Non' },
] as const

function normalizeChecklistState(value: unknown): ChecklistStatus {
  if (value === true) return 'done'
  if (value === false || value == null) return 'unknown'
  if (value === 'done' || value === 'failed' || value === 'excused' || value === 'unknown') return value
  return 'unknown'
}

const defaultSubDraft = (): TrackerSubDraft => ({
  id: crypto.randomUUID(),
  title: '',
  inputKind: 'tristate',
  checklistItems: [],
  newChecklistItem: '',
  targetMode: 'atLeast',
  targetValue: 1,
  targetUnit: '',
})

const defaultTrackerDraft = (module: ModuleKey): TrackerDraft => ({
  module,
  title: '',
  description: '',
  inputKind: 'tristate',
  priority: 'medium',
  frequencyKind: 'daily',
  frequencyDays: [1, 2, 3, 4, 5],
  restAfterSuccess: 0,
  checklistItems: [],
  newChecklistItem: '',
  targetMode: 'atLeast',
  targetValue: 1,
  targetUnit: '',
  subItems: [],
})

const defaultGoalDraft = (): GoalDraft => ({
  title: '',
  description: '',
  horizon: 'week',
  dueDate: today,
  resultKind: 'tristate',
  priority: 'medium',
  reminder: true,
  checklistItems: [],
  newChecklistItem: '',
  targetMode: 'atLeast',
  targetValue: 1,
  targetUnit: '',
})

function trackerDraftFromItem(item: TrackerItem): TrackerDraft {
  return {
    module: item.module,
    title: item.title,
    description: item.description,
    inputKind: item.inputKind,
    priority: item.priority,
    frequencyKind: item.frequency?.kind ?? 'daily',
    frequencyDays: item.frequency?.days ?? [1, 2, 3, 4, 5],
    restAfterSuccess: item.restAfterSuccess,
    checklistItems: [...item.checklistTemplate],
    newChecklistItem: '',
    targetMode: item.target?.mode ?? 'atLeast',
    targetValue: item.target?.value ?? 1,
    targetUnit: item.target?.unit ?? '',
    subItems: item.subItems.map((subItem) => ({
      id: subItem.id,
      title: subItem.title,
      inputKind: subItem.inputKind,
      checklistItems: [...subItem.checklistTemplate],
      newChecklistItem: '',
      targetMode: subItem.target?.mode ?? 'atLeast',
      targetValue: subItem.target?.value ?? 1,
      targetUnit: subItem.target?.unit ?? '',
    })),
  }
}

function cloneSubEntry(entry: TrackerSubEntry): TrackerSubEntry {
  return {
    state: entry.state,
    score: entry.score,
    checklist: [...entry.checklist],
    numericValue: entry.numericValue,
    note: entry.note,
  }
}

function cloneEntry(entry: TrackerEntry): TrackerEntry {
  return {
    state: entry.state,
    score: entry.score,
    checklist: [...entry.checklist],
    numericValue: entry.numericValue,
    note: entry.note,
    subEntries: Object.fromEntries(Object.entries(entry.subEntries).map(([key, value]) => [key, cloneSubEntry(value)])),
  }
}

const seedTrackerItems: TrackerItem[] = []
const seedGoals: Goal[] = []

function emptySubEntry(item: TrackerSubItem): TrackerSubEntry {
  return {
    state: 'unknown',
    score: null,
    checklist: item.inputKind === 'checklist' ? item.checklistTemplate.map(() => 'unknown' as ChecklistStatus) : [],
    numericValue: null,
    note: '',
  }
}

function emptyEntry(item: TrackerItem): TrackerEntry {
  return {
    state: 'unknown',
    score: null,
    checklist: item.inputKind === 'checklist' ? item.checklistTemplate.map(() => 'unknown' as ChecklistStatus) : [],
    numericValue: null,
    note: '',
    subEntries: Object.fromEntries(item.subItems.map((subItem) => [subItem.id, emptySubEntry(subItem)])),
  }
}

function compareNumeric(mode: TargetMode, value: number, target: number) {
  if (mode === 'atLeast') return value >= target
  if (mode === 'atMost') return value <= target
  return value === target
}

function deriveLeafState(
  inputKind: InputKind,
  target: TargetConfig | null,
  entry: { state: EntryState; score: number | null; checklist: ChecklistStatus[]; numericValue: number | null; note: string },
): EntryState {
  if (entry.state === 'rest' || entry.state === 'inactive') return entry.state
  if (inputKind === 'tristate') return entry.state
  if (inputKind === 'score') {
    if (entry.score == null) return 'unknown'
    if (entry.score >= 3) return 'success'
    if (entry.score === 2) return 'excused'
    return 'failed'
  }
  if (inputKind === 'checklist') {
    if (entry.checklist.length === 0 || entry.checklist.every((value) => value === 'unknown')) return 'unknown'
    if (entry.checklist.every((value) => value === 'done' || value === 'excused')) {
      return entry.checklist.some((value) => value === 'done') ? 'success' : 'excused'
    }
    if (entry.checklist.some((value) => value === 'failed')) return 'failed'
    return 'unknown'
  }
  if (inputKind === 'numeric') {
    if (entry.numericValue == null || !target) return 'unknown'
    return compareNumeric(target.mode, entry.numericValue, target.value) ? 'success' : 'failed'
  }
  return entry.note.trim() ? 'success' : 'unknown'
}

function deriveState(item: TrackerItem, entry: TrackerEntry): EntryState {
  return deriveLeafState(item.inputKind, item.target, entry)
}

function deriveSubState(item: TrackerSubItem, entry: TrackerSubEntry): EntryState {
  return deriveLeafState(item.inputKind, item.target, entry)
}

function goalState(goal: Goal): EntryState {
  return deriveLeafState(goal.resultKind, goal.target, {
    state: goal.status,
    score: goal.score,
    checklist: goal.checklist,
    numericValue: goal.numericValue,
    note: goal.note,
  })
}

function stateClassName(state: EntryState) {
  return state === 'failed' ? 'state-failed' : `state-${state}`
}

function entryLabelForInput(inputKind: InputKind, state: EntryState, score?: number | null) {
  if (inputKind === 'tristate') {
    return { success: 'Oui', failed: 'Non', unknown: '', rest: 'Repos', inactive: 'Non concerne', excused: 'Neutre' }[state]
  }
  if (inputKind === 'score') {
    const match = likertOptions.find((option) => option.value === score)
    return match?.label ?? ''
  }
  if (inputKind === 'checklist') {
    return { success: 'Complete', failed: 'Partiel', unknown: '', rest: 'Repos', inactive: 'Non concerne', excused: 'Excuse' }[state]
  }
  if (inputKind === 'numeric') {
    return { success: 'Atteint', failed: 'Non atteint', unknown: '', rest: 'Repos', inactive: 'Non concerne', excused: 'Neutre' }[state]
  }
  return { success: 'Renseigne', failed: 'Non valide', unknown: '', rest: 'Repos', inactive: 'Non concerne', excused: 'Neutre' }[state]
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

function formatHistoryDate(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${date}T12:00:00`))
    .replace('.', '')
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

function normalizeSubItem(raw: Partial<TrackerSubItem> | undefined): TrackerSubItem {
  return {
    id: raw?.id ?? crypto.randomUUID(),
    title: raw?.title ?? '',
    inputKind: raw?.inputKind ?? 'tristate',
    checklistTemplate: raw?.checklistTemplate ?? [],
    target: raw?.target ?? null,
  }
}

function normalizeTrackerItem(raw: Partial<TrackerItem>): TrackerItem {
  return {
    id: raw.id ?? crypto.randomUUID(),
    module: raw.module ?? 'habits',
    title: raw.title ?? '',
    description: raw.description ?? '',
    inputKind: raw.inputKind ?? 'tristate',
    priority: raw.priority ?? 'medium',
    checklistTemplate: raw.checklistTemplate ?? [],
    target: raw.target ?? null,
    frequency: raw.frequency ?? null,
    restAfterSuccess: raw.restAfterSuccess ?? 0,
    subItems: (raw.subItems ?? []).map((item) => normalizeSubItem(item)),
  }
}

function normalizeSubEntry(raw: Partial<TrackerSubEntry> | undefined, item: TrackerSubItem): TrackerSubEntry {
  const next: TrackerSubEntry = {
    state: raw?.state ?? 'unknown',
    score: raw?.score ?? null,
    checklist: item.inputKind === 'checklist' ? item.checklistTemplate.map((_, index) => normalizeChecklistState(raw?.checklist?.[index])) : [],
    numericValue: raw?.numericValue ?? null,
    note: raw?.note ?? '',
  }
  next.state = deriveSubState(item, next)
  return next
}

function normalizeTrackerEntry(raw: Partial<TrackerEntry> | undefined, item: TrackerItem): TrackerEntry {
  const next: TrackerEntry = {
    state: raw?.state ?? 'unknown',
    score: raw?.score ?? null,
    checklist: item.inputKind === 'checklist' ? item.checklistTemplate.map((_, index) => normalizeChecklistState(raw?.checklist?.[index])) : [],
    numericValue: raw?.numericValue ?? null,
    note: raw?.note ?? '',
    subEntries: Object.fromEntries(item.subItems.map((subItem) => [subItem.id, normalizeSubEntry(raw?.subEntries?.[subItem.id], subItem)])),
  }
  next.state = deriveState(item, next)
  return next
}

function normalizeGoal(raw: Partial<Goal>): Goal {
  const goal: Goal = {
    id: raw.id ?? crypto.randomUUID(),
    title: raw.title ?? '',
    description: raw.description ?? '',
    horizon: raw.horizon ?? 'week',
    dueDate: raw.dueDate ?? today,
    resultKind: raw.resultKind ?? 'tristate',
    priority: raw.priority ?? 'medium',
    reminder: raw.reminder ?? true,
    checklistTemplate: raw.checklistTemplate ?? [],
    target: raw.target ?? null,
    status: raw.status ?? 'unknown',
    score: raw.score ?? null,
    checklist: (raw.resultKind ?? 'tristate') === 'checklist' ? (raw.checklistTemplate ?? []).map((_, index) => normalizeChecklistState(raw.checklist?.[index])) : [],
    numericValue: raw.numericValue ?? null,
    note: raw.note ?? '',
  }
  goal.status = goalState(goal)
  return goal
}

function normalizeState(raw: Partial<AppState>): AppState {
  const trackerItems = (raw.trackerItems ?? []).map((item) => normalizeTrackerItem(item))
  const trackerItemsById = Object.fromEntries(trackerItems.map((item) => [item.id, item]))
  const occurrences = (raw.occurrences ?? []).map((occurrence) => ({
    id: occurrence.id ?? crypto.randomUUID(),
    module: occurrence.module ?? 'habits',
    kind: occurrence.kind ?? 'standard',
    label: occurrence.label ?? '',
    key: occurrence.key ?? 0,
    date: occurrence.date ?? null,
    createdAt: occurrence.createdAt ?? new Date().toISOString(),
    entries: Object.fromEntries(
      Object.values(trackerItemsById)
        .filter((item) => item.module === (occurrence.module ?? 'habits'))
        .map((item) => [item.id, normalizeTrackerEntry(occurrence.entries?.[item.id], item)]),
    ),
  }))
  const goals = (raw.goals ?? []).map((goal) => normalizeGoal(goal))
  return { trackerItems, occurrences, goals }
}

function loadState(): AppState {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return seedState()

  try {
    return normalizeState(JSON.parse(raw) as AppState)
  } catch {
    return seedState()
  }
}

function entryLabel(state: EntryState) {
  return {
    unknown: 'A remplir',
    success: 'Reussi',
    failed: 'Non',
    excused: 'Neutre',
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

function HistoryCarousel({
  items,
  selectedDate,
  onSelect,
}: {
  items: HistoryItem[]
  selectedDate: string
  onSelect: (date: string) => void
}) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [canScrollPrevious, setCanScrollPrevious] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)

  useEffect(() => {
    const node = stripRef.current
    if (!node) return

    const updateButtons = () => {
      const maxScroll = Math.max(node.scrollWidth - node.clientWidth, 0)
      setCanScrollPrevious(node.scrollLeft > 4)
      setCanScrollNext(maxScroll - node.scrollLeft > 4)
    }

    updateButtons()
    node.addEventListener('scroll', updateButtons)
    window.addEventListener('resize', updateButtons)

    return () => {
      node.removeEventListener('scroll', updateButtons)
      window.removeEventListener('resize', updateButtons)
    }
  }, [items])

  function scroll(direction: 'previous' | 'next') {
    stripRef.current?.scrollBy({ left: direction === 'next' ? 188 : -188, behavior: 'smooth' })
  }

  if (items.length === 0) {
    return <span className="muted-inline">Pas encore d historique.</span>
  }


  return (
    <div className="history-carousel">
      <button
        type="button"
        className={`history-nav history-nav-previous ${canScrollPrevious ? '' : 'is-hidden'}`}
        aria-label="Historique precedent"
        aria-hidden={!canScrollPrevious}
        tabIndex={canScrollPrevious ? 0 : -1}
        onClick={() => scroll('previous')}
      >
        ‹
      </button>
      <div className="history-strip" ref={stripRef}>
        {items.map((history) => (
          <button
            key={history.occurrenceId}
            type="button"
            className={`history-chip state-${history.state} ${history.date === selectedDate ? 'active' : ''}`}
            onClick={() => onSelect(history.date)}
          >
            <span>{formatHistoryDate(history.date)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`history-nav history-nav-next ${canScrollNext ? '' : 'is-hidden'}`}
        aria-label="Historique suivant"
        aria-hidden={!canScrollNext}
        tabIndex={canScrollNext ? 0 : -1}
        onClick={() => scroll('next')}
      >
        ›
      </button>
    </div>
  )
}

function App() {
  const [view, setView] = useState<ViewKey>('habits')
  const [state, setState] = useState<AppState>(() => loadState())
  const [selectedHabitDate, setSelectedHabitDate] = useState(today)
  const [performanceOccurrenceId, setPerformanceOccurrenceId] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modalView, setModalView] = useState<ModuleKey | 'goals' | null>(null)
  const [trackerEditor, setTrackerEditor] = useState<TrackerEditorState | null>(null)
  const [editingTrackerId, setEditingTrackerId] = useState<string | null>(null)
  const [trackerResponseDraft, setTrackerResponseDraft] = useState<TrackerEntry | null>(null)
  const trackerResponseDraftRef = useRef<TrackerEntry | null>(null)
  const checklistDragRef = useRef<{ scope: string; index: number } | null>(null)
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
  const trackerEditorItem = trackerEditor ? state.trackerItems.find((candidate) => candidate.id === trackerEditor.itemId) ?? null : null
  const trackerEditorOccurrence = trackerEditor
    ? trackerEditor.module === 'habits'
      ? buildHabitOccurrenceForDate(
          trackerEditor.date ?? selectedHabitDate,
          state.trackerItems,
          state.occurrences,
          habitOccurrences.find((occurrence) => occurrence.date === (trackerEditor.date ?? selectedHabitDate)),
        )
      : state.occurrences.find((occurrence) => occurrence.id === trackerEditor.occurrenceId) ?? null
    : null

  function updateTrackerResponseDraft(next: TrackerEntry | null) {
    trackerResponseDraftRef.current = next
    setTrackerResponseDraft(next)
  }


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


  function addChecklistItemToTrackerDraft() {
    const value = trackerDraft.newChecklistItem.trim()
    if (!value) return
    setTrackerDraft({ ...trackerDraft, checklistItems: [value, ...trackerDraft.checklistItems], newChecklistItem: '' })
  }

  function removeChecklistItemFromTrackerDraft(index: number) {
    setTrackerDraft({ ...trackerDraft, checklistItems: trackerDraft.checklistItems.filter((_, itemIndex) => itemIndex !== index) })
  }

  function addChecklistItemToGoalDraft() {
    const value = goalDraft.newChecklistItem.trim()
    if (!value) return
    setGoalDraft({ ...goalDraft, checklistItems: [value, ...goalDraft.checklistItems], newChecklistItem: '' })
  }

  function removeChecklistItemFromGoalDraft(index: number) {
    setGoalDraft({ ...goalDraft, checklistItems: goalDraft.checklistItems.filter((_, itemIndex) => itemIndex !== index) })
  }

  function moveChecklistItems(items: string[], from: number, to: number) {
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    return next
  }

  function moveTrackerChecklistItem(from: number, to: number) {
    setTrackerDraft({ ...trackerDraft, checklistItems: moveChecklistItems(trackerDraft.checklistItems, from, to) })
  }

  function moveGoalChecklistItem(from: number, to: number) {
    setGoalDraft({ ...goalDraft, checklistItems: moveChecklistItems(goalDraft.checklistItems, from, to) })
  }

  function addSubItemDraft() {
    setTrackerDraft({ ...trackerDraft, subItems: [...trackerDraft.subItems, defaultSubDraft()] })
  }

  function patchSubItemDraft(subItemId: string, patch: Partial<TrackerSubDraft>) {
    setTrackerDraft({
      ...trackerDraft,
      subItems: trackerDraft.subItems.map((subItem) => subItem.id === subItemId ? { ...subItem, ...patch } : subItem),
    })
  }

  function removeSubItemDraft(subItemId: string) {
    setTrackerDraft({ ...trackerDraft, subItems: trackerDraft.subItems.filter((subItem) => subItem.id !== subItemId) })
  }

  function addChecklistItemToSubDraft(subItemId: string) {
    const subItem = trackerDraft.subItems.find((candidate) => candidate.id === subItemId)
    if (!subItem) return
    const value = subItem.newChecklistItem.trim()
    if (!value) return
    patchSubItemDraft(subItemId, { checklistItems: [value, ...subItem.checklistItems], newChecklistItem: '' })
  }

  function removeChecklistItemFromSubDraft(subItemId: string, index: number) {
    const subItem = trackerDraft.subItems.find((candidate) => candidate.id === subItemId)
    if (!subItem) return
    patchSubItemDraft(subItemId, { checklistItems: subItem.checklistItems.filter((_, itemIndex) => itemIndex !== index) })
  }

  function moveChecklistItemInSubDraft(subItemId: string, from: number, to: number) {
    const subItem = trackerDraft.subItems.find((candidate) => candidate.id === subItemId)
    if (!subItem) return
    patchSubItemDraft(subItemId, { checklistItems: moveChecklistItems(subItem.checklistItems, from, to) })
  }


  function saveTrackerItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checklistTemplate = trackerDraft.inputKind === 'checklist' ? trackerDraft.checklistItems : []
    const item: TrackerItem = {
      id: editingTrackerId ?? crypto.randomUUID(),
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
      subItems: trackerDraft.subItems.map((subItem) => ({
        id: subItem.id,
        title: subItem.title,
        inputKind: subItem.inputKind,
        checklistTemplate: subItem.inputKind === 'checklist' ? subItem.checklistItems : [],
        target: subItem.inputKind === 'numeric'
          ? { mode: subItem.targetMode, value: Number(subItem.targetValue), unit: subItem.targetUnit }
          : null,
      })),
    }

    if (editingTrackerId) {
      const nextOccurrences = state.occurrences.map((occurrence) => {
        if (occurrence.module !== item.module) return occurrence
        const current = occurrence.entries[item.id]
        if (!current) return occurrence

        const nextEntry: TrackerEntry = {
          state: current.state === 'rest' || current.state === 'inactive' ? current.state : 'unknown',
          score: item.inputKind === 'score' ? current.score : null,
          checklist: item.inputKind === 'checklist'
            ? item.checklistTemplate.map((_, index) => normalizeChecklistState(current.checklist[index]))
            : [],
          numericValue: item.inputKind === 'numeric' ? current.numericValue : null,
          note: item.inputKind === 'note' ? current.note : '',
          subEntries: Object.fromEntries(item.subItems.map((subItem) => {
            const currentSubEntry = current.subEntries?.[subItem.id]
            return [subItem.id, normalizeSubEntry(currentSubEntry, subItem)]
          })),
        }

        if (item.inputKind === 'tristate' && (current.state === 'success' || current.state === 'failed' || current.state === 'unknown')) {
          nextEntry.state = current.state
        }

        nextEntry.state = deriveState(item, nextEntry)

        return {
          ...occurrence,
          entries: {
            ...occurrence.entries,
            [item.id]: nextEntry,
          },
        }
      })

      patchState({
        trackerItems: state.trackerItems.map((candidate) => candidate.id === editingTrackerId ? item : candidate),
        occurrences: nextOccurrences,
      })
      writeDebugLog('tracker-item-updated', { itemId: editingTrackerId, title: item.title, module: item.module })
    } else {
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
    }

    setEditingTrackerId(null)
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
      checklistTemplate: goalDraft.resultKind === 'checklist' ? goalDraft.checklistItems : [],
      target: goalDraft.resultKind === 'numeric'
        ? { mode: goalDraft.targetMode, value: Number(goalDraft.targetValue), unit: goalDraft.targetUnit }
        : null,
      status: 'unknown',
      score: null,
      checklist: goalDraft.resultKind === 'checklist' ? goalDraft.checklistItems.map(() => 'unknown' as ChecklistStatus) : [],
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
    return habitOccurrences
      .filter((occurrence) => {
        const entry = occurrence.entries[itemId]
        if (!entry) return false
        if (entry.state === 'success' || entry.state === 'failed' || entry.state === 'excused') return true
        if (entry.score != null) return true
        if (entry.numericValue != null) return true
        if (entry.note.trim()) return true
        if (entry.checklist.some((value) => value !== 'unknown')) return true
        return false
      })
      .slice(0, 7)
      .map((occurrence) => ({
        occurrenceId: occurrence.id,
        date: occurrence.date ?? '',
        state: occurrence.entries[itemId]?.state ?? 'unknown',
      }))
  }

  function updateTrackerSubEntryDraft(subItem: TrackerSubItem, patch: Partial<TrackerSubEntry>) {
    if (!trackerResponseDraft) return
    const current = trackerResponseDraft.subEntries[subItem.id] ?? emptySubEntry(subItem)
    const next = { ...current, ...patch }
    next.state = deriveSubState(subItem, next)
    updateTrackerResponseDraft({
      ...trackerResponseDraft,
      subEntries: {
        ...trackerResponseDraft.subEntries,
        [subItem.id]: next,
      },
    })
  }

  function renderChecklistResponseEditor(
    checklistTemplate: string[],
    values: ChecklistStatus[],
    onChange: (next: ChecklistStatus[]) => void,
  ) {
    return (
      <div className="checklist-box checklist-response-list">
        {checklistTemplate.map((label, index) => {
          const value = values[index] ?? 'unknown'
          const setValue = (nextValue: ChecklistStatus) => {
            const next = checklistTemplate.map((_, itemIndex) => values[itemIndex] ?? 'unknown')
            next[index] = nextValue
            onChange(next)
          }
          return (
            <div key={label} className={`check-item-row state-${value === 'done' ? 'success' : value === 'excused' ? 'excused' : value === 'failed' ? 'failed' : 'unknown'}`}>
              <button
                type="button"
                className={`check-toggle ${value === 'done' ? 'active' : ''}`}
                aria-label={`Marquer ${label} comme fait`}
                onClick={() => setValue(value === 'done' ? 'unknown' : 'done')}
              >
                {value === 'done' ? '✓' : '○'}
              </button>
              <div className="check-item-copy">
                <span>{label}</span>
                {(value === 'done' || value === 'excused') && <small>{value === 'done' ? 'Fait' : 'Excuse'}</small>}
              </div>
              <div className="check-item-actions">
                <button type="button" className={`ghost-button compact-action compact-icon-action ${value === 'excused' ? 'active' : ''}`} aria-label={`Marquer ${label} comme excuse`} title="Marquer comme excuse" onClick={() => setValue(value === 'excused' ? 'unknown' : 'excused')}>⏭</button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderLeafResponseEditor(
    inputKind: InputKind,
    target: TargetConfig | null,
    entry: { state: EntryState; score: number | null; checklist: ChecklistStatus[]; numericValue: number | null; note: string },
    checklistTemplate: string[],
    onPatch: (patch: Partial<TrackerSubEntry>) => void,
  ) {
    if (entry.state === 'rest' || entry.state === 'inactive') {
      return <span className={`pill ${stateClassName(entry.state)}`}>{entryLabel(entry.state)}</span>
    }

    if (inputKind === 'tristate') {
      return (
        <label className="field">
          <span>Reponse</span>
          <select
            value={entry.state === 'success' ? 'yes' : entry.state === 'failed' ? 'no' : ''}
            onChange={(event) => onPatch({ state: event.target.value === 'yes' ? 'success' : event.target.value === 'no' ? 'failed' : 'unknown' })}
          >
            <option value="">Choisir</option>
            <option value="yes">Oui</option>
            <option value="no">Non</option>
          </select>
        </label>
      )
    }

    if (inputKind === 'score') {
      return (
        <label className="field">
          <span>Reponse qualitative</span>
          <select
            value={entry.score == null ? '' : String(entry.score)}
            onChange={(event) => onPatch({ score: event.target.value === '' ? null : Number(event.target.value) })}
          >
            <option value="">Choisir</option>
            {likertOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      )
    }

    if (inputKind === 'checklist') {
      return renderChecklistResponseEditor(checklistTemplate, entry.checklist, (next) => onPatch({ checklist: next }))
    }

    if (inputKind === 'numeric') {
      return (
        <div className="editor-grid">
          <label className="field">
            <span>{target?.unit ? `Valeur (${target.unit})` : 'Valeur saisie'}</span>
            <input
              type="number"
              value={entry.numericValue ?? ''}
              onChange={(event) => onPatch({ numericValue: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <span className="muted-inline">{target ? `${target.mode === 'atLeast' ? 'Objectif minimum' : target.mode === 'atMost' ? 'Maximum autorise' : 'Objectif exact'} : ${target.value}${target.unit ? ` ${target.unit}` : ''}` : ''}</span>
        </div>
      )
    }

    return (
      <label className="field">
        <span>Reponse libre</span>
        <textarea value={entry.note} onChange={(event) => onPatch({ note: event.target.value })} placeholder="Observation, contexte, journal..." />
      </label>
    )
  }

  function renderTrackerEditorInput(item: TrackerItem) {
    const entry = trackerResponseDraft
    if (!entry) return null

    return (
      <div className="editor-grid">
        <div className="field">
          <span>Consigne principale</span>
          {renderLeafResponseEditor(item.inputKind, item.target, entry, item.checklistTemplate, (patch) => {
            const next = { ...entry, ...patch }
            next.state = deriveState(item, next as TrackerEntry)
            updateTrackerResponseDraft(next as TrackerEntry)
          })}
        </div>
        {item.subItems.length > 0 && (
          <div className="subitem-group">
            <span className="history-label">Sous-consignes</span>
            <div className="subitem-list">
              {item.subItems.map((subItem) => {
                const subEntry = entry.subEntries[subItem.id] ?? emptySubEntry(subItem)
                return (
                  <section key={subItem.id} className="subitem-card">
                    <div className="subitem-head">
                      <strong>{subItem.title}</strong>
                      <span className={`pill ${stateClassName(subEntry.state)}`}>{entryLabelForInput(subItem.inputKind, subEntry.state, subEntry.score)}</span>
                    </div>
                    {renderLeafResponseEditor(subItem.inputKind, subItem.target, subEntry, subItem.checklistTemplate, (patch) => updateTrackerSubEntryDraft(subItem, patch))}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }


  function renderGoalInput(goal: Goal) {
    if (goal.resultKind === 'tristate') {
      return (
        <label className="field">
          <span>Reponse</span>
          <select
            value={goal.status === 'success' ? 'yes' : goal.status === 'failed' ? 'no' : ''}
            onChange={(event) => updateGoal(goal.id, { status: event.target.value === 'yes' ? 'success' : event.target.value === 'no' ? 'failed' : 'unknown' })}
          >
            <option value="">Choisir</option>
            <option value="yes">Oui</option>
            <option value="no">Non</option>
          </select>
        </label>
      )
    }

    if (goal.resultKind === 'score') {
      return (
        <label className="field">
          <span>Reponse qualitative</span>
          <select
            value={goal.score == null ? '' : String(goal.score)}
            onChange={(event) => updateGoal(goal.id, { score: event.target.value === '' ? null : Number(event.target.value) })}
          >
            <option value="">Choisir</option>
            {likertOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      )
    }

    if (goal.resultKind === 'checklist') {
      return renderChecklistResponseEditor(goal.checklistTemplate, goal.checklist, (next) => updateGoal(goal.id, { checklist: next }))
    }

    if (goal.resultKind === 'numeric') {
      return (
        <div className="editor-grid">
          <label className="field">
            <span>{goal.target?.unit ? `Valeur (${goal.target.unit})` : 'Valeur saisie'}</span>
            <input
              type="number"
              value={goal.numericValue ?? ''}
              onChange={(event) => updateGoal(goal.id, { numericValue: event.target.value === '' ? null : Number(event.target.value) })}
            />
          </label>
          <span className="muted-inline">{goal.target ? `${goal.target.mode === 'atLeast' ? 'Objectif minimum' : goal.target.mode === 'atMost' ? 'Maximum autorise' : 'Objectif exact'} : ${goal.target.value}${goal.target.unit ? ` ${goal.target.unit}` : ''}` : ''}</span>
        </div>
      )
    }

    return (
      <label className="field">
        <span>Reponse libre</span>
        <textarea value={goal.note} onChange={(event) => updateGoal(goal.id, { note: event.target.value })} placeholder="Resultat, apprentissage, synthese..." />
      </label>
    )
  }

  function openTrackerModal(module: ModuleKey, item?: TrackerItem) {
    setEditingTrackerId(item?.id ?? null)
    setTrackerDraft(item ? trackerDraftFromItem(item) : defaultTrackerDraft(module))
    setModalView(module)
  }

  function openGoalModal() {
    setGoalDraft(defaultGoalDraft())
    setModalView('goals')
  }

  function openTrackerEditor(module: ModuleKey, itemId: string, occurrenceId: string, date?: string) {
    const item = state.trackerItems.find((candidate) => candidate.id === itemId)
    if (!item) return

    const occurrence = module === 'habits'
      ? buildHabitOccurrenceForDate(
          date ?? selectedHabitDate,
          state.trackerItems,
          state.occurrences,
          habitOccurrences.find((candidate) => candidate.date === (date ?? selectedHabitDate)),
        )
      : state.occurrences.find((candidate) => candidate.id === occurrenceId)

    if (!occurrence) return

    updateTrackerResponseDraft(cloneEntry(occurrence.entries[itemId]))
    setTrackerEditor({ module, itemId, occurrenceId, date })
    writeDebugLog('tracker-editor-opened', { module, itemId, occurrenceId, date })
  }

  function closeTrackerEditor() {
    if (trackerEditor) {
      writeDebugLog('tracker-editor-closed', { module: trackerEditor.module, itemId: trackerEditor.itemId, occurrenceId: trackerEditor.occurrenceId, date: trackerEditor.date })
    }
    setTrackerEditor(null)
    updateTrackerResponseDraft(null)
  }

  function saveTrackerEditor() {
    const draft = trackerResponseDraftRef.current
    if (!trackerEditor || !trackerEditorItem || !trackerEditorOccurrence || !draft) return
    updateTrackerEntry(trackerEditorOccurrence.id, trackerEditorItem.id, {
      state: draft.state,
      score: draft.score,
      checklist: draft.checklist,
      numericValue: draft.numericValue,
      note: draft.note,
      subEntries: draft.subEntries,
    })
    writeDebugLog('tracker-editor-saved', { module: trackerEditor.module, itemId: trackerEditor.itemId, occurrenceId: trackerEditorOccurrence.id })
    closeTrackerEditor()
  }
  function renderChecklistDraftEditor(
    scopeKey: string,
    items: string[],
    newItemValue: string,
    onChange: (value: string) => void,
    onAdd: () => void,
    onRemove: (index: number) => void,
    onMove: (from: number, to: number) => void,
    label = 'Checklist',
  ) {
    return (
      <div className="draft-builder">
        <span className="history-label">{label}</span>
        <div className="draft-builder-row">
          <input value={newItemValue} onChange={(event) => onChange(event.target.value)} placeholder="Ajouter un item" />
          <button type="button" className="ghost-button" onClick={onAdd}>Ajouter</button>
        </div>
        <div className="draft-chip-list">
          {items.map((item, index) => (
            <div
              key={`${item}-${index}`}
              className="draft-chip-row"
              draggable
              onDragStart={() => { checklistDragRef.current = { scope: scopeKey, index } }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                const drag = checklistDragRef.current
                if (!drag || drag.scope !== scopeKey || drag.index === index) return
                onMove(drag.index, index)
                checklistDragRef.current = null
              }}
              onDragEnd={() => { checklistDragRef.current = null }}
            >
              <div className="draft-chip-copy">
                <span className="drag-handle" aria-hidden="true">⋮⋮</span>
                <span>{item}</span>
              </div>
              <button type="button" className="ghost-icon draft-remove" aria-label={`Supprimer ${item}`} onClick={() => onRemove(index)}>×</button>
            </div>
          ))}
        </div>
      </div>
    )
  }


  function renderSubItemDraftEditor(subItem: TrackerSubDraft) {
    return (
      <section key={subItem.id} className="subitem-card subitem-draft-card">
        <div className="subitem-head">
          <strong>Sous-consigne</strong>
          <button type="button" className="ghost-icon draft-remove" aria-label={`Supprimer ${subItem.title || 'la sous-consigne'}`} onClick={() => removeSubItemDraft(subItem.id)}>×</button>
        </div>
        <input value={subItem.title} onChange={(event) => patchSubItemDraft(subItem.id, { title: event.target.value })} placeholder="Titre de la sous-consigne" />
        <select value={subItem.inputKind} onChange={(event) => patchSubItemDraft(subItem.id, { inputKind: event.target.value as InputKind })}>
          <option value="tristate">Oui / Non</option>
          <option value="score">Echelle qualitative</option>
          <option value="checklist">Checklist</option>
          <option value="numeric">Valeur chiffree</option>
          <option value="note">Note libre</option>
        </select>
        {subItem.inputKind === 'checklist' && renderChecklistDraftEditor(
          `sub-${subItem.id}`,
          subItem.checklistItems,
          subItem.newChecklistItem,
          (value) => patchSubItemDraft(subItem.id, { newChecklistItem: value }),
          () => addChecklistItemToSubDraft(subItem.id),
          (index) => removeChecklistItemFromSubDraft(subItem.id, index),
          (from, to) => moveChecklistItemInSubDraft(subItem.id, from, to),
          'Items de sous-checklist',
        )}
        {subItem.inputKind === 'numeric' && (
          <>
            <select value={subItem.targetMode} onChange={(event) => patchSubItemDraft(subItem.id, { targetMode: event.target.value as TargetMode })}>
              <option value="atLeast">Atteindre au moins</option>
              <option value="atMost">Ne pas depasser</option>
              <option value="exactly">Atteindre exactement</option>
            </select>
            <input type="number" value={subItem.targetValue} onChange={(event) => patchSubItemDraft(subItem.id, { targetValue: Number(event.target.value) })} placeholder="Objectif cible" />
            <input value={subItem.targetUnit} onChange={(event) => patchSubItemDraft(subItem.id, { targetUnit: event.target.value })} placeholder="Unite" />
          </>
        )}
      </section>
    )
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
                <strong className="date-nav-label">{selectedHabitDateLabel}</strong>
                <button type="button" className="date-arrow" onClick={() => stepHabitDate('next')} aria-label="Jour suivant">›</button>
              </div>
              <button type="button" className="fab-button" aria-label="Ajouter une habitude" onClick={() => openTrackerModal('habits')}>+</button>
            </div>

            <div className="tracker-list">
              {habitItems.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucune habitude</h3>
                  <p>Ajoute seulement tes propres consignes.</p>
                </article>
              )}
              {habitItems.map((item) => (
                <article key={item.id} className="tracker-card">
                  <div className="tracker-head">
                    <button
                      type="button"
                      className="tracker-open"
                      onClick={() => openTrackerEditor('habits', item.id, resolvedHabitOccurrence.id, resolvedHabitOccurrence.date ?? undefined)}
                      aria-label={`Renseigner ${item.title}`}
                    >
                      <div className="tracker-open-copy">
                        <strong>{item.title}</strong>
                        {entryLabelForInput(item.inputKind, resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown', resolvedHabitOccurrence.entries[item.id]?.score) && (
                          <div className="tracker-meta">
                            <span className={`pill ${stateClassName(resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown')}`}>{entryLabelForInput(item.inputKind, resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown', resolvedHabitOccurrence.entries[item.id]?.score)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="tracker-card-actions">
                      <button
                        type="button"
                        className="ghost-icon tracker-menu-button"
                        aria-label={`Modifier ${item.title}`}
                        onClick={() => openTrackerModal('habits', item)}
                      >
                        ⋮
                      </button>
                    </div>
                  </div>


                  <div className="history-row">
                    <span className="history-label">Historique</span>
                    <HistoryCarousel
                      items={habitHistory(item.id)}
                      selectedDate={selectedHabitDate}
                      onSelect={(date) => {
                        const occurrence = habitOccurrences.find((candidate) => candidate.date === date)
                        writeDebugLog('habit-history-select', { from: selectedHabitDate, to: date, occurrenceId: occurrence?.id })
                        setSelectedHabitDate(date)
                        if (occurrence) {
                          openTrackerEditor('habits', item.id, occurrence.id, date)
                        }
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'performances' && (
          <section className="panel surface-panel">
            <div className="surface-head">
              <div className="surface-actions">
                <button type="button" className="ghost-button" onClick={() => createNewOccurrence('performances', 'standard')}>Nouvelle iteration</button>
              </div>
              <button type="button" className="fab-button" aria-label="Ajouter une performance" onClick={() => openTrackerModal('performances')}>+</button>
            </div>

            <div className="tracker-list">
              {performanceItems.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucune performance</h3>
                  <p>Ajoute tes axes de progression avant de lancer une iteration.</p>
                </article>
              )}
              {performanceItems.map((item) => (
                <article key={item.id} className="tracker-card">
                  <div className="tracker-head">
                    <button
                      type="button"
                      className="tracker-open"
                      onClick={() => selectedPerformanceOccurrence && openTrackerEditor('performances', item.id, selectedPerformanceOccurrence.id)}
                      aria-label={`Renseigner ${item.title}`}
                      disabled={!selectedPerformanceOccurrence}
                    >
                      <div className="tracker-open-copy">
                        <strong>{item.title}</strong>
                        {entryLabelForInput(item.inputKind, selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown', selectedPerformanceOccurrence?.entries[item.id]?.score) && (
                          <div className="tracker-meta">
                            <span className={`pill ${stateClassName(selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown')}`}>{entryLabelForInput(item.inputKind, selectedPerformanceOccurrence?.entries[item.id]?.state ?? 'unknown', selectedPerformanceOccurrence?.entries[item.id]?.score)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="tracker-card-actions">
                      <button
                        type="button"
                        className="ghost-icon tracker-menu-button"
                        aria-label={`Modifier ${item.title}`}
                        onClick={() => openTrackerModal('performances', item)}
                      >
                        ⋮
                      </button>
                    </div>
                  </div>
                  {item.description && <p className="compact-description">{item.description}</p>}
                  {!selectedPerformanceOccurrence && <p className="muted-inline">Cree d abord une iteration pour saisir tes performances.</p>}
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'goals' && (
          <section className="panel surface-panel">
            <div className="surface-head">
              <strong>Objectifs</strong>
              <button type="button" className="fab-button" aria-label="Ajouter un objectif" onClick={openGoalModal}>+</button>
            </div>

            <div className="goal-list">
              {sortedGoals.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucun objectif</h3>
                  <p>Ajoute seulement les objectifs que tu veux suivre.</p>
                </article>
              )}
              {sortedGoals.map((goal) => (
                <article key={goal.id} className={`goal-card horizon-${goal.horizon}`}>
                  <div className="goal-head">
                    <div>
                      <strong>{goal.title}</strong>
                      <div className="tracker-meta">
                        {entryLabelForInput(goal.resultKind, goalState(goal), goal.score) && (
                          <span className={`pill ${stateClassName(goalState(goal))}`}>{entryLabelForInput(goal.resultKind, goalState(goal), goal.score)}</span>
                        )}
                        <span className="ghost-pill">{periodLabel(goal)}</span>
                      </div>
                    </div>
                    <small>{formatLongDate(goal.dueDate)}</small>
                  </div>

                  {renderGoalInput(goal)}
                </article>
              ))}
            </div>
          </section>
        )}

        {trackerEditor && trackerEditorItem && trackerEditorOccurrence && (
          <div className="modal-backdrop" role="presentation" onClick={closeTrackerEditor}>
            <div className="modal-card tracker-editor-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h3>{trackerEditorItem.title}</h3>
                  <div className="editor-context">
                    {entryLabelForInput(trackerEditorItem.inputKind, trackerEditorOccurrence.entries[trackerEditorItem.id]?.state ?? 'unknown', trackerEditorOccurrence.entries[trackerEditorItem.id]?.score) && (
                      <span className={`pill ${stateClassName(trackerEditorOccurrence.entries[trackerEditorItem.id]?.state ?? 'unknown')}`}>{entryLabelForInput(trackerEditorItem.inputKind, trackerEditorOccurrence.entries[trackerEditorItem.id]?.state ?? 'unknown', trackerEditorOccurrence.entries[trackerEditorItem.id]?.score)}</span>
                    )}
                    <span className="ghost-pill">{trackerEditor.module === 'habits' ? formatLongDate(trackerEditor.date) : trackerEditorOccurrence.label}</span>
                  </div>
                </div>
                <button type="button" className="ghost-icon" aria-label="Fermer" onClick={closeTrackerEditor}>×</button>
              </div>
              <div className="tracker-editor-body">
                {renderTrackerEditorInput(trackerEditorItem)}
                <div className="editor-actions">
                  <button type="button" className="ghost-button" onClick={saveTrackerEditor}>Valider</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {modalView && (
          <div className="modal-backdrop" role="presentation" onClick={() => { setModalView(null); setEditingTrackerId(null) }}>
            <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{modalView === 'goals' ? 'Ajouter un objectif' : editingTrackerId ? 'Modifier la consigne' : modalView === 'habits' ? 'Ajouter une habitude' : 'Ajouter une performance'}</h3>
                <button type="button" className="ghost-icon" aria-label="Fermer" onClick={() => { setModalView(null); setEditingTrackerId(null) }}>×</button>
              </div>

              {modalView === 'goals' ? (
                <form className="form-grid compact-form" onSubmit={addGoal}>
                  <input required value={goalDraft.title} onChange={(event) => setGoalDraft({ ...goalDraft, title: event.target.value })} placeholder="Titre" />
                  <select value={goalDraft.horizon} onChange={(event) => setGoalDraft({ ...goalDraft, horizon: event.target.value as GoalHorizon })}>
                    {horizonOrder.map((horizon) => <option key={horizon} value={horizon}>{horizonLabel(horizon)}</option>)}
                  </select>
                  <input type="date" value={goalDraft.dueDate} onChange={(event) => setGoalDraft({ ...goalDraft, dueDate: event.target.value })} />
                  <select value={goalDraft.resultKind} onChange={(event) => setGoalDraft({ ...goalDraft, resultKind: event.target.value as InputKind })}>
                    <option value="tristate">Oui / Non</option>
                    <option value="score">Echelle qualitative</option>
                    <option value="checklist">Checklist</option>
                    <option value="numeric">Valeur chiffree</option>
                    <option value="note">Note libre</option>
                  </select>
                  <label className="toggle">
                    <input type="checkbox" checked={goalDraft.reminder} onChange={(event) => setGoalDraft({ ...goalDraft, reminder: event.target.checked })} />
                    Rappel
                  </label>
                  {goalDraft.resultKind === 'checklist' && renderChecklistDraftEditor(
                    'goal-draft',
                    goalDraft.checklistItems,
                    goalDraft.newChecklistItem,
                    (value) => setGoalDraft({ ...goalDraft, newChecklistItem: value }),
                    addChecklistItemToGoalDraft,
                    removeChecklistItemFromGoalDraft,
                    moveGoalChecklistItem,
                  )}
                  {goalDraft.resultKind === 'numeric' && (
                    <>
                      <select value={goalDraft.targetMode} onChange={(event) => setGoalDraft({ ...goalDraft, targetMode: event.target.value as TargetMode })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={goalDraft.targetValue} onChange={(event) => setGoalDraft({ ...goalDraft, targetValue: Number(event.target.value) })} placeholder="Objectif cible" />
                      <input value={goalDraft.targetUnit} onChange={(event) => setGoalDraft({ ...goalDraft, targetUnit: event.target.value })} placeholder="Unite" />
                    </>
                  )}
                  <button type="submit">{editingTrackerId ? 'Enregistrer' : 'Ajouter'}</button>
                </form>
              ) : (
                <form className="form-grid compact-form" onSubmit={saveTrackerItem}>
                  <input required value={trackerDraft.title} onChange={(event) => setTrackerDraft({ ...trackerDraft, title: event.target.value, module: modalView })} placeholder="Titre" />
                  <select value={trackerDraft.inputKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, inputKind: event.target.value as InputKind, module: modalView })}>
                    <option value="tristate">Oui / Non</option>
                    <option value="score">Echelle qualitative</option>
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
                  {modalView === 'habits' && (
                    <label className="field">
                      <span>Jours de repos automatiques</span>
                      <input
                        type="number"
                        min="0"
                        value={trackerDraft.restAfterSuccess}
                        onChange={(event) => setTrackerDraft({ ...trackerDraft, restAfterSuccess: Number(event.target.value), module: modalView })}
                        placeholder="Nombre de jours"
                      />
                      <small className="muted-inline">
                        Si la consigne est reussie, elle pourra etre mise en pause automatiquement pendant ce nombre de jours.
                      </small>
                    </label>
                  )}
                  {trackerDraft.inputKind === 'checklist' && renderChecklistDraftEditor(
                    'tracker-draft',
                    trackerDraft.checklistItems,
                    trackerDraft.newChecklistItem,
                    (value) => setTrackerDraft({ ...trackerDraft, newChecklistItem: value, module: modalView }),
                    addChecklistItemToTrackerDraft,
                    removeChecklistItemFromTrackerDraft,
                    moveTrackerChecklistItem,
                  )}
                  {trackerDraft.inputKind === 'numeric' && (
                    <>
                      <select value={trackerDraft.targetMode} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetMode: event.target.value as TargetMode, module: modalView })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={trackerDraft.targetValue} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetValue: Number(event.target.value), module: modalView })} placeholder="Objectif cible" />
                      <input value={trackerDraft.targetUnit} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetUnit: event.target.value, module: modalView })} placeholder="Unite" />
                    </>
                  )}
                  <div className="draft-builder">
                    <span className="history-label">Sous-consignes</span>
                    <div className="subitem-list">
                      {trackerDraft.subItems.map((subItem) => renderSubItemDraftEditor(subItem))}
                    </div>
                    <button type="button" className="ghost-button" onClick={addSubItemDraft}>Ajouter une sous-consigne</button>
                  </div>
                  <button type="submit">{editingTrackerId ? 'Enregistrer' : 'Ajouter'}</button>
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
