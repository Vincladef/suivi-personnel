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

const storageKey = 'application-de-suivi-v1'
const today = '2026-03-21'
const todayDate = new Date(`${today}T00:00:00`)

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

const seedTrackerItems: TrackerItem[] = [
  {
    id: 'habit-mobility',
    module: 'habits',
    title: 'Mobilite du matin',
    description: '10 minutes de mobilisation articulaire pour lancer la journee.',
    inputKind: 'tristate',
    priority: 'high',
    checklistTemplate: [],
    target: null,
    frequency: { kind: 'weekdays', days: [1, 2, 3, 4, 5] },
    restAfterSuccess: 0,
  },
  {
    id: 'habit-energy',
    module: 'habits',
    title: 'Niveau d energie',
    description: 'Auto-evaluation rapide de la qualite de la journee sur 5 niveaux.',
    inputKind: 'score',
    priority: 'medium',
    checklistTemplate: [],
    target: null,
    frequency: { kind: 'daily', days: [] },
    restAfterSuccess: 0,
  },
  {
    id: 'habit-routine',
    module: 'habits',
    title: 'Routine du soir',
    description: 'Checklist courte pour fermer proprement la journee.',
    inputKind: 'checklist',
    priority: 'high',
    checklistTemplate: ['Inbox videe', 'Agenda demain verifie', 'Lecture 10 min'],
    target: null,
    frequency: { kind: 'daily', days: [] },
    restAfterSuccess: 1,
  },
  {
    id: 'habit-water',
    module: 'habits',
    title: 'Hydratation',
    description: 'Mesurer les litres bus dans la journee avec une cible minimale.',
    inputKind: 'numeric',
    priority: 'medium',
    checklistTemplate: [],
    target: { mode: 'atLeast', value: 2, unit: 'L' },
    frequency: { kind: 'daily', days: [] },
    restAfterSuccess: 0,
  },
  {
    id: 'habit-journal',
    module: 'habits',
    title: 'Journal libre',
    description: 'Prendre une note libre sur les apprentissages du jour.',
    inputKind: 'note',
    priority: 'low',
    checklistTemplate: [],
    target: null,
    frequency: { kind: 'selected', days: [0, 6] },
    restAfterSuccess: 0,
  },
  {
    id: 'perf-dead-hang',
    module: 'performances',
    title: 'Dead hang',
    description: 'Tenir le plus longtemps possible a la barre.',
    inputKind: 'numeric',
    priority: 'high',
    checklistTemplate: [],
    target: { mode: 'atLeast', value: 60, unit: 'sec' },
    frequency: null,
    restAfterSuccess: 1,
  },
  {
    id: 'perf-breathing',
    module: 'performances',
    title: 'Technique de respiration',
    description: 'Noter la qualite d execution de la session.',
    inputKind: 'score',
    priority: 'medium',
    checklistTemplate: [],
    target: null,
    frequency: null,
    restAfterSuccess: 0,
  },
  {
    id: 'perf-outreach',
    module: 'performances',
    title: 'Session outreach',
    description: 'Checklist de repetition pour une session de prospection propre.',
    inputKind: 'checklist',
    priority: 'medium',
    checklistTemplate: ['Angle choisi', 'Liste nettoyee', 'Relances programmees'],
    target: null,
    frequency: null,
    restAfterSuccess: 0,
  },
  {
    id: 'perf-review',
    module: 'performances',
    title: 'Debrief de session',
    description: 'Note libre sur ce qui a bien / mal fonctionne.',
    inputKind: 'note',
    priority: 'low',
    checklistTemplate: [],
    target: null,
    frequency: null,
    restAfterSuccess: 0,
  },
]

