import { useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import './App.css'
import { firebaseAuth, firebaseDb, googleAuthProvider, isAdminEmail } from './firebase'

declare global {
  interface Window {
    __suiviDebugLog?: DebugEntry[]
    copySuiviLogs?: () => Promise<void>
    clearSuiviLogs?: () => void
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  }
}

type ModuleKey = 'habits' | 'performances'
type ViewKey = 'habits' | 'performances' | 'goals' | 'admin'
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
  category: string
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

type GoalSubItem = TrackerSubItem

type GoalSubEntry = TrackerSubEntry

type Goal = {
  id: string
  title: string
  description: string
  horizon: GoalHorizon
  dueDate: string
  weekDate?: string | null
  resultKind: InputKind
  priority: Priority
  reminder: boolean
  checklistTemplate: string[]
  target: { mode: TargetMode; value: number; unit: string } | null
  subItems: GoalSubItem[]
  status: EntryState
  score: number | null
  checklist: ChecklistStatus[]
  numericValue: number | null
  note: string
  subEntries: Record<string, GoalSubEntry>
}

type AppState = {
  trackerItems: TrackerItem[]
  occurrences: TrackerOccurrence[]
  goals: Goal[]
  lastTrackerCategory?: string
  lastPerformanceCategoryFilter?: string
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
  targetValue: string
  targetUnit: string
}

type TrackerDraft = {
  module: ModuleKey
  title: string
  description: string
  category: string
  inputKind: InputKind
  priority: Priority
  frequencyKind: FrequencyKind
  frequencyDays: number[]
  restAfterSuccess: string
  checklistItems: string[]
  newChecklistItem: string
  targetMode: TargetMode
  targetValue: string
  targetUnit: string
  subItems: TrackerSubDraft[]
}

type TrackerEditorState = {
  module: ModuleKey
  occurrenceId: string
  itemId: string
  date?: string
}

type GoalEditorState = {
  goalId: string
}

type InstallState = 'hidden' | 'available' | 'manual' | 'installed'

type HistoryItem = {
  occurrenceId: string
  date: string
  label?: string
  state: EntryState
}

type CelebrationState = {
  itemId: string
  module: ModuleKey
  level: 1 | 2 | 3 | 4
  streak: number
  token: number
}

type AuthMode = 'login' | 'register'

type AdminProfile = {
  id: string
  email: string
  updatedAt: string | null
  createdAt: string | null
}

type GoalDraft = {
  title: string
  description: string
  horizon: GoalHorizon
  dueDate: string
  weekDate: string
  resultKind: InputKind
  priority: Priority
  reminder: boolean
  checklistItems: string[]
  newChecklistItem: string
  targetMode: TargetMode
  targetValue: string
  targetUnit: string
  subItems: TrackerSubDraft[]
}

const storageKey = 'application-de-suivi-v2'
const debugStorageKey = 'application-de-suivi-debug-v1'
const todayDate = new Date()
todayDate.setHours(12, 0, 0, 0)
const today = formatDateKey(todayDate)
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
  targetValue: '',
  targetUnit: '',
})

const defaultTrackerDraft = (module: ModuleKey): TrackerDraft => ({
  module,
  title: '',
  description: '',
  category: '',
  inputKind: 'tristate',
  priority: 'medium',
  frequencyKind: 'daily',
  frequencyDays: [1, 2, 3, 4, 5],
  restAfterSuccess: '',
  checklistItems: [],
  newChecklistItem: '',
  targetMode: 'atLeast',
  targetValue: '',
  targetUnit: '',
  subItems: [],
})

const defaultGoalDraft = (): GoalDraft => ({
  title: '',
  description: '',
  horizon: 'week',
  dueDate: today,
  weekDate: today,
  resultKind: 'tristate',
  priority: 'medium',
  reminder: true,
  checklistItems: [],
  newChecklistItem: '',
  targetMode: 'atLeast',
  targetValue: '',
  targetUnit: '',
  subItems: [],
})