const seedGoals: Goal[] = [
  {
    id: 'goal-week',
    title: 'Reprendre un rythme de sport stable',
    description: 'Faire 3 sessions cette semaine avec retour au calme propre.',
    horizon: 'week',
    dueDate: '2026-03-23',
    resultKind: 'checklist',
    priority: 'high',
    reminder: true,
    checklistTemplate: ['Session 1', 'Session 2', 'Session 3'],
    target: null,
    status: 'unknown',
    score: null,
    checklist: [true, false, false],
    numericValue: null,
    note: '',
  },
  {
    id: 'goal-month',
    title: 'Stabiliser les routines du matin',
    description: 'Avoir un mois propre et repetable sur le lever / mobilite / focus.',
    horizon: 'month',
    dueDate: '2026-03-31',
    resultKind: 'score',
    priority: 'high',
    reminder: true,
    checklistTemplate: [],
    target: null,
    status: 'unknown',
    score: 2,
    checklist: [],
    numericValue: null,
    note: '',
  },
  {
    id: 'goal-quarter',
    title: 'Atteindre 10 traction strictes',
    description: 'Objectif trimestriel de progression mesurable.',
    horizon: 'quarter',
    dueDate: '2026-06-30',
    resultKind: 'numeric',
    priority: 'medium',
    reminder: false,
    checklistTemplate: [],
    target: { mode: 'atLeast', value: 10, unit: 'reps' },
    status: 'unknown',
    score: null,
    checklist: [],
    numericValue: 6,
    note: '',
  },
  {
    id: 'goal-life',
    title: 'Construire un systeme personnel solide',
    description: 'Avoir un environnement de pilotage simple, durable et utile.',
    horizon: 'life',
    dueDate: '2026-12-31',
    resultKind: 'note',
    priority: 'low',
    reminder: false,
    checklistTemplate: [],
    target: null,
    status: 'unknown',
    score: null,
    checklist: [],
    numericValue: null,
    note: 'Le produit lui-meme devient une partie de cet objectif.',
  },
]

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
        ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${occurrenceDate}T12:00:00`))
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
  const state: AppState = { trackerItems: seedTrackerItems, occurrences: [], goals: seedGoals }
  state.occurrences.push(createOccurrence('habits', 'standard', state.trackerItems, state.occurrences))
  state.occurrences.push(createOccurrence('habits', 'review', state.trackerItems, state.occurrences))
  state.occurrences.push(createOccurrence('performances', 'standard', state.trackerItems, state.occurrences))
  state.occurrences.push(createOccurrence('performances', 'review', state.trackerItems, state.occurrences))
  return state
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

function daysUntil(target: string) {
  return daysBetween(today, target)
}

function goalUrgency(goal: Goal) {
  const delta = daysUntil(goal.dueDate)

  if (delta < 0) {
    return { tone: 'overdue', label: `En retard de ${Math.abs(delta)} jour(s)` }
  }

  if (delta === 0) {
    return { tone: 'today', label: "A traiter aujourd'hui" }
  }

  if (delta <= 3) {
    return { tone: 'soon', label: `Echeance dans ${delta} jour(s)` }
  }

  return { tone: 'scheduled', label: `Planifie dans ${delta} jour(s)` }
}

function goalProgressLabel(goal: Goal) {
  if (goal.resultKind === 'checklist') {
    const done = goal.checklist.filter(Boolean).length
    return `${done}/${goal.checklist.length} jalons`
  }

  if (goal.resultKind === 'score') {
    return `${goal.score ?? 0}/4`
  }

  if (goal.resultKind === 'numeric') {
    return goal.numericValue != null ? `${goal.numericValue} ${goal.target?.unit ?? ''}`.trim() : 'Non renseigne'
  }

  if (goal.resultKind === 'note') {
    return goal.note.trim() ? 'Note renseignee' : 'Note vide'
  }

  return entryLabel(goal.status)
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

function App() {
  const [view, setView] = useState<ViewKey>('overview')
  const [state, setState] = useState<AppState>(() => loadState())
  const [habitPriorityFilter, setHabitPriorityFilter] = useState<'all' | Priority>('all')
  const [performancePriorityFilter, setPerformancePriorityFilter] = useState<'all' | Priority>('all')
  const [goalView, setGoalView] = useState<'week' | 'month' | 'year' | 'all'>('all')
  const [showHabitDetails, setShowHabitDetails] = useState(true)
  const [showPerformanceDetails, setShowPerformanceDetails] = useState(true)
  const [hideRestingPerformances, setHideRestingPerformances] = useState(false)
  const [habitOccurrenceId, setHabitOccurrenceId] = useState('')
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

  useEffect(() => {
    const habitCurrent = state.occurrences
      .filter((occurrence) => occurrence.module === 'habits')
      .sort((left, right) => right.key - left.key)[0]
    const performanceCurrent = state.occurrences
      .filter((occurrence) => occurrence.module === 'performances')
      .sort((left, right) => right.key - left.key)[0]

    if (!habitOccurrenceId && habitCurrent) {
      setHabitOccurrenceId(habitCurrent.id)
    }
    if (!performanceOccurrenceId && performanceCurrent) {
      setPerformanceOccurrenceId(performanceCurrent.id)
    }
  }, [state.occurrences, habitOccurrenceId, performanceOccurrenceId])

  const habitItems = state.trackerItems.filter((item) => item.module === 'habits')
  const performanceItems = state.trackerItems.filter((item) => item.module === 'performances')
  const habitOccurrences = state.occurrences
    .filter((occurrence) => occurrence.module === 'habits')
    .sort((left, right) => right.key - left.key)
  const performanceOccurrences = state.occurrences
    .filter((occurrence) => occurrence.module === 'performances')
    .sort((left, right) => right.key - left.key)
  const selectedHabitOccurrence = habitOccurrences.find((occurrence) => occurrence.id === habitOccurrenceId) ?? habitOccurrences[0]
  const selectedPerformanceOccurrence = performanceOccurrences.find((occurrence) => occurrence.id === performanceOccurrenceId) ?? performanceOccurrences[0]

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

  const activeHabitsToday = selectedHabitOccurrence
    ? habitItems.filter((item) => selectedHabitOccurrence.entries[item.id]?.state !== 'inactive')
    : []
  const restingHabitsToday = selectedHabitOccurrence
    ? habitItems.filter((item) => selectedHabitOccurrence.entries[item.id]?.state === 'rest')
    : []
  const activePerformancesNow = selectedPerformanceOccurrence
    ? performanceItems.filter((item) => selectedPerformanceOccurrence.entries[item.id]?.state !== 'rest')
    : []

  const dueTodayGoals = sortedGoals.filter((goal) => goal.reminder && goal.dueDate === today)
  const overdueGoals = sortedGoals.filter((goal) => goal.reminder && daysUntil(goal.dueDate) < 0)
  const dueSoonGoals = sortedGoals.filter((goal) => goal.reminder && daysUntil(goal.dueDate) >= 0 && daysUntil(goal.dueDate) <= 3)
  const completedGoals = sortedGoals.filter((goal) => goalState(goal) === 'success').length
  const completionRatio = sortedGoals.length > 0 ? Math.round((completedGoals / sortedGoals.length) * 100) : 0

  const actionQueue = [
    ...activeHabitsToday
      .filter((item) => item.priority === 'high')
      .slice(0, 3)
      .map((item) => `Habitude prioritaire · ${item.title}`),
    ...activePerformancesNow
      .filter((item) => item.priority === 'high')
      .slice(0, 3)
      .map((item) => `Performance cle · ${item.title}`),
    ...sortGoals(
      sortedGoals.filter((goal) => {
        const urgency = daysUntil(goal.dueDate)
        return goal.priority === 'high' && urgency <= 3
      }),
    )
      .slice(0, 4)
      .map((goal) => `Objectif ${goalUrgency(goal).label.toLowerCase()} · ${goal.title}`),
  ]

  const overviewMetrics = [
    { label: 'Habitudes actives', value: String(activeHabitsToday.length), hint: `${restingHabitsToday.length} en repos` },
    { label: 'Performances actives', value: String(activePerformancesNow.length), hint: `${performanceItems.length} suivis total` },
    { label: 'Objectifs prioritaires', value: String(sortedGoals.filter((goal) => goal.priority === 'high').length), hint: `${dueTodayGoals.length} rappels aujourd'hui` },
    { label: 'Bilans disponibles', value: String(state.occurrences.filter((occurrence) => occurrence.kind === 'review').length), hint: 'moments de synthese distincts' },
    { label: 'Objectifs completes', value: `${completionRatio}%`, hint: `${completedGoals}/${sortedGoals.length} boucles` },
    { label: 'Alertes echeance', value: String(overdueGoals.length + dueSoonGoals.length), hint: `${overdueGoals.length} retard · ${dueSoonGoals.length} a anticiper` },
  ]

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
    if (module === 'habits') {
      setHabitOccurrenceId(occurrence.id)
    } else {
      setPerformanceOccurrenceId(occurrence.id)
    }
    setAdminMessage(`${kind === 'review' ? 'Bilan' : module === 'habits' ? 'Nouveau jour' : 'Nouvelle iteration'} cree.`)
  }

  function updateTrackerEntry(occurrenceId: string, itemId: string, patch: Partial<TrackerEntry>) {
    patchState({
      occurrences: state.occurrences.map((occurrence) => {
        if (occurrence.id !== occurrenceId) {
          return occurrence
        }

        const item = state.trackerItems.find((candidate) => candidate.id === itemId)!
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

  function prepareDay() {
    setReminderPreview(
      actionQueue.length > 0
        ? actionQueue
        : ['File active vide. Le systeme est a jour pour le moment.'],
    )
    setAdminMessage('File active preparee.')
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
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">🌀</div>
          <div>
            <h1>Application de suivi</h1>
            <p>Habitudes, performances, objectifs</p>
          </div>
        </div>

        <nav className="nav">
          <button type="button" className={`nav-link ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
          <button type="button" className={`nav-link ${view === 'habits' ? 'active' : ''}`} onClick={() => { setView('habits'); setTrackerDraft(defaultTrackerDraft('habits')) }}>Habitudes</button>
          <button type="button" className={`nav-link ${view === 'performances' ? 'active' : ''}`} onClick={() => { setView('performances'); setTrackerDraft(defaultTrackerDraft('performances')) }}>Performances</button>
          <button type="button" className={`nav-link ${view === 'goals' ? 'active' : ''}`} onClick={() => setView('goals')}>Objectifs</button>
        </nav>

        <div className="sidebar-card">
          <span className="eyebrow">Etat</span>
          <strong>{state.trackerItems.length} suivis actifs</strong>
          <p>{state.goals.length} objectifs geres. Systeme local-first avec export JSON.</p>
        </div>

        <div className="sidebar-card sidebar-card-warm">
          <span className="eyebrow">Administration</span>
          <p>{adminMessage}</p>
          <div className="sidebar-actions">
            <button type="button" className="ghost-button" onClick={() => recalcModule('habits')}>Sync habitudes</button>
            <button type="button" className="ghost-button" onClick={() => recalcModule('performances')}>Sync performances</button>
            <button type="button" className="ghost-button" onClick={exportJson}>Exporter JSON</button>
          </div>
        </div>
      </aside>

      <main className="main">
        <section className="hero">
          <div>
            <span className="eyebrow">Pilotage personnel</span>
            <h2>Un seul tableau de bord pour agir, progresser et garder le cap.</h2>
            <p>
              Trois modules coherents, des etats metier explicites, des bilans distincts et une logique de repos
              automatique pour retirer du bruit quand un item a deja gagne.
            </p>
          </div>
          <div className="hero-badges">
            <span>{habitOccurrences.length} jours / bilans habitudes</span>
            <span>{performanceOccurrences.length} iterations / bilans performances</span>
            <span>{dueTodayGoals.length} rappels aujourd&apos;hui</span>
          </div>
        </section>

        <section className="metrics-grid">
          {overviewMetrics.map((metric) => (
            <article key={metric.label} className="metric-card">
              <span className="metric-label">{metric.label}</span>
              <strong>{metric.value}</strong>
              <em>{metric.hint}</em>
            </article>
          ))}
        </section>

        {view === 'overview' && (
          <>
            <section className="board-grid">
              <article className="panel panel-large">
                <span className="eyebrow">Aujourd hui</span>
                <h3>Priorites immediates</h3>
                <div className="overview-columns">
                  <div className="focus-column">
                    <h4>Habitudes actives</h4>
                    {activeHabitsToday.slice(0, 5).map((item) => (
                      <div key={item.id} className="focus-card">
                        <strong>{item.title}</strong>
                        <span>{priorityLabel(item.priority)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="focus-column">
                    <h4>Performances a travailler</h4>
                    {activePerformancesNow.slice(0, 5).map((item) => (
                      <div key={item.id} className="focus-card">
                        <strong>{item.title}</strong>
                        <span>{priorityLabel(item.priority)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="focus-column">
                    <h4>Objectifs critiques</h4>
                    {sortedGoals.filter((goal) => goal.priority === 'high').slice(0, 5).map((goal) => (
                      <div key={goal.id} className="focus-card">
                        <strong>{goal.title}</strong>
                        <span>{periodLabel(goal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              <article className="panel">
                <span className="eyebrow">Centre de pilotage</span>
                <h3>File active</h3>
                <div className="action-stack">
                  <button type="button" onClick={prepareDay}>Preparer ma journee</button>
                  <button type="button" className="ghost-button" onClick={() => createNewOccurrence('habits', 'standard')}>Ouvrir un nouveau jour</button>
                  <button type="button" className="ghost-button" onClick={() => createNewOccurrence('performances', 'standard')}>Ouvrir une iteration</button>
                </div>
                <div className="activity-list">
                  {actionQueue.length > 0 ? actionQueue.map((line) => (
                    <div key={line} className="activity-item">
                      <strong>{line}</strong>
                    </div>
                  )) : (
                    <div className="activity-item">
                      <strong>Aucune action urgente</strong>
                      <p>Les elements critiques ont deja ete traites ou n ont pas encore d echeance proche.</p>
                    </div>
                  )}
                </div>
              </article>
            </section>

            <section className="board-grid">
              <article className="panel panel-large">
                <span className="eyebrow">Rappels</span>
                <h3>Echeances et rappels</h3>
                <div className="activity-list">
                  {overdueGoals.length > 0 ? overdueGoals.map((goal) => (
                    <div key={goal.id} className="activity-item urgency-overdue">
                      <strong>{goal.title}</strong>
                      <p>{goalUrgency(goal).label} · {periodLabel(goal)}</p>
                    </div>
                  )) : null}
                  {dueSoonGoals.length > 0 ? dueSoonGoals.map((goal) => (
                    <div key={goal.id} className="activity-item">
                      <strong>{goal.title}</strong>
                      <p>{goalUrgency(goal).label} · {periodLabel(goal)}</p>
                    </div>
                  )) : (
                    overdueGoals.length === 0 && <div className="activity-item">
                      <strong>Pas de rappel critique</strong>
                      <p>Aucun objectif avec rappel n arrive a echeance dans les 3 prochains jours.</p>
                    </div>
                  )}
                </div>
              </article>

            </section>

            <section className="board-grid">
              <article className="panel panel-large">
                <span className="eyebrow">Regles clefs</span>
                <h3>Etats metier conserves</h3>
                <div className="state-grid">
                  {(['unknown', 'success', 'excused', 'rest', 'inactive'] as EntryState[]).map((stateValue) => (
                    <div key={stateValue} className={`state-card state-${stateValue}`}>
                      <strong>{entryLabel(stateValue)}</strong>
                      <p>
                        {{
                          unknown: 'A remplir ou pas encore evalye.',
                          success: 'Reussite, validation ou cible atteinte.',
                          excused: 'Neutralise / reporte, sans penalite.',
                          rest: 'Pause automatique normale apres victoire.',
                          inactive: 'Non concerne pour cette occurrence.',
                        }[stateValue]}
                      </p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <span className="eyebrow">Portabilite</span>
                <h3>Import / export</h3>
                <label htmlFor={importFieldId} className="muted-label">Coller un export JSON</label>
                <textarea id={importFieldId} value={importJson} onChange={(event) => setImportJson(event.target.value)} placeholder="Coller un export JSON pour recharger l'app" />
                <button type="button" className="ghost-button" onClick={importState}>Importer</button>
              </article>
            </section>
          </>
        )}

        {view === 'habits' && selectedHabitOccurrence && (
          <section className="workspace-grid">
            <article className="panel panel-large">
              <div className="panel-head panel-head-stack">
                <div>
                  <span className="eyebrow">Habitudes</span>
                  <h3>{selectedHabitOccurrence.label}</h3>
                </div>
                <div className="toolbar">
                  <select value={habitOccurrenceId} onChange={(event) => setHabitOccurrenceId(event.target.value)}>
                    {habitOccurrences.map((occurrence) => (
                      <option key={occurrence.id} value={occurrence.id}>{occurrence.label} · {occurrence.kind === 'review' ? 'Bilan' : 'Jour'}</option>
                    ))}
                  </select>
                  <select value={habitPriorityFilter} onChange={(event) => setHabitPriorityFilter(event.target.value as 'all' | Priority)}>
                    <option value="all">Toutes priorites</option>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                  <label className="toggle"><input type="checkbox" checked={showHabitDetails} onChange={(event) => setShowHabitDetails(event.target.checked)} /> Mode detaille</label>
                </div>
              </div>

              <div className="tracker-list">
                {visibleHabitItems.map((item) => (
                  <article key={item.id} className="tracker-card">
                    <div className="tracker-head">
                      <div>
                        <strong>{item.title}</strong>
                        <div className="tracker-meta">
                          <span className={`pill priority-${item.priority}`}>{priorityLabel(item.priority)}</span>
                          <span className={`pill state-${selectedHabitOccurrence.entries[item.id]?.state ?? 'unknown'}`}>{entryLabel(selectedHabitOccurrence.entries[item.id]?.state ?? 'unknown')}</span>
                          <span className="ghost-pill">{item.inputKind}</span>
                        </div>
                      </div>
                    </div>

                    {showHabitDetails && (
                      <div className="detail-stack">
                        <p>{item.description}</p>
                        <small>
                          Frequence : {item.frequency?.kind === 'daily' ? 'Tous les jours' : item.frequency?.kind === 'weekdays' ? 'Jours de semaine' : `Jours precis (${(item.frequency?.days ?? []).map((day) => dayLabels[day]).join(', ')})`}
                          {' · '}Repos apres reussite : {item.restAfterSuccess} jour(s)
                        </small>
                      </div>
                    )}

                    {renderTrackerInput(selectedHabitOccurrence, item)}
                  </article>
                ))}
              </div>
            </article>

            <article className="stack">
              <article className="panel">
                <span className="eyebrow">Actions</span>
                <h3>Jour, bilan, sync</h3>
                <div className="action-stack">
                  <button type="button" onClick={() => createNewOccurrence('habits', 'standard')}>Nouveau jour</button>
                  <button type="button" className="ghost-button" onClick={() => createNewOccurrence('habits', 'review')}>Nouveau bilan</button>
                  <button type="button" className="ghost-button" onClick={() => recalcModule('habits')}>Recalcul global</button>
                </div>
              </article>

              <article className="panel">
                <span className="eyebrow">Nouvelle habitude</span>
                <h3>Ajouter un point de suivi</h3>
                <form className="form-grid" onSubmit={addTrackerItem}>
                  <input required value={trackerDraft.title} onChange={(event) => setTrackerDraft({ ...trackerDraft, title: event.target.value })} placeholder="Nom de l'habitude" />
                  <textarea value={trackerDraft.description} onChange={(event) => setTrackerDraft({ ...trackerDraft, description: event.target.value })} placeholder="Consigne ou description" />
                  <select value={trackerDraft.inputKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, inputKind: event.target.value as InputKind })}>
                    <option value="tristate">Validation tri-etat</option>
                    <option value="score">Score 0-4</option>
                    <option value="checklist">Checklist</option>
                    <option value="numeric">Valeur chiffree</option>
                    <option value="note">Note libre</option>
                  </select>
                  <select value={trackerDraft.priority} onChange={(event) => setTrackerDraft({ ...trackerDraft, priority: event.target.value as Priority })}>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                  <select value={trackerDraft.frequencyKind} onChange={(event) => setTrackerDraft({ ...trackerDraft, frequencyKind: event.target.value as FrequencyKind })}>
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
                            })}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <input type="number" min="0" value={trackerDraft.restAfterSuccess} onChange={(event) => setTrackerDraft({ ...trackerDraft, restAfterSuccess: Number(event.target.value) })} placeholder="Repos apres succes" />
                  {trackerDraft.inputKind === 'checklist' && (
                    <input value={trackerDraft.checklistText} onChange={(event) => setTrackerDraft({ ...trackerDraft, checklistText: event.target.value })} placeholder="Checklist separee par virgules" />
                  )}
                  {trackerDraft.inputKind === 'numeric' && (
                    <>
                      <select value={trackerDraft.targetMode} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetMode: event.target.value as TargetMode })}>
                        <option value="atLeast">Atteindre au moins</option>
                        <option value="atMost">Ne pas depasser</option>
                        <option value="exactly">Atteindre exactement</option>
                      </select>
                      <input type="number" value={trackerDraft.targetValue} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetValue: Number(event.target.value) })} placeholder="Cible" />
                      <input value={trackerDraft.targetUnit} onChange={(event) => setTrackerDraft({ ...trackerDraft, targetUnit: event.target.value })} placeholder="Unite" />
                    </>
                  )}
                  <button type="submit">Ajouter l'habitude</button>
                </form>
              </article>
            </article>
          </section>
        )}

        {view === 'performances' && selectedPerformanceOccurrence && (
          <section className="workspace-grid">
            <article className="panel panel-large">
              <div className="panel-head panel-head-stack">
                <div>
                  <span className="eyebrow">Performances</span>
                  <h3>{selectedPerformanceOccurrence.label}</h3>
                </div>
                <div className="toolbar">
                  <select value={performanceOccurrenceId} onChange={(event) => setPerformanceOccurrenceId(event.target.value)}>
                    {performanceOccurrences.map((occurrence) => (
                      <option key={occurrence.id} value={occurrence.id}>{occurrence.label} · {occurrence.kind === 'review' ? 'Bilan' : 'Iteration'}</option>
                    ))}
                  </select>
                  <select value={performancePriorityFilter} onChange={(event) => setPerformancePriorityFilter(event.target.value as 'all' | Priority)}>
                    <option value="all">Toutes priorites</option>
                    {priorityOrder.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}
                  </select>
                  <label className="toggle"><input type="checkbox" checked={showPerformanceDetails} onChange={(event) => setShowPerformanceDetails(event.target.checked)} /> Mode detaille</label>
                  <label className="toggle"><input type="checkbox" checked={hideRestingPerformances} onChange={(event) => setHideRestingPerformances(event.target.checked)} /> Masquer repos</label>
                </div>
              </div>

              <div className="tracker-list">
                {visiblePerformanceItems.map((item) => (
                  <article key={item.id} className="tracker-card">
                    <div className="tracker-head">
                      <div>
                        <strong>{item.title}</strong>
                        <div className="tracker-meta">
                          <span className={`pill priority-${item.priority}`}>{priorityLabel(item.priority)}</span>
                          <span className={`pill state-${selectedPerformanceOccurrence.entries[item.id]?.state ?? 'unknown'}`}>{entryLabel(selectedPerformanceOccurrence.entries[item.id]?.state ?? 'unknown')}</span>
                          <span className="ghost-pill">{item.inputKind}</span>
                        </div>
                      </div>
                    </div>
                    {showPerformanceDetails && (
                      <div className="detail-stack">
                        <p>{item.description}</p>
                        <small>Repos apres victoire : {item.restAfterSuccess} iteration(s)</small>
                      </div>
                    )}
                    {renderTrackerInput(selectedPerformanceOccurrence, item)}
                  </article>
                ))}
              </div>
            </article>

            <article className="stack">
              <article className="panel">
                <span className="eyebrow">Actions</span>
                <h3>Iteration, bilan, sync</h3>
                <div className="action-stack">
                  <button type="button" onClick={() => createNewOccurrence('performances', 'standard')}>Nouvelle iteration</button>
                  <button type="button" className="ghost-button" onClick={() => createNewOccurrence('performances', 'review')}>Nouveau bilan</button>
                  <button type="button" className="ghost-button" onClick={() => recalcModule('performances')}>Recalcul global</button>
                </div>
              </article>

              <article className="panel">
                <span className="eyebrow">Nouvelle performance</span>
                <h3>Ajouter un axe d'amelioration</h3>
                <form className="form-grid" onSubmit={addTrackerItem}>
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
              </article>
            </article>
          </section>
        )}

        {view === 'goals' && (
          <section className="workspace-grid">
            <article className="panel panel-large">
              <div className="panel-head panel-head-stack">
                <div>
                  <span className="eyebrow">Objectifs</span>
                  <h3>Horizon, echeance, rappel, resultat</h3>
                </div>
                <div className="toolbar">
                  <select value={goalView} onChange={(event) => setGoalView(event.target.value as 'week' | 'month' | 'year' | 'all')}>
                    <option value="all">Tous les objectifs</option>
                    <option value="week">Cette semaine</option>
                    <option value="month">Ce mois</option>
                    <option value="year">Cette annee et +</option>
                  </select>
                  <button type="button" className="ghost-button" onClick={() => patchState({ goals: sortGoals(state.goals) })}>Trier les objectifs</button>
                  <button type="button" className="ghost-button" onClick={testReminders}>Tester les rappels</button>
                </div>
              </div>

              <div className="goal-list">
                {visibleGoals.map((goal) => (
                  <article key={goal.id} className={`goal-card horizon-${goal.horizon}`}>
                    <div className="goal-head">
                      <div>
                        <strong>{goal.title}</strong>
                        <div className="tracker-meta">
                          <span className={`pill priority-${goal.priority}`}>{priorityLabel(goal.priority)}</span>
                          <span className={`pill state-${goalState(goal)}`}>{entryLabel(goalState(goal))}</span>
                          <span className={`ghost-pill horizon-chip horizon-${goal.horizon}`}>{horizonLabel(goal.horizon)}</span>
                          <span className={`ghost-pill urgency-pill urgency-${goalUrgency(goal).tone}`}>{goalUrgency(goal).label}</span>
                        </div>
                      </div>
                      <div className="goal-due">
                        <span>{periodLabel(goal)}</span>
                        <small>{goal.dueDate}</small>
                      </div>
                    </div>

                    <p>{goal.description}</p>
                    <div className="goal-progress">
                      <strong>Progression</strong>
                      <span>{goalProgressLabel(goal)}</span>
                    </div>
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
              <article className="panel">
                <span className="eyebrow">Nouvel objectif</span>
                <h3>Ajouter un horizon</h3>
                <form className="form-grid" onSubmit={addGoal}>
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
              </article>

              <article className="panel">
                <span className="eyebrow">Preview rappels</span>
                <h3>Simulation</h3>
                <div className="activity-list">
                  {reminderPreview.length > 0 ? reminderPreview.map((line) => (
                    <div key={line} className="activity-item">
                      <strong>{line}</strong>
                    </div>
                  )) : (
                    <div className="activity-item">
                      <strong>Aucune simulation lancee</strong>
                      <p>Utilise “Tester les rappels” pour previsualiser le rappel quotidien.</p>
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