function trackerDraftFromItem(item: TrackerItem): TrackerDraft {
  return {
    module: item.module,
    title: item.title,
    description: item.description,
    category: item.category ?? '',
    inputKind: item.inputKind,
    priority: item.priority,
    frequencyKind: item.frequency?.kind ?? 'daily',
    frequencyDays: item.frequency?.days ?? [1, 2, 3, 4, 5],
    restAfterSuccess: item.restAfterSuccess === 0 ? '' : String(item.restAfterSuccess),
    checklistItems: [...item.checklistTemplate],
    newChecklistItem: '',
    targetMode: item.target?.mode ?? 'atLeast',
    targetValue: item.target ? String(item.target.value) : '',
    targetUnit: item.target?.unit ?? '',
    subItems: item.subItems.map((subItem) => ({
      id: subItem.id,
      title: subItem.title,
      inputKind: subItem.inputKind,
      checklistItems: [...subItem.checklistTemplate],
      newChecklistItem: '',
      targetMode: subItem.target?.mode ?? 'atLeast',
      targetValue: subItem.target ? String(subItem.target.value) : '',
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
    if (entry.state === 'failed' && entry.checklist.every((value) => value === 'unknown')) return 'failed'
    if (entry.checklist.length === 0 || entry.checklist.every((value) => value === 'unknown')) return 'unknown'
    const completedCount = entry.checklist.filter((value) => value === 'done' || value === 'excused').length
    const completionRatio = completedCount / entry.checklist.length
    if (completionRatio === 1) return entry.checklist.some((value) => value === 'done') ? 'success' : 'excused'
    if (completionRatio >= 0.5) return 'excused'
    return 'failed'
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
    return ''
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

function orderedStandardOccurrences(module: ModuleKey, occurrences: TrackerOccurrence[]) {
  return occurrences
    .filter((occurrence) => occurrence.module === module && occurrence.kind === 'standard')
    .sort((left, right) => right.key - left.key)
}

function successStreakForOccurrence(module: ModuleKey, itemId: string, occurrenceId: string, occurrences: TrackerOccurrence[]) {
  const ordered = orderedStandardOccurrences(module, occurrences)
  const startIndex = ordered.findIndex((occurrence) => occurrence.id === occurrenceId)
  if (startIndex === -1) return 0

  let streak = 0
  for (let index = startIndex; index < ordered.length; index += 1) {
    if (ordered[index].entries[itemId]?.state !== 'success') break
    streak += 1
  }
  return streak
}

function celebrationLevelForStreak(streak: number): 1 | 2 | 3 | 4 {
  if (streak >= 6) return 4
  if (streak >= 4) return 3
  if (streak >= 2) return 2
  return 1
}

function celebrationMessageForStreak(streak: number) {
  if (streak >= 6) return `Serie de ${streak} reussites`
  if (streak >= 4) return `Tres belle serie : ${streak}`
  if (streak >= 2) return `Serie lancee : ${streak}`
  return 'Bien joue'
}

function celebrationGlyphsForLevel(level: CelebrationState['level']) {
  if (level === 4) return ['✦', '💚', '✦', '⚡']
  if (level === 3) return ['✦', '★', '✦']
  if (level === 2) return ['✦', '✦', '✦']
  return ['✦', '✓', '✦']
}

function buildUpdatedOccurrencesAfterEntryPatch(
  occurrences: TrackerOccurrence[],
  trackerItems: TrackerItem[],
  item: TrackerItem,
  occurrenceId: string,
  patch: Partial<TrackerEntry>,
  fallbackHabitDate: string,
) {
  const existingOccurrence = occurrences.find((occurrence) => occurrence.id === occurrenceId)

  if (!existingOccurrence && item.module === 'habits') {
    const createdOccurrence = createHabitOccurrenceForDate(fallbackHabitDate, trackerItems, occurrences)
    const current = createdOccurrence.entries[item.id]
    const next = { ...current, ...patch }
    next.state = deriveState(item, next)

    return {
      occurrenceId: createdOccurrence.id,
      nextEntry: next,
      occurrences: [...occurrences, {
        ...createdOccurrence,
        entries: {
          ...createdOccurrence.entries,
          [item.id]: next,
        },
      }],
      createdOnDemand: true,
    }
  }

  let nextEntry: TrackerEntry | null = null
  const nextOccurrences = occurrences.map((occurrence) => {
    if (occurrence.id !== occurrenceId) return occurrence
    const current = occurrence.entries[item.id]
    const next = { ...current, ...patch }
    next.state = deriveState(item, next)
    nextEntry = next
    return {
      ...occurrence,
      entries: {
        ...occurrence.entries,
        [item.id]: next,
      },
    }
  })

  return {
    occurrenceId,
    nextEntry,
    occurrences: nextOccurrences,
    createdOnDemand: false,
  }
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

function startOfWeek(date: string) {
  const current = new Date(`${date}T12:00:00`)
  const day = current.getDay()
  const diff = day === 0 ? -6 : 1 - day
  current.setDate(current.getDate() + diff)
  return formatDateKey(current)
}

function endOfWeek(date: string) {
  return shiftDate(startOfWeek(date), 6)
}

function startOfMonth(date: string) {
  const current = new Date(`${date}T12:00:00`)
  return formatDateKey(new Date(current.getFullYear(), current.getMonth(), 1, 12))
}

function endOfMonth(date: string) {
  const current = new Date(`${date}T12:00:00`)
  return formatDateKey(new Date(current.getFullYear(), current.getMonth() + 1, 0, 12))
}

function shiftMonth(date: string, delta: number) {
  const current = new Date(`${date}T12:00:00`)
  return formatDateKey(new Date(current.getFullYear(), current.getMonth() + delta, 1, 12))
}

function shiftYear(date: string, delta: number) {
  const current = new Date(`${date}T12:00:00`)
  return formatDateKey(new Date(current.getFullYear() + delta, current.getMonth(), 1, 12))
}

function monthLabel(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function yearLabel(date: string) {
  return new Intl.DateTimeFormat('fr-FR', { year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function listWeeksInMonth(date: string) {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const monthValue = new Date(`${date}T12:00:00`).getMonth()
  const weeks: { start: string; end: string; label: string; index: number }[] = []
  let cursor = startOfWeek(monthStart)
  let index = 1

  while (cursor <= monthEnd) {
    const weekStart = cursor
    const weekEnd = endOfWeek(weekStart)
    let daysInMonth = 0
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(`${shiftDate(weekStart, offset)}T12:00:00`)
      if (day.getMonth() === monthValue) {
        daysInMonth += 1
      }
    }

    if (daysInMonth >= 4) {
      weeks.push({
        start: weekStart,
        end: weekEnd,
        label: `Semaine ${index}`,
        index,
      })
      index += 1
    }

    cursor = shiftDate(weekStart, 7)
  }

  return weeks.slice(0, 4)
}

function goalDueDateForHorizon(horizon: GoalHorizon, anchorDate: string, weeks = listWeeksInMonth(anchorDate)) {
  if (horizon === 'week') {
    return endOfWeek(anchorDate)
  }
  if (horizon === 'month') {
    return weeks[weeks.length - 1]?.end ?? endOfMonth(anchorDate)
  }
  if (horizon === 'year') {
    const current = new Date(`${anchorDate}T12:00:00`)
    return formatDateKey(new Date(current.getFullYear(), 11, 31, 12))
  }
  return anchorDate
}

function formatHistoryDate(date: string) {
  const parsedDate = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsedDate.getTime())) {
    return date
  }
  const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(parsedDate)
  const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(parsedDate).replace('.', '').toUpperCase()
  return `${dayMonth}\n${weekday}`
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
    category: raw.category ?? '',
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
    weekDate: raw.weekDate ?? null,
    resultKind: raw.resultKind ?? 'tristate',
    priority: raw.priority ?? 'medium',
    reminder: raw.reminder ?? true,
    checklistTemplate: raw.checklistTemplate ?? [],
    target: raw.target ?? null,
    subItems: (raw.subItems ?? []).map((item) => normalizeSubItem(item)),
    status: raw.status ?? 'unknown',
    score: raw.score ?? null,
    checklist: (raw.resultKind ?? 'tristate') === 'checklist' ? (raw.checklistTemplate ?? []).map((_, index) => normalizeChecklistState(raw.checklist?.[index])) : [],
    numericValue: raw.numericValue ?? null,
    note: raw.note ?? '',
    subEntries: Object.fromEntries(((raw.subItems ?? []).map((item) => normalizeSubItem(item))).map((subItem) => [subItem.id, normalizeSubEntry(raw.subEntries?.[subItem.id], subItem)])),
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
  return {
    trackerItems,
    occurrences,
    goals,
    lastTrackerCategory: raw.lastTrackerCategory ?? '',
    lastPerformanceCategoryFilter: raw.lastPerformanceCategoryFilter ?? '',
  }
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
  if (items.length === 0) {
    return <span className="muted-inline">Pas encore d historique.</span>
  }

  return (
    <div className="history-strip compact-history-strip">
      {items.map((history) => {
        const label = history.label ?? formatHistoryDate(history.date)
        const [dayMonth = label, weekday = ''] = label.split('\n')
        return (
          <button
            key={history.occurrenceId}
            type="button"
            className={`history-compact-item state-${history.state} ${history.date === selectedDate ? 'active' : ''}`}
            onClick={() => onSelect(history.date)}
          >
            <span className="history-status-dot" aria-hidden="true" />
            <span className="history-compact-date">{dayMonth}</span>
            <span className="history-compact-day">{weekday}</span>
          </button>
        )
      })}
    </div>
  )
}

function App() {
  const [view, setView] = useState<ViewKey>('habits')
  const [state, setState] = useState<AppState>(() => loadState())
  const [performanceCategoryFilter, setPerformanceCategoryFilter] = useState<string>(state.lastPerformanceCategoryFilter ?? '')
  const [authReady, setAuthReady] = useState(false)
  const [remoteReady, setRemoteReady] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [sheetExportLoading, setSheetExportLoading] = useState(false)
  const [sheetExportError, setSheetExportError] = useState('')
  const [performanceValidatePulse, setPerformanceValidatePulse] = useState(0)
  const [adminProfiles, setAdminProfiles] = useState<AdminProfile[]>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [selectedHabitDate, setSelectedHabitDate] = useState(today)
  const [performanceOccurrenceId, setPerformanceOccurrenceId] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [modalView, setModalView] = useState<ModuleKey | 'goals' | null>(null)
  const [trackerEditor, setTrackerEditor] = useState<TrackerEditorState | null>(null)
  const [goalEditor, setGoalEditor] = useState<GoalEditorState | null>(null)
  const [editingTrackerId, setEditingTrackerId] = useState<string | null>(null)
  const [trackerResponseDraft, setTrackerResponseDraft] = useState<TrackerEntry | null>(null)
  const [celebration, setCelebration] = useState<CelebrationState | null>(null)
  const trackerResponseDraftRef = useRef<TrackerEntry | null>(null)
  const checklistDragRef = useRef<{ scope: string; index: number } | null>(null)
  const [trackerDraft, setTrackerDraft] = useState<TrackerDraft>(defaultTrackerDraft('habits'))
  const [trackerCategoryQuery, setTrackerCategoryQuery] = useState('')
  const [trackerCategoryFocused, setTrackerCategoryFocused] = useState(false)
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(defaultGoalDraft())
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null)
  const [goalViewMode, setGoalViewMode] = useState<'month' | 'year'>('month')
  const [goalPeriodDate, setGoalPeriodDate] = useState(startOfMonth(today))
  const [installState, setInstallState] = useState<InstallState>('hidden')
  const [installHintOpen, setInstallHintOpen] = useState(false)
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    setupDebugHelpers()
    writeDebugLog('app-ready', { trackerItems: state.trackerItems.length, goals: state.goals.length, occurrences: state.occurrences.length })
  }, [])

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      setCurrentUser(user)
      setAuthError('')

      if (!user) {
        setRemoteReady(false)
        setAuthReady(true)
        return
      }

      try {
        await setDoc(doc(firebaseDb, 'userProfiles', user.uid), {
          email: user.email ?? '',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        }, { merge: true })

        const snapshot = await getDoc(doc(firebaseDb, 'appStates', user.uid))
        if (snapshot.exists()) {
          const data = snapshot.data() as { state?: Partial<AppState> }
          if (data.state) {
            const remoteState = normalizeState(data.state)
            const localState = loadState()
            const remoteHasData = remoteState.trackerItems.length > 0 || remoteState.occurrences.length > 0 || remoteState.goals.length > 0
            const localHasData = localState.trackerItems.length > 0 || localState.occurrences.length > 0 || localState.goals.length > 0

            if (!remoteHasData && localHasData) {
              writeDebugLog('remote-state-empty-recovered-from-local', {
                uid: user.uid,
                email: user.email ?? '',
                trackerItems: localState.trackerItems.length,
                occurrences: localState.occurrences.length,
                goals: localState.goals.length,
              })

              await setDoc(doc(firebaseDb, 'appStates', user.uid), {
                email: user.email ?? '',
                state: localState,
                updatedAt: serverTimestamp(),
              }, { merge: true })

              setState(localState)
            } else {
              setState(remoteState)
            }
          }
        } else {
          const localState = loadState()
          const hasLocalData = localState.trackerItems.length > 0 || localState.occurrences.length > 0 || localState.goals.length > 0

          if (hasLocalData) {
            writeDebugLog('remote-state-missing-seeding-from-local', {
              uid: user.uid,
              email: user.email ?? '',
              trackerItems: localState.trackerItems.length,
              occurrences: localState.occurrences.length,
              goals: localState.goals.length,
            })

            await setDoc(doc(firebaseDb, 'appStates', user.uid), {
              email: user.email ?? '',
              state: localState,
              updatedAt: serverTimestamp(),
            }, { merge: true })

            setState(localState)
          }
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Impossible de charger les donnees du compte.')
      } finally {
        setRemoteReady(true)
        setAuthReady(true)
      }
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!authReady || !currentUser || !remoteReady) return

    const timeout = window.setTimeout(() => {
      void Promise.all([
        setDoc(doc(firebaseDb, 'appStates', currentUser.uid), {
          email: currentUser.email ?? '',
          state,
          updatedAt: serverTimestamp(),
        }, { merge: true }),
        setDoc(doc(firebaseDb, 'userProfiles', currentUser.uid), {
          email: currentUser.email ?? '',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        }, { merge: true }),
      ]).catch((error) => {
        setAuthError(error instanceof Error ? error.message : 'Impossible de synchroniser les donnees.')
      })
    }, 400)

    return () => window.clearTimeout(timeout)
  }, [authReady, currentUser, remoteReady, state])

  useEffect(() => {
    if (!celebration) return
    const timeout = window.setTimeout(() => setCelebration(null), 2200)
    return () => window.clearTimeout(timeout)
  }, [celebration])

  const habitItems = state.trackerItems.filter((item) => item.module === 'habits')
  const performanceItems = state.trackerItems.filter((item) => item.module === 'performances')
  const allCategories = Array.from(new Set(
    state.trackerItems
      .map((item) => (item.category || '').trim())
      .filter((value) => value.length > 0),
  )).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
  const performanceCategories = Array.from(new Set(
    performanceItems
      .map((item) => (item.category || '').trim())
      .filter((value) => value.length > 0),
  )).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))
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
  const resolvedPerformanceOccurrence = selectedPerformanceOccurrence ?? createOccurrence('performances', 'standard', state.trackerItems, state.occurrences)
  const habitRestItems = habitItems.filter((item) => (resolvedHabitOccurrence.entries[item.id] ?? emptyEntry(item)).state === 'rest')
  const visibleHabitItems = habitItems.filter((item) => (resolvedHabitOccurrence.entries[item.id] ?? emptyEntry(item)).state !== 'rest')
  const performanceRestItems = performanceItems.filter((item) => (resolvedPerformanceOccurrence.entries[item.id] ?? emptyEntry(item)).state === 'rest')
  const visiblePerformanceItems = performanceItems
    .filter((item) => (resolvedPerformanceOccurrence.entries[item.id] ?? emptyEntry(item)).state !== 'rest')
    .filter((item) => {
      if (!performanceCategoryFilter) return true
      return (item.category || '').trim() === performanceCategoryFilter
    })
  const hasAnyPerformance = performanceItems.length > 0
  const hasVisiblePerformance = visiblePerformanceItems.length > 0
  const effectivePerformanceFilter = performanceCategoryFilter && !hasVisiblePerformance && hasAnyPerformance ? '' : performanceCategoryFilter
  const selectedHabitDateLabel = formatLongDate(selectedHabitDate)
  const previousHabitDate = shiftDate(selectedHabitDate, -1)
  const nextHabitDate = shiftDate(selectedHabitDate, 1)
  const sortedGoals = sortGoals(state.goals)
  const monthWeeks = listWeeksInMonth(goalPeriodDate)
  const monthFinalDueDate = goalDueDateForHorizon('month', goalPeriodDate, monthWeeks)
  const yearFinalDueDate = goalDueDateForHorizon('year', goalPeriodDate, monthWeeks)
  const currentMonthStart = startOfMonth(goalPeriodDate)
  const currentMonthEnd = endOfMonth(goalPeriodDate)
  const currentYear = new Date(`${goalPeriodDate}T12:00:00`).getFullYear()
  const visibleGoals = sortedGoals.filter((goal) => {
    if (goalViewMode === 'month') {
      return goal.horizon === 'month'
        ? goal.dueDate >= currentMonthStart && goal.dueDate <= currentMonthEnd
        : Boolean(goal.weekDate && goal.weekDate >= monthWeeks[0]?.start && goal.weekDate <= monthWeeks[monthWeeks.length - 1]?.end)
    }
    return new Date(`${goal.dueDate}T12:00:00`).getFullYear() === currentYear
  })
  const monthLevelGoals = visibleGoals.filter((goal) => goal.horizon === 'month')
  const isAdmin = isAdminEmail(currentUser?.email)
  const activeViewTitle = view === 'habits' ? 'Habitudes' : view === 'performances' ? 'Performances' : view === 'goals' ? 'Objectifs' : 'Admin'
  const trackerEditorItem = trackerEditor ? state.trackerItems.find((candidate) => candidate.id === trackerEditor.itemId) ?? null : null
  const goalEditorItem = goalEditor ? state.goals.find((candidate) => candidate.id === goalEditor.goalId) ?? null : null
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

  function updateTrackerEntry(occurrenceId: string, itemId: string, patch: Partial<TrackerEntry>) {
    const item = state.trackerItems.find((candidate) => candidate.id === itemId)!
    const result = buildUpdatedOccurrencesAfterEntryPatch(
      state.occurrences,
      state.trackerItems,
      item,
      occurrenceId,
      patch,
      selectedHabitDate,
    )

    patchState({ occurrences: result.occurrences })

    if (result.createdOnDemand) {
      writeDebugLog('habit-entry-created-on-demand', { date: selectedHabitDate, itemId, state: result.nextEntry?.state })
    }

    writeDebugLog('tracker-entry-updated', {
      occurrenceId: result.occurrenceId,
      itemId,
      module: item.module,
      patchKeys: Object.keys(patch),
      selectedHabitDate,
      nextState: result.nextEntry?.state,
    })

    return result
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
    const normalizedCategory = trackerDraft.category.trim()
    const item: TrackerItem = {
      id: editingTrackerId ?? crypto.randomUUID(),
      module: trackerDraft.module,
      title: trackerDraft.title,
      description: trackerDraft.description,
      category: normalizedCategory,
      inputKind: trackerDraft.inputKind,
      priority: trackerDraft.priority,
      checklistTemplate,
      target: trackerDraft.inputKind === 'numeric' && trackerDraft.targetValue !== ''
        ? { mode: trackerDraft.targetMode, value: Number(trackerDraft.targetValue), unit: trackerDraft.targetUnit }
        : null,
      frequency: trackerDraft.module === 'habits'
        ? { kind: trackerDraft.frequencyKind, days: trackerDraft.frequencyDays }
        : null,
      restAfterSuccess: trackerDraft.restAfterSuccess === '' ? 0 : Number(trackerDraft.restAfterSuccess),
      subItems: trackerDraft.subItems.map((subItem) => ({
        id: subItem.id,
        title: subItem.title,
        inputKind: subItem.inputKind,
        checklistTemplate: subItem.inputKind === 'checklist' ? subItem.checklistItems : [],
        target: subItem.inputKind === 'numeric' && subItem.targetValue !== ''
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
        lastTrackerCategory: normalizedCategory || state.lastTrackerCategory,
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

      patchState({ trackerItems: nextItems, occurrences: nextOccurrences, lastTrackerCategory: normalizedCategory || state.lastTrackerCategory })
      writeDebugLog('tracker-item-added', { module: trackerDraft.module, title: trackerDraft.title, inputKind: trackerDraft.inputKind, priority: trackerDraft.priority })
    }

    setEditingTrackerId(null)
    setTrackerDraft(defaultTrackerDraft(trackerDraft.module))
    setModalView(null)
  }

  function addGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedWeekDate = goalDraft.horizon === 'week' ? startOfWeek(goalDraft.dueDate) : null
    const computedDueDate = goalDraft.horizon === 'week'
      ? goalDueDateForHorizon('week', normalizedWeekDate ?? goalDraft.dueDate)
      : goalDraft.horizon === 'month'
        ? goalDueDateForHorizon('month', goalDraft.dueDate, listWeeksInMonth(goalDraft.dueDate))
        : goalDraft.horizon === 'year'
          ? goalDueDateForHorizon('year', goalDraft.dueDate)
          : goalDraft.dueDate

    const base: Goal = {
      id: editingGoalId ?? crypto.randomUUID(),
      title: goalDraft.title,
      description: goalDraft.description,
      horizon: goalDraft.horizon,
      dueDate: computedDueDate,
      weekDate: normalizedWeekDate,
      resultKind: goalDraft.resultKind,
      priority: goalDraft.priority,
      reminder: goalDraft.reminder,
      checklistTemplate: goalDraft.resultKind === 'checklist' ? goalDraft.checklistItems : [],
      target: goalDraft.resultKind === 'numeric' && goalDraft.targetValue !== ''
        ? { mode: goalDraft.targetMode, value: Number(goalDraft.targetValue), unit: goalDraft.targetUnit }
        : null,
      subItems: goalDraft.subItems.map((subItem) => ({ id: subItem.id, title: subItem.title, inputKind: subItem.inputKind, checklistTemplate: subItem.inputKind === 'checklist' ? subItem.checklistItems : [], target: subItem.inputKind === 'numeric' && subItem.targetValue !== '' ? { mode: subItem.targetMode, value: Number(subItem.targetValue), unit: subItem.targetUnit } : null })),
      status: 'unknown',
      score: null,
      checklist: goalDraft.resultKind === 'checklist' ? goalDraft.checklistItems.map(() => 'unknown' as ChecklistStatus) : [],
      numericValue: null,
      note: '',
      subEntries: Object.fromEntries(goalDraft.subItems.map((subItem) => {
        const normalizedSubItem = { id: subItem.id, title: subItem.title, inputKind: subItem.inputKind, checklistTemplate: subItem.inputKind === 'checklist' ? subItem.checklistItems : [], target: subItem.inputKind === 'numeric' && subItem.targetValue !== '' ? { mode: subItem.targetMode, value: Number(subItem.targetValue), unit: subItem.targetUnit } : null }
        return [subItem.id, normalizeSubEntry(undefined, normalizedSubItem)]
      })),
    }

    if (editingGoalId) {
      patchState({
        goals: state.goals.map((goal) => goal.id === editingGoalId ? { ...goal, ...base, id: goal.id } : goal),
      })
      writeDebugLog('goal-updated', { goalId: editingGoalId, title: base.title, horizon: base.horizon, dueDate: base.dueDate, resultKind: base.resultKind })
    } else {
      patchState({ goals: [...state.goals, base] })
      writeDebugLog('goal-added', { title: base.title, horizon: base.horizon, dueDate: base.dueDate, resultKind: base.resultKind })
    }

    setGoalDraft(defaultGoalDraft())
    setEditingGoalId(null)
    setModalView(null)
  }

  function updateGoal(goalId: string, patch: Partial<Goal>) {
    const nextGoals = state.goals.map((goal) => {
      if (goal.id !== goalId) return goal
      const nextGoal = { ...goal, ...patch }
      if (nextGoal.resultKind === 'tristate') {
        nextGoal.score = null
        nextGoal.numericValue = null
        nextGoal.note = ''
      }
      return nextGoal
    })
    patchState({ goals: nextGoals })
  }

  function goalStatusTone(goal: Goal): 'success' | 'neutral' | 'failed' | 'unknown' {
    if (goal.resultKind === 'tristate') {
      if (goal.status === 'success') return 'success'
      if (goal.status === 'failed') return 'failed'
      return 'unknown'
    }

    if (goal.resultKind === 'score') {
      if (goal.score == null) return 'unknown'
      if (goal.score >= 3) return 'success'
      if (goal.score === 2) return 'neutral'
      return 'failed'
    }

    if (goal.resultKind === 'numeric') {
      if (goal.numericValue == null || !goal.target) return 'unknown'
      const { mode, value } = goal.target
      const current = goal.numericValue
      const success = mode === 'atLeast' ? current >= value : mode === 'atMost' ? current <= value : current === value
      if (success) return 'success'
      const closeEnough = Math.abs(current - value) <= Math.max(1, Math.abs(value) * 0.15)
      return closeEnough ? 'neutral' : 'failed'
    }

    if (goal.resultKind === 'checklist') {
      if (!goal.checklist.length) return 'unknown'
      const doneCount = goal.checklist.filter((item) => item === 'done').length
      const failedCount = goal.checklist.filter((item) => item === 'failed').length
      if (doneCount === goal.checklist.length) return 'success'
      if (doneCount > 0 && failedCount < goal.checklist.length) return 'neutral'
      if (failedCount > 0) return 'failed'
      return 'unknown'
    }

    if (goal.resultKind === 'note') {
      return goal.note.trim() ? 'neutral' : 'unknown'
    }

    return 'unknown'
  }

  function pulsePerformanceValidation(event: MouseEvent<HTMLButtonElement>) {
    const button = event.currentTarget
    button.classList.remove('is-pulsing')
    void button.offsetWidth
    button.classList.add('is-pulsing')
    setPerformanceValidatePulse((value) => value + 1)
  }

  function stepHabitDate(direction: 'previous' | 'next') {
    const nextDate = direction === 'previous' ? previousHabitDate : nextHabitDate
    writeDebugLog('habit-date-step', { direction, from: selectedHabitDate, to: nextDate, existingOccurrence: Boolean(habitOccurrences.find((occurrence) => occurrence.date === nextDate)) })
    setSelectedHabitDate(nextDate)
  }

  function trackerHistory(itemId: string, module: ModuleKey) {
    const occurrences = module === 'habits' ? habitOccurrences : performanceOccurrences
    return occurrences
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
        date: module === 'habits' ? (occurrence.date ?? '') : occurrence.id,
        label: module === 'performances'
          ? `${new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(new Date(occurrence.createdAt))}\n${new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(occurrence.createdAt)).replace('.', '').toUpperCase()}`
          : undefined,
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
        <select
          value={entry.state === 'success' ? 'yes' : entry.state === 'failed' ? 'no' : ''}
          onChange={(event) => onPatch({ state: event.target.value === 'yes' ? 'success' : event.target.value === 'no' ? 'failed' : 'unknown' })}
        >
          <option value="">Choisir</option>
          <option value="yes">Oui</option>
          <option value="no">Non</option>
        </select>
      )
    }

    if (inputKind === 'score') {
      return (
        <select
          value={entry.score == null ? '' : String(entry.score)}
          onChange={(event) => onPatch({ score: event.target.value === '' ? null : Number(event.target.value) })}
        >
          <option value="">Choisir</option>
          {likertOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )
    }

    if (inputKind === 'checklist') {
      return renderChecklistResponseEditor(checklistTemplate, entry.checklist, (next) => onPatch({ checklist: next }))
    }

    if (inputKind === 'numeric') {
      return (
        <div className="editor-stack">
          <input
            type="number"
            value={entry.numericValue ?? ''}
            onChange={(event) => onPatch({ numericValue: event.target.value === '' ? null : Number(event.target.value) })}
            placeholder={target?.unit ? `Valeur (${target.unit})` : 'Valeur'}
          />
          {target && <span className="editor-hint">objectif : {target.value}{target.unit ? ` ${target.unit}` : ''}</span>}
        </div>
      )
    }

    return (
      <textarea value={entry.note} onChange={(event) => onPatch({ note: event.target.value })} placeholder="Note..." />
    )
  }

  function updateGoalSubEntryDraft(subItem: GoalSubItem, entry: Goal, patch: Partial<GoalSubEntry>) {
    const current = entry.subEntries[subItem.id] ?? emptySubEntry(subItem)
    const next = { ...current, ...patch }
    next.state = deriveSubState(subItem, next)
    updateGoal(entry.id, {
      subEntries: {
        ...entry.subEntries,
        [subItem.id]: next,
      },
    })
  }

  function renderGoalEditorInput(goal: Goal) {
    return (
      <div className="editor-grid compact-editor-grid">
        {renderLeafResponseEditor(goal.resultKind, goal.target, { state: goal.status, score: goal.score, checklist: goal.checklist, numericValue: goal.numericValue, note: goal.note }, goal.checklistTemplate, (patch) => updateGoal(goal.id, patch))}
        {goal.subItems.length > 0 && (
          <div className="subitem-group compact-subitem-group">
            <div className="subitem-list">
              {goal.subItems.map((subItem) => {
                const subEntry = goal.subEntries[subItem.id] ?? emptySubEntry(subItem)
                return (
                  <section key={subItem.id} className="subitem-card compact-subitem-card">
                    <div className="subitem-head compact-subitem-head">
                      <strong>{subItem.title}</strong>
                    </div>
                    {renderLeafResponseEditor(subItem.inputKind, subItem.target, subEntry, subItem.checklistTemplate, (patch) => updateGoalSubEntryDraft(subItem, goal, patch))}
                  </section>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  function openGoalEditor(goalId: string) {
    setGoalEditor({ goalId })
  }

  function closeGoalEditor() {
    setGoalEditor(null)
  }

  function renderTrackerEditorInput(item: TrackerItem) {
    const entry = trackerResponseDraft
    if (!entry) return null

    return (
      <div className="editor-grid compact-editor-grid">
        {renderLeafResponseEditor(item.inputKind, item.target, entry, item.checklistTemplate, (patch) => {
          const next = { ...entry, ...patch }
          next.state = deriveState(item, next as TrackerEntry)
          updateTrackerResponseDraft(next as TrackerEntry)
        })}
        {item.subItems.length > 0 && (
          <div className="subitem-group compact-subitem-group">
            <div className="subitem-list">
              {item.subItems.map((subItem) => {
                const subEntry = entry.subEntries[subItem.id] ?? emptySubEntry(subItem)
                return (
                  <section key={subItem.id} className="subitem-card compact-subitem-card">
                    <div className="subitem-head compact-subitem-head">
                      <strong>{subItem.title}</strong>
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





  function openTrackerModal(module: ModuleKey, item?: TrackerItem) {
    if (item) {
      setEditingTrackerId(item.id)
      setTrackerDraft(trackerDraftFromItem(item))
      setTrackerCategoryQuery(item.category ?? '')
    } else {
      const baseDraft = defaultTrackerDraft(module)
      const nextDraft = state.lastTrackerCategory
        ? { ...baseDraft, category: state.lastTrackerCategory }
        : baseDraft
      setEditingTrackerId(null)
      setTrackerDraft(nextDraft)
      setTrackerCategoryQuery(nextDraft.category)
    }

    setModalView(module)
  }

  function deleteTrackerItem(itemId: string) {
    const item = state.trackerItems.find((candidate) => candidate.id === itemId)
    if (!item) return

    patchState({
      trackerItems: state.trackerItems.filter((candidate) => candidate.id !== itemId),
      occurrences: state.occurrences.map((occurrence) => {
        if (occurrence.module !== item.module) return occurrence
        const nextEntries = { ...occurrence.entries }
        delete nextEntries[itemId]
        return {
          ...occurrence,
          entries: nextEntries,
        }
      }),
    })
    setModalView(null)
    setEditingTrackerId(null)
    writeDebugLog('tracker-item-deleted', { itemId, module: item.module, title: item.title })
  }

  function openGoalModal(weekDate?: string | null, goalToEdit?: Goal | null) {
    if (goalToEdit) {
      const draft: GoalDraft = {
        title: goalToEdit.title,
        description: goalToEdit.description,
        horizon: goalToEdit.horizon,
        dueDate: goalToEdit.dueDate,
        weekDate: goalToEdit.weekDate ?? startOfWeek(goalToEdit.dueDate),
        resultKind: goalToEdit.resultKind,
        priority: goalToEdit.priority,
        reminder: goalToEdit.reminder,
        checklistItems: [...goalToEdit.checklistTemplate],
        newChecklistItem: '',
        targetMode: goalToEdit.target?.mode ?? 'atLeast',
        targetValue: goalToEdit.target ? String(goalToEdit.target.value) : '',
        targetUnit: goalToEdit.target?.unit ?? '',
        subItems: goalToEdit.subItems.map((subItem) => ({ id: subItem.id, title: subItem.title, inputKind: subItem.inputKind, checklistItems: [...subItem.checklistTemplate], newChecklistItem: '', targetMode: subItem.target?.mode ?? 'atLeast', targetValue: subItem.target ? String(subItem.target.value) : '', targetUnit: subItem.target?.unit ?? '' })),
      }
      setEditingGoalId(goalToEdit.id)
      setGoalDraft(draft)
      setModalView('goals')
      return
    }

    const baseDate = weekDate ?? goalPeriodDate
    const horizon = weekDate ? 'week' : goalViewMode
    const normalizedWeekDate = weekDate ? startOfWeek(weekDate) : startOfWeek(baseDate)
    const dueDate = horizon === 'week'
      ? goalDueDateForHorizon('week', normalizedWeekDate)
      : horizon === 'month'
        ? monthFinalDueDate
        : yearFinalDueDate

    setGoalDraft({
      ...defaultGoalDraft(),
      horizon,
      dueDate,
      weekDate: normalizedWeekDate,
    })
    setEditingGoalId(null)
    setModalView('goals')
  }

  function openTrackerEditor(module: ModuleKey, itemId: string, occurrenceId: string, date?: string) {
    const item = state.trackerItems.find((candidate) => candidate.id === itemId)
    if (!item) return

    if (module === 'performances' && !occurrenceId) {
      const createdOccurrence = createOccurrence('performances', 'standard', state.trackerItems, state.occurrences)
      patchState({ occurrences: [...state.occurrences, createdOccurrence] })
      setPerformanceOccurrenceId(createdOccurrence.id)
      updateTrackerResponseDraft(cloneEntry(createdOccurrence.entries[itemId]))
      setTrackerEditor({ module, itemId, occurrenceId: createdOccurrence.id, date })
      writeDebugLog('performance-occurrence-created-on-open', { itemId, occurrenceId: createdOccurrence.id })
      writeDebugLog('tracker-editor-opened', { module, itemId, occurrenceId: createdOccurrence.id, date })
      return
    }

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

  function commitPerformanceIteration() {
    const baseOccurrence = selectedPerformanceOccurrence ?? createOccurrence('performances', 'standard', state.trackerItems, state.occurrences)
    const hasCurrentOccurrence = state.occurrences.some((occurrence) => occurrence.id === baseOccurrence.id)
    const occurrencesWithCurrent = hasCurrentOccurrence ? state.occurrences : [...state.occurrences, baseOccurrence]
    const hasNextOccurrence = occurrencesWithCurrent.some((occurrence) => (
      occurrence.module === 'performances' && occurrence.kind === 'standard' && occurrence.key > baseOccurrence.key
    ))

    if (hasNextOccurrence) {
      const nextExistingOccurrence = occurrencesWithCurrent
        .filter((occurrence) => occurrence.module === 'performances' && occurrence.kind === 'standard' && occurrence.key > baseOccurrence.key)
        .sort((left, right) => left.key - right.key)[0]
      if (nextExistingOccurrence) {
        setPerformanceOccurrenceId(nextExistingOccurrence.id)
      }
      writeDebugLog('performance-iteration-commit-skipped-next-exists', { occurrenceId: baseOccurrence.id, nextOccurrenceId: nextExistingOccurrence?.id })
      return
    }

    const nextOccurrence = createOccurrence('performances', 'standard', state.trackerItems, occurrencesWithCurrent)
    patchState({ occurrences: [...occurrencesWithCurrent, nextOccurrence] })
    setPerformanceOccurrenceId(nextOccurrence.id)
    writeDebugLog('performance-next-iteration-created-on-commit', { fromOccurrenceId: baseOccurrence.id, nextOccurrenceId: nextOccurrence.id })
  }

  function saveTrackerEditor() {
    const draft = trackerResponseDraftRef.current
    if (!trackerEditor || !trackerEditorItem || !trackerEditorOccurrence || !draft) return
    const result = updateTrackerEntry(trackerEditorOccurrence.id, trackerEditorItem.id, {
      state: trackerEditorItem.inputKind === 'checklist' && draft.checklist.every((value) => value === 'unknown') ? 'failed' : draft.state,
      score: draft.score,
      checklist: draft.checklist,
      numericValue: draft.numericValue,
      note: draft.note,
      subEntries: draft.subEntries,
    })
    if (result?.nextEntry?.state === 'success') {
      const streak = successStreakForOccurrence(trackerEditor.module, trackerEditor.itemId, result.occurrenceId, result.occurrences)
      setCelebration({
        itemId: trackerEditor.itemId,
        module: trackerEditor.module,
        level: celebrationLevelForStreak(streak),
        streak,
        token: Date.now(),
      })
    }

    writeDebugLog('tracker-editor-saved', { module: trackerEditor.module, itemId: trackerEditor.itemId, occurrenceId: trackerEditorOccurrence.id })
    closeTrackerEditor()
  }
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (isStandalone) {
      setInstallState('installed')
      return
    }

    const isAndroid = /android/i.test(window.navigator.userAgent)
    const isiPhone = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    if (isAndroid) {
      setInstallState('available')
    } else if (isiPhone) {
      setInstallState('manual')
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      installPromptRef.current = event as BeforeInstallPromptEvent
      setInstallState('available')
    }

    const handleInstalled = () => {
      installPromptRef.current = null
      setInstallState('installed')
      setInstallHintOpen(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    if (!isAdmin && view === 'admin') {
      setView('habits')
    }
  }, [isAdmin, view])

  useEffect(() => {
    if (!isAdmin || view !== 'admin') return

    let cancelled = false

    async function loadAdminProfiles() {
      setAdminLoading(true)
      try {
        const snapshot = await getDocs(query(collection(firebaseDb, 'userProfiles'), orderBy('updatedAt', 'desc')))
        if (cancelled) return
        setAdminProfiles(snapshot.docs.map((entry) => {
          const data = entry.data() as { email?: string; updatedAt?: { toDate?: () => Date }; createdAt?: { toDate?: () => Date } }
          return {
            id: entry.id,
            email: data.email ?? '',
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : null,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
          }
        }))
      } catch (error) {
        if (!cancelled) {
          setAuthError(error instanceof Error ? error.message : 'Impossible de charger la vue admin.')
        }
      } finally {
        if (!cancelled) setAdminLoading(false)
      }
    }

    void loadAdminProfiles()

    return () => {
      cancelled = true
    }
  }, [isAdmin, view])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthSubmitting(true)
    setAuthError('')

    try {
      if (authMode === 'register') {
        await createUserWithEmailAndPassword(firebaseAuth, authEmail.trim(), authPassword)
      } else {
        await signInWithEmailAndPassword(firebaseAuth, authEmail.trim(), authPassword)
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Authentification impossible.')
    } finally {
      setAuthSubmitting(false)
    }
  }

  async function logoutUser() {
    await signOut(firebaseAuth)
    setView('habits')
    setAdminProfiles([])
    setSheetExportError('')
  }

  function formatAdminDate(value: string | null) {
    if (!value) return 'Jamais'
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  }

  async function signInWithGoogle() {
    setAuthSubmitting(true)
    setAuthError('')

    try {
      await signInWithPopup(firebaseAuth, googleAuthProvider)
    } catch (error) {
      if (error instanceof Error && error.message.includes('auth/unauthorized-domain')) {
        setAuthError('Le domaine n est pas encore totalement autorise par Firebase. Reessaie dans quelques minutes.')
      } else if (
        error instanceof Error &&
        (error.message.includes('auth/popup-closed-by-user') || error.message.includes('auth/cancelled-popup-request'))
      ) {
        setAuthError('Connexion Google annulee.')
      } else {
        setAuthError(error instanceof Error ? error.message : 'Connexion Google impossible.')
      }
    } finally {
      setAuthSubmitting(false)
    }
  }

  async function triggerInstallApp() {
    if (installState === 'installed') return

    if (installPromptRef.current) {
      await installPromptRef.current.prompt()
      const choice = await installPromptRef.current.userChoice
      if (choice.outcome === 'accepted') {
        setInstallState('installed')
      }
      installPromptRef.current = null
      return
    }

    setInstallHintOpen((current: boolean) => !current)
  }

  async function exportGoogleSheet() {
    if (!currentUser || sheetExportLoading) return

    setSheetExportLoading(true)
    setSheetExportError('')

    try {
      const idToken = await currentUser.getIdToken(true)
      const response = await fetch('/.netlify/functions/export-google-sheet', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      })
      const payload = await response.json() as { ok?: boolean; url?: string; error?: string }

      if (!response.ok || !payload.ok || !payload.url) {
        throw new Error(payload.error || 'Export Google Sheets impossible.')
      }

      window.open(payload.url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setSheetExportError(error instanceof Error ? error.message : 'Export Google Sheets impossible.')
    } finally {
      setSheetExportLoading(false)
    }
  }

  function renderAuthScreen() {
    return (
      <main className="main minimal-main auth-main">
        <section className="panel surface-panel auth-panel">
          <div className="auth-copy">
            <span className="auth-kicker">Suivi personnel</span>
            <strong>{authMode === 'login' ? 'Retrouve ton tableau de bord.' : 'Cree ton espace de suivi.'}</strong>
            <p className="compact-description auth-description">
              Habitudes, performances et objectifs au meme endroit. Connexion simple, synchro par compte et acces admin separe.
            </p>
          </div>
          <form className="form-grid compact-form" onSubmit={submitAuth}>
            <div className="field auth-field">
              <span>Adresse email</span>
              <input type="email" required value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="ton@email.com" />
            </div>
            <div className="field auth-field">
              <span>Mot de passe</span>
              <input type="password" required minLength={6} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Minimum 6 caracteres" />
            </div>
            {authError && <p className="muted-inline">{authError}</p>}
            <button type="submit" disabled={authSubmitting}>
              {authSubmitting ? 'Chargement...' : authMode === 'login' ? 'Se connecter' : 'Creer le compte'}
            </button>
            <button type="button" className="auth-google-button" onClick={() => void signInWithGoogle()} disabled={authSubmitting}>
              <span className="auth-google-mark" aria-hidden="true">G</span>
              <span>Continuer avec Google</span>
            </button>
            <div className="auth-divider" aria-hidden="true">
              <span>ou</span>
            </div>
            <button type="button" className="ghost-button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? 'Creer un compte avec email' : 'J ai deja un compte'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  function renderAdminView() {
    return (
      <section className="panel surface-panel">
        <div className="surface-head">
          <strong>Admin</strong>
          <span className="muted-inline">{adminProfiles.length} compte(s)</span>
        </div>
        <div className="goal-list">
          {adminLoading && <article className="empty-panel"><p>Chargement des comptes...</p></article>}
          {!adminLoading && adminProfiles.length === 0 && (
            <article className="empty-panel">
              <h3>Aucun compte</h3>
              <p>Les utilisateurs apparaitront ici apres leur premiere connexion.</p>
            </article>
          )}
          {adminProfiles.map((profile) => (
            <article key={profile.id} className="goal-card">
              <div className="goal-head">
                <div>
                  <strong>{profile.email || profile.id}</strong>
                  <div className="tracker-meta">
                    <span className="ghost-pill">UID {profile.id}</span>
                  </div>
                </div>
              </div>
              <p className="muted-inline">Derniere synchronisation : {formatAdminDate(profile.updatedAt)}</p>
              <p className="muted-inline">Creation : {formatAdminDate(profile.createdAt)}</p>
            </article>
          ))}
        </div>
      </section>
    )
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
            <input type="number" value={subItem.targetValue} onChange={(event) => patchSubItemDraft(subItem.id, { targetValue: event.target.value })} placeholder="0" />
            <input value={subItem.targetUnit} onChange={(event) => patchSubItemDraft(subItem.id, { targetUnit: event.target.value })} placeholder="Unite" />
          </>
        )}
      </section>
    )
  }


  if (!authReady) {
    return (
      <div className="shell minimal-shell">
        <main className="main minimal-main auth-main">
          <section className="panel surface-panel auth-panel">
            <p>Connexion au compte...</p>
          </section>
        </main>
      </div>
    )
  }

  if (!currentUser) {
    return <div className="shell minimal-shell">{renderAuthScreen()}</div>
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
          {isAdmin && <button type="button" className={`nav-link ${view === 'admin' ? 'active' : ''}`} onClick={() => { setView('admin'); setSidebarOpen(false) }}>Admin</button>}
        </nav>
        <div className="sidebar-foot">
          {installState !== 'hidden' && (
            <div className="install-app-block">
              <button type="button" className="ghost-button install-app-button" onClick={() => void triggerInstallApp()}>
                {installState === 'installed' ? 'App installee' : 'Ajouter a l ecran d accueil'}
              </button>
              {installHintOpen && installState === 'manual' && (
                <p className="muted-inline install-app-hint">Android : menu du navigateur puis Installer l application ou Ajouter a l ecran d accueil. iPhone : partage Safari puis Ajouter a l ecran d accueil.</p>
              )}
            </div>
          )}
          <button type="button" className="ghost-button export-sheet-button" onClick={() => void exportGoogleSheet()} disabled={sheetExportLoading}>
            {sheetExportLoading ? 'Ouverture...' : 'Google Sheets'}
          </button>
          <span className="muted-inline">{currentUser.email}</span>
          <button type="button" className="ghost-button" onClick={logoutUser}>Se deconnecter</button>
        </div>
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

        {sheetExportError && (
          <section className="panel surface-panel inline-feedback-panel">
            <p className="muted-inline">{sheetExportError}</p>
          </section>
        )}

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
              {visibleHabitItems.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucune habitude</h3>
                  <p>Ajoute seulement tes propres consignes.</p>
                </article>
              )}

              {visibleHabitItems.length > 0 && (() => {
                const grouped = visibleHabitItems.reduce<Record<string, TrackerItem[]>>((acc, item) => {
                  const key = (item.category || '').trim() || 'Autres'
                  if (!acc[key]) acc[key] = []
                  acc[key].push(item)
                  return acc
                }, {})
                const categoryNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }))

                return categoryNames.map((category) => (
                  <section key={category} className="tracker-category-section">
                    <header className="tracker-category-head">
                      <span className="tracker-category-label">{category}</span>
                    </header>
                    <div className="tracker-category-list">
                      {grouped[category].map((item) => {
                        const isCelebrating = celebration?.module === 'habits' && celebration.itemId === item.id
                        return (
                          <article key={item.id} className={`tracker-card ${isCelebrating ? `is-celebrating celebration-level-${celebration.level}` : ''}`}>
                            {isCelebrating && (
                              <div key={celebration.token} className="dopamine-burst" aria-hidden="true">
                                {celebrationGlyphsForLevel(celebration.level).map((glyph, index) => (
                                  <span key={`${glyph}-${index}`}>{glyph}</span>
                                ))}
                              </div>
                            )}
                            <div className="tracker-head">
                              <button
                                type="button"
                                className="tracker-open"
                                onClick={() => openTrackerEditor('habits', item.id, resolvedHabitOccurrence.id, resolvedHabitOccurrence.date ?? undefined)}
                                aria-label={`Renseigner ${item.title}`}
                              >
                                <div className="tracker-open-copy compact-tracker-open-copy">
                                  <strong className={`tracker-title state-text-${resolvedHabitOccurrence.entries[item.id]?.state ?? 'unknown'}`}>{item.title}</strong>
                                </div>
                              </button>
                              <div className="tracker-card-actions">
                                <div className="tracker-menu-wrap">
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
                            </div>

                            <div className="history-row">
                              <HistoryCarousel
                                items={trackerHistory(item.id, 'habits')}
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
                        )
                      })}
                    </div>
                  </section>
                ))
              })()}
            </div>

            {habitRestItems.length > 0 && (
              <div className="global-rest-note rest-note-trailing">
                <span className="global-rest-note-label">En pause apres reussite :</span>
                <span>{habitRestItems.map((item) => item.title).join(' · ')}</span>
              </div>
            )}
          </section>
        )}

        {view === 'performances' && (
          <section className="panel surface-panel">
            <div className="surface-head">
              <div className="surface-actions">
                {performanceCategories.length > 0 && (
                  <div className="category-pill-filter">
                    {performanceCategories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`ghost-button category-pill ${effectivePerformanceFilter === category ? 'active' : ''}`}
                        onClick={() => {
                          const next = effectivePerformanceFilter === category ? '' : category
                          setPerformanceCategoryFilter(next)
                          patchState({ lastPerformanceCategoryFilter: next })
                        }}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="fab-button" aria-label="Ajouter une performance" onClick={() => openTrackerModal('performances')}>+</button>
            </div>

            <div className="tracker-list">
              {visiblePerformanceItems.length === 0 && (
                <article className="empty-panel">
                  <h3>Aucune performance</h3>
                  <p>Ajoute tes axes de progression avant de lancer une iteration.</p>
                </article>
              )}
              {visiblePerformanceItems.map((item) => {
                const isCelebrating = celebration?.module === 'performances' && celebration.itemId === item.id
                const performanceEntry = resolvedPerformanceOccurrence.entries[item.id] ?? emptyEntry(item)
                return (
                <article key={item.id} className={`tracker-card ${isCelebrating ? `is-celebrating celebration-level-${celebration.level}` : ''}`}>
                  {isCelebrating && (
                    <div key={celebration.token} className="dopamine-burst" aria-hidden="true">
                      {celebrationGlyphsForLevel(celebration.level).map((glyph, index) => (
                        <span key={`${glyph}-${index}`}>{glyph}</span>
                      ))}
                    </div>
                  )}
                  <div className="tracker-head">
                    <button
                      type="button"
                      className="tracker-open"
                      onClick={() => openTrackerEditor('performances', item.id, selectedPerformanceOccurrence?.id ?? '')}
                      aria-label={`Renseigner ${item.title}`}
                    >
                      <div className="tracker-open-copy">
                        <strong className={`tracker-title performance-title state-text-${performanceEntry.state}`}>{item.title}</strong>
                        {entryLabelForInput(item.inputKind, performanceEntry.state, performanceEntry.score) && (
                          <div className="tracker-meta">
                            <span className={`pill ${stateClassName(performanceEntry.state)}`}>{entryLabelForInput(item.inputKind, performanceEntry.state, performanceEntry.score)}</span>
                          </div>
                        )}
                      </div>
                    </button>
                    <div className="tracker-card-actions">
                      <div className="tracker-menu-wrap">
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
                  </div>
                  {item.description && <p className="compact-description">{item.description}</p>}

                  <div className="history-row">
                    <HistoryCarousel
                      items={trackerHistory(item.id, 'performances')}
                      selectedDate={resolvedPerformanceOccurrence.id}
                      onSelect={(occurrenceId) => {
                        const occurrence = performanceOccurrences.find((candidate) => candidate.id === occurrenceId)
                        writeDebugLog('performance-history-select', { from: resolvedPerformanceOccurrence.id, to: occurrenceId, occurrenceId: occurrence?.id })
                        if (occurrence) {
                          setPerformanceOccurrenceId(occurrence.id)
                          openTrackerEditor('performances', item.id, occurrence.id)
                        }
                      }}
                    />
                  </div>
                </article>
              )})}
            </div>
            {performanceItems.length > 0 && (
              <div className="performance-footer-actions-wrap">
                <div className="performance-footer-actions">
                  <button type="button" className={`primary-button performance-validate-button ${performanceValidatePulse ? "pulse-ready" : ""}`} onClick={(event) => { pulsePerformanceValidation(event); commitPerformanceIteration() }}>Valider</button>
                </div>
                {performanceRestItems.length > 0 && (
                  <div className="global-rest-note align-center">
                    <span className="global-rest-note-label">En pause apres reussite :</span>
                    <span>{performanceRestItems.map((item) => item.title).join(' · ')}</span>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {view === 'admin' && isAdmin && renderAdminView()}

        {view === 'goals' && (
          <section className="panel surface-panel">
            <div className="surface-head goal-surface-head">
              <div className="goal-period-controls">
                <div className="goal-view-toggle">
                  <button type="button" className={`ghost-button ${goalViewMode === 'month' ? 'active' : ''}`} onClick={() => setGoalViewMode('month')}>Mois</button>
                  <button type="button" className={`ghost-button ${goalViewMode === 'year' ? 'active' : ''}`} onClick={() => setGoalViewMode('year')}>Année</button>
                </div>
                <div className="date-nav-controls">
                  <button type="button" className="date-arrow" onClick={() => setGoalPeriodDate(goalViewMode === 'month' ? shiftMonth(goalPeriodDate, -1) : shiftYear(goalPeriodDate, -1))} aria-label="Periode precedente">‹</button>
                  <strong className="date-nav-label">{goalViewMode === 'month' ? monthLabel(goalPeriodDate) : yearLabel(goalPeriodDate)}</strong>
                  <button type="button" className="date-arrow" onClick={() => setGoalPeriodDate(goalViewMode === 'month' ? shiftMonth(goalPeriodDate, 1) : shiftYear(goalPeriodDate, 1))} aria-label="Periode suivante">›</button>
                </div>
              </div>
              <button type="button" className="fab-button" aria-label="Ajouter un objectif" onClick={() => openGoalModal(null, null)}>+</button>
            </div>

            {goalViewMode === 'month' ? (
              <div className="goal-month-layout minimal-goal-layout">
                {monthLevelGoals.length > 0 && (
                  <div className="goal-list">
                    {monthLevelGoals.map((goal) => (
                      <article key={goal.id} className={`goal-card horizon-${goal.horizon} tone-${goalStatusTone(goal)}`}>
                        <div className="goal-head">
                          <button type="button" className="tracker-open goal-open" onClick={() => openGoalEditor(goal.id)} aria-label={`Renseigner ${goal.title}`}>
                            <div className="tracker-open-copy compact-tracker-open-copy">
                              <strong>{goal.title}</strong>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="ghost-icon tracker-menu-button"
                            aria-label={`Modifier ${goal.title}`}
                            onClick={() => openGoalModal(null, goal)}
                          >
                            ⋮
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                <div className="goal-week-sections minimal-week-sections">
                  {monthWeeks.map((week) => {
                    const weekGoals = visibleGoals.filter((goal) => goal.weekDate === week.start)
                    return (
                      <section key={week.start} className="goal-week-block minimal-week-block" onClick={() => weekGoals.length === 0 ? openGoalModal(week.start) : undefined}>
                        <div className="goal-week-head minimal-week-head">
                          <strong>{week.label}</strong>
                        </div>
                        {weekGoals.length === 0 && (
                          <div className="goal-empty-state">
                            <span>Aucun objectif cette semaine</span>
                            <small>Ajoute ton premier objectif</small>
                          </div>
                        )}
                        {weekGoals.length > 0 && (
                          <div className="goal-list compact-goal-list">
                            {weekGoals.map((goal) => (
                              <article key={goal.id} className={`goal-card horizon-${goal.horizon} compact-goal-card tone-${goalStatusTone(goal)}`}>
                                <div className="goal-head compact-goal-head">
                                  <button type="button" className="tracker-open goal-open" onClick={(event) => { event.stopPropagation(); openGoalEditor(goal.id) }} aria-label={`Renseigner ${goal.title}`}>
                                    <div className="tracker-open-copy compact-tracker-open-copy">
                                      <strong>{goal.title}</strong>
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-icon tracker-menu-button"
                                    aria-label={`Modifier ${goal.title}`}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      openGoalModal(week.start, goal)
                                    }}
                                  >
                                    ⋮
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="goal-year-layout minimal-goal-layout">
                {visibleGoals.filter((goal) => goal.horizon === 'year').map((goal) => (
                  <article key={goal.id} className={`goal-card horizon-${goal.horizon} tone-${goalStatusTone(goal)}`}>
                    <div className="goal-head">
                      <button type="button" className="tracker-open goal-open" onClick={() => openGoalEditor(goal.id)} aria-label={`Renseigner ${goal.title}`}>
                        <div className="tracker-open-copy compact-tracker-open-copy">
                          <strong>{goal.title}</strong>
                        </div>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {goalEditor && goalEditorItem && (
          <div className="modal-backdrop" role="presentation" onClick={closeGoalEditor}>
            <div className="modal-card tracker-editor-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h3>{goalEditorItem.title}</h3>
                  <div className="editor-context editor-context-minimal">
                    <span className="ghost-pill">{goalEditorItem.horizon === 'week' ? 'Objectif de semaine' : goalEditorItem.horizon === 'month' ? 'Objectif du mois' : 'Objectif de l annee'}</span>
                  </div>
                </div>
                <button type="button" className="ghost-icon" aria-label="Fermer" onClick={closeGoalEditor}>×</button>
              </div>
              <div className="tracker-editor-body">
                {renderGoalEditorInput(goalEditorItem)}
                <div className="editor-actions-row">
                  <div className="editor-actions">
                    <button type="button" className="primary-button" onClick={closeGoalEditor}>Valider</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {trackerEditor && trackerEditorItem && trackerEditorOccurrence && (
          <div className="modal-backdrop" role="presentation" onClick={closeTrackerEditor}>
            <div className="modal-card tracker-editor-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <div>
                  <h3>{trackerEditorItem.title}</h3>
                  <div className="editor-context editor-context-minimal">
                    <span className="ghost-pill">{trackerEditor.module === 'habits' ? formatLongDate(trackerEditor.date) : trackerEditorOccurrence.label}</span>
                  </div>
                </div>
                <button type="button" className="ghost-icon" aria-label="Fermer" onClick={closeTrackerEditor}>×</button>
              </div>
              <div className="tracker-editor-body">
                {renderTrackerEditorInput(trackerEditorItem)}
                <div className="editor-actions-row">
                  <div className="rest-quick-control">
                    <span className="editor-hint">Repos auto</span>
                    <input
                      type="number"
                      min="0"
                      value={trackerEditorItem.restAfterSuccess === 0 ? '' : String(trackerEditorItem.restAfterSuccess)}
                      placeholder="0"
                      onChange={(event) => {
                        const rawValue = event.target.value
                        patchState({
                          trackerItems: state.trackerItems.map((candidate) => (
                            candidate.id === trackerEditorItem.id
                              ? { ...candidate, restAfterSuccess: rawValue === '' ? 0 : Number(rawValue) }
                              : candidate
                          )),
                        })
                      }}
                    />
                  </div>
                  <div className="editor-actions">
                    <button type="button" className="primary-button" onClick={saveTrackerEditor}>Valider</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {celebration && (
        <div className={`celebration-toast celebration-level-${celebration.level}`} aria-live="polite">
          <div className="celebration-toast-glyphs" aria-hidden="true">
            {celebrationGlyphsForLevel(celebration.level).map((glyph, index) => (
              <span key={`${glyph}-${index}`}>{glyph}</span>
            ))}
          </div>
          <strong>{celebrationMessageForStreak(celebration.streak)}</strong>
        </div>
      )}

      {modalView && (
          <div className="modal-backdrop" role="presentation" onClick={() => { setModalView(null); setEditingTrackerId(null); setEditingGoalId(null) }}>
            <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="modal-head">
                <h3>{modalView === 'goals' ? editingGoalId ? 'Modifier l objectif' : 'Ajouter un objectif' : editingTrackerId ? 'Modifier la consigne' : modalView === 'habits' ? 'Ajouter une habitude' : 'Ajouter une performance'}</h3>
                <button type="button" className="ghost-icon" aria-label="Fermer" onClick={() => { setModalView(null); setEditingTrackerId(null); setEditingGoalId(null) }}>×</button>
              </div>

              {modalView === 'goals' ? (
                <form className="form-grid compact-form" onSubmit={addGoal}>
                  <input required value={goalDraft.title} onChange={(event) => setGoalDraft({ ...goalDraft, title: event.target.value })} placeholder="Titre" />
                  <select value={goalDraft.horizon} onChange={(event) => {
                    const nextHorizon = event.target.value as GoalHorizon
                    const anchorDate = nextHorizon === 'week' ? goalDraft.weekDate : goalPeriodDate
                    setGoalDraft({
                      ...goalDraft,
                      horizon: nextHorizon,
                      dueDate: goalDueDateForHorizon(nextHorizon, anchorDate, monthWeeks),
                    })
                  }}>
                    <option value="week">Objectif de semaine</option>
                    <option value="month">Objectif du mois</option>
                    <option value="year">Objectif de l annee</option>
                  </select>
                  <input
                    type="date"
                    value={goalDraft.dueDate}
                    onChange={(event) => setGoalDraft({
                      ...goalDraft,
                      dueDate: event.target.value,
                      weekDate: goalDraft.horizon === 'week' ? startOfWeek(event.target.value) : goalDraft.weekDate,
                    })}
                  />
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
                      <input type="number" value={goalDraft.targetValue} onChange={(event) => setGoalDraft({ ...goalDraft, targetValue: event.target.value })} placeholder="0" />
                      <input value={goalDraft.targetUnit} onChange={(event) => setGoalDraft({ ...goalDraft, targetUnit: event.target.value })} placeholder="Unite" />
                    </>
                  )}
                  <div className="subitem-group compact-subitem-group">
                    <div className="subitem-group-head">
                      <strong>Sous-objectifs</strong>
                      <button type="button" className="ghost-button compact-action" onClick={() => setGoalDraft({ ...goalDraft, subItems: [...goalDraft.subItems, defaultSubDraft()] })}>Ajouter un sous-objectif</button>
                    </div>
                    {goalDraft.subItems.map((subItem) => (
                      <section key={subItem.id} className="subitem-card compact-subitem-card">
                        <div className="subitem-head compact-subitem-head">
                          <strong>Sous-objectif</strong>
                          <button type="button" className="ghost-button compact-action compact-icon-action" onClick={() => setGoalDraft({ ...goalDraft, subItems: goalDraft.subItems.filter((candidate) => candidate.id !== subItem.id) })}>×</button>
                        </div>
                        <input value={subItem.title} onChange={(event) => setGoalDraft({ ...goalDraft, subItems: goalDraft.subItems.map((candidate) => candidate.id === subItem.id ? { ...candidate, title: event.target.value } : candidate) })} placeholder="Titre du sous-objectif" />
                        <select value={subItem.inputKind} onChange={(event) => setGoalDraft({ ...goalDraft, subItems: goalDraft.subItems.map((candidate) => candidate.id === subItem.id ? { ...candidate, inputKind: event.target.value as InputKind } : candidate) })}>
                          <option value="tristate">Oui / Non</option>
                          <option value="score">Echelle qualitative</option>
                          <option value="checklist">Checklist</option>
                          <option value="numeric">Valeur chiffree</option>
                          <option value="note">Note libre</option>
                        </select>
                      </section>
                    ))}
                  </div>
                  <button type="submit">{editingGoalId ? 'Enregistrer' : 'Ajouter'}</button>
                </form>
              ) : (
                <form className="form-grid compact-form" onSubmit={saveTrackerItem}>
                  <input required value={trackerDraft.title} onChange={(event) => setTrackerDraft({ ...trackerDraft, title: event.target.value, module: modalView })} placeholder="Titre" />
                  <div className="field">
                    <span>Catégorie</span>
                    <div className="category-input-wrap">
                      <input
                        value={trackerDraft.category}
                        onChange={(event) => {
                          const value = event.target.value
                          setTrackerDraft({ ...trackerDraft, category: value, module: modalView })
                          setTrackerCategoryQuery(value)
                        }}
                        onFocus={() => setTrackerCategoryFocused(true)}
                        onBlur={() => setTrackerCategoryFocused(false)}
                        placeholder="ex : Sante, Travail..."
                      />
                      {trackerCategoryFocused && trackerCategoryQuery.trim() && allCategories.length > 0 && (
                        <div className="category-suggestion-list">
                          {allCategories
                            .filter((category) => category.toLowerCase().includes(trackerCategoryQuery.trim().toLowerCase()))
                            .slice(0, 5)
                            .map((category) => (
                              <button
                                key={category}
                                type="button"
                                className="category-suggestion-item"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setTrackerDraft({ ...trackerDraft, category, module: modalView })
                                  setTrackerCategoryQuery(category)
                                  setTrackerCategoryFocused(false)
                                }}
                              >
                                {category}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
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
                        onChange={(event) => setTrackerDraft({ ...trackerDraft, restAfterSuccess: event.target.value, module: modalView })}
                        placeholder="0"
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
                      <input type="number" value={trackerDraft.targetValue} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetValue: event.target.value, module: modalView })} placeholder="0" />
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
                  <div className="editor-actions-row">
                    {editingTrackerId ? (
                      <button type="button" className="ghost-button danger" onClick={() => deleteTrackerItem(editingTrackerId)}>Supprimer la consigne</button>
                    ) : <span />}
                    <button type="submit">{editingTrackerId ? 'Enregistrer' : 'Ajouter'}</button>
                  </div>
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
