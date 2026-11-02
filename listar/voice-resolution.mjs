// Purpose: resolve dictated voice changes against the workspace one question at a time.
// Responsibilities: scope analysis to a collection or the whole workspace, expose
//   exactly one pending question step (target, disposition, repair, repeat-add or
//   blocked), and turn fully answered sessions into non-destructive actions.
// Rationale: A05/A06 require one understandable question at a time, human-readable
//   target choices (never raw IDs), no guessed targets and zero writes until an
//   explicitly confirmed commit — legacy destructive removal is never emitted here.

import { analyze } from './analyze.mjs';

let operationCounter = 1;

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) freeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function capitalize(text) {
  const clean = String(text ?? '').trim();
  return clean ? clean[0].toLocaleUpperCase('es') + clean.slice(1) : clean;
}

/** Non-archived items in the command scope: the collection, or the whole workspace. */
export function scopeItems(snapshot, collectionId = null) {
  if (!snapshot || !Array.isArray(snapshot.items)) throw new TypeError('Se necesita una instantánea del espacio de trabajo.');
  return snapshot.items.filter((item) => item?.archived !== true &&
    (collectionId == null || (item.collectionId ?? null) === collectionId));
}

/**
 * Interpret a dictated transcript against the reviewed scope. The analyzer keeps
 * its list-shaped contract internally; stable IDs and evidence stay internal.
 */
export function analyzeVoiceTranscript(transcript, snapshot, { collectionId = null, audioId } = {}) {
  const items = scopeItems(snapshot, collectionId).map((item) => {
    const { listId, ...rest } = item;
    return { ...rest, listId: undefined };
  });
  const scopeKey = collectionId == null ? 'workspace' : `collection:${collectionId}`;
  const analysis = analyze(String(transcript ?? ''), {
    listId: scopeKey,
    version: Number.isInteger(snapshot?.revision) ? snapshot.revision : 0,
    items,
    ...(audioId == null ? {} : { sourceAudioId: audioId }),
  });
  const collection = snapshot?.collections?.find((entry) => entry.id === collectionId);
  const scopeLabel = collectionId == null ? 'todas tus listas' : (collection?.name ?? 'la colección');
  const candidates = analysis.candidates;
  const commandLike = candidates.some((candidate) => candidate.intent !== 'add' || candidate.requiresChoice);
  return {
    transcript: String(transcript ?? ''),
    snapshot,
    scope: { collectionId, label: scopeLabel },
    analysis,
    candidates,
    commandLike,
  };
}

/** Frozen resolution session: answers accumulate immutably; persistence stays outside. */
export function createVoiceSession(voice, { operationId, audioId, now = Date.now() } = {}) {
  if (!voice || !Array.isArray(voice.candidates)) throw new TypeError('Se necesita un análisis de voz para revisar.');
  return freeze({
    transcript: voice.transcript,
    snapshot: freeze(clone(voice.snapshot)),
    scope: freeze({ ...voice.scope }),
    candidates: freeze(clone(voice.candidates)),
    answers: {},
    excluded: {},
    operationId: operationId ?? (globalThis.crypto?.randomUUID?.() || `listar-voice-${Date.now()}-${operationCounter++}`),
    audioId: audioId ?? null,
    createdAt: now,
  });
}

function collectionName(session, collectionId) {
  return session.snapshot?.collections?.find((entry) => entry.id === collectionId)?.name ?? null;
}

function choiceEntries(session, itemIds) {
  const entries = itemIds
    .map((itemId) => session.snapshot.items.find((item) => item.id === itemId))
    .filter(Boolean)
    .map((item) => {
      const parts = [capitalize(item.label)];
      const collection = collectionName(session, item.collectionId);
      if (collection) parts.push(collection);
      if (item.quantity != null) parts.push(`${item.quantity}${item.unit ? ` ${item.unit}` : ''}`);
      if (item.brand) parts.push(String(item.brand));
      if (item.package) parts.push(String(item.package));
      return { value: item.id, text: parts.join(' · '), _item: item };
    });
  // Identical labels with no distinguishing facts get stable local aliases.
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.text)) groups.set(entry.text, []);
    groups.get(entry.text).push(entry);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byCreation = [...group].sort((a, b) =>
      (a._item.createdAt ?? 0) - (b._item.createdAt ?? 0) || (a.value < b.value ? -1 : 1));
    byCreation.forEach((entry, index) => {
      entry.text = `${entry.text} · entrada ${index + 1}`;
    });
  }
  return entries.map(({ value, text }) => ({ value, text }));
}

function targetStep(session, candidate, index, itemIds = candidate.targetItemIds ?? []) {
  return {
    key: `c${index}:target`,
    candidateIndex: index,
    kind: 'target',
    question: `Hay varios artículos llamados “${candidate.label}”. ¿Cuál quieres elegir?`,
    choices: choiceEntries(session, itemIds),
    detail: '',
  };
}

function dispositionStep(session, candidate, index, itemId) {
  const item = session.snapshot.items.find((entry) => entry.id === itemId);
  const collection = collectionName(session, item?.collectionId);
  const choices = [{ value: 'archive', text: `Archivar “${capitalize(item?.label ?? candidate.label)}”` }];
  let detail = '';
  if (collection) {
    choices.push({ value: 'detach', text: `Quitar de ${collection}` });
  } else {
    detail = `“${capitalize(item?.label ?? candidate.label)}” no está en ninguna lista; solo se puede archivar.`;
  }
  return {
    key: `c${index}:disposition`,
    candidateIndex: index,
    kind: 'disposition',
    question: '¿Archivar o quitar de la lista?',
    choices,
    detail,
  };
}

function repairStep(candidate, index) {
  const first = candidate.alternatives?.[0]?.label;
  const second = candidate.alternatives?.[1]?.label;
  return {
    key: `c${index}:repair`,
    candidateIndex: index,
    kind: 'repair',
    question: `¿Qué querías decir con “${candidate.evidence?.[0]?.rawText ?? candidate.label}”?`,
    choices: [
      { value: 'keep-first', text: `Agregar ${capitalize(first ?? 'primera opción')}` },
      { value: 'replace-first', text: `Agregar ${capitalize(second ?? 'corrección')}` },
    ],
    detail: '',
  };
}

function repeatAddStep(candidate, index) {
  return {
    key: `c${index}:repeat-add`,
    candidateIndex: index,
    kind: 'repeat-add',
    question: `Ya hay un artículo “${candidate.label}”. ¿Qué prefieres?`,
    choices: [
      { value: 'add-distinct', text: 'Agregar un artículo distinto' },
      { value: 'increment-existing', text: `Aumentar la cantidad de “${candidate.label}” existente` },
    ],
    detail: '',
  };
}

function blockedStep(candidate, index, message) {
  return {
    key: `c${index}:blocked`,
    candidateIndex: index,
    kind: 'blocked',
    question: message,
    choices: [{ value: 'exclude', text: 'Quitar de esta captura' }],
    detail: '',
  };
}

function blockReason(candidate) {
  const diagnostic = candidate.diagnostics?.find(({ code }) => code === 'target-not-found');
  if (candidate.intent === 'remove' && diagnostic) return 'No se encontró un artículo de destino en este ámbito.';
  return 'Esta frase no se pudo resolver con seguridad; no se agregará como artículo.';
}

/** The FIRST pending question only — one understandable question at a time. */
export function sessionStep(session) {
  if (!session || !Array.isArray(session.candidates)) throw new TypeError('Se necesita una sesión de voz.');
  for (let index = 0; index < session.candidates.length; index++) {
    if (session.excluded[index]) continue;
    const candidate = session.candidates[index];
    if (candidate.intent === 'query') continue;
    const answer = session.answers[index] ?? {};
    if (candidate.intent === 'ambiguous') {
      if (!answer.repair) return repairStep(candidate, index);
      continue;
    }
    if (candidate.intent === 'add') {
      if (!candidate.requiresChoice) continue;
      if (!answer.repair) return repeatAddStep(candidate, index);
      if (answer.repair === 'increment-existing') {
        const matches = incrementTargets(candidate);
        if (matches.length > 1 && !answer.targetItemId) return targetStep(session, candidate, index, matches);
      }
      continue;
    }
    if (candidate.intent === 'remove') {
      const targets = candidate.targetItemIds ?? [];
      if (targets.length > 1 && !answer.targetItemId) return targetStep(session, candidate, index);
      const itemId = answer.targetItemId ?? (targets.length === 1 ? targets[0] : null);
      if (!itemId) return blockedStep(candidate, index, blockReason(candidate));
      if (!answer.disposition) return dispositionStep(session, candidate, index, itemId);
      continue;
    }
    return blockedStep(candidate, index, blockReason(candidate));
  }
  return null;
}

function withAnswer(session, index, patch) {
  const answers = { ...session.answers, [index]: { ...(session.answers[index] ?? {}), ...patch } };
  return freeze({ ...session, answers: freeze(answers) });
}

/** Answer the active question step with one of its offered choices. */
export function answerStep(session, step, value) {
  if (!step) throw new TypeError('No hay una pregunta activa.');
  if (!step.choices.some((choice) => choice.value === value)) {
    throw new Error('Elige una de las opciones disponibles.');
  }
  if (step.kind === 'target') return withAnswer(session, step.candidateIndex, { targetItemId: value });
  if (step.kind === 'disposition') return withAnswer(session, step.candidateIndex, { disposition: value });
  if (step.kind === 'repair' || step.kind === 'repeat-add') return withAnswer(session, step.candidateIndex, { repair: value });
  if (step.kind === 'blocked') return excludeCandidate(session, step.candidateIndex);
  throw new Error('Pregunta sin respuesta válida.');
}

/** Exclude one proposal from this capture; exclusion updates the confirmable count. */
export function excludeCandidate(session, index) {
  if (!Number.isInteger(index) || index < 0 || index >= session.candidates.length) {
    throw new TypeError(`Unknown voice candidate: ${index}`);
  }
  return freeze({ ...session, excluded: freeze({ ...session.excluded, [index]: true }) });
}

function addAction(session, index, label) {
  const candidate = session.candidates[index];
  const evidence = candidate.evidence?.[0];
  const audioId = session.audioId ?? evidence?.sourceAudioId ?? evidence?.audioId ?? null;
  return {
    kind: 'add',
    item: {
      id: `${session.operationId}:item:${index}`,
      label: capitalize(label),
      text: evidence?.rawText ?? String(label),
      done: false,
      createdAt: session.createdAt + index,
      order: session.createdAt + index,
      ...(candidate.proposed?.quantity === undefined ? {} : { quantity: candidate.proposed.quantity }),
      ...(candidate.proposed?.unit === undefined ? {} : { unit: candidate.proposed.unit }),
      ...(audioId == null ? {} : { sourceAudioId: audioId }),
    },
    collectionId: session.scope.collectionId,
  };
}

function incrementTargets(candidate) {
  return candidate.alternatives?.find((alternative) => alternative.action === 'increment-existing')?.itemIds ?? [];
}

/**
 * Turn a fully answered session into confirmed actions. Unresolved or blocked
 * candidates make the plan incomplete; the batch cannot commit partially.
 * Action kinds are add | archive | detach | increment — never destructive remove.
 */
export function sessionActions(session) {
  if (!session || !Array.isArray(session.candidates)) throw new TypeError('Se necesita una sesión de voz.');
  const actions = [];
  const incomplete = () => ({ ok: false, actions: [], pending: pendingCount(session) });

  function pendingCount(current) {
    let count = 0;
    let probe = current;
    let guard = current.candidates.length + 1;
    while (guard-- > 0) {
      const step = sessionStep(probe);
      if (!step) break;
      count += 1;
      probe = answerStep(probe, step, step.choices[0].value);
    }
    return count;
  }

  for (let index = 0; index < session.candidates.length; index++) {
    if (session.excluded[index]) continue;
    const candidate = session.candidates[index];
    if (candidate.intent === 'query') continue;
    const answer = session.answers[index] ?? {};
    if (candidate.intent === 'ambiguous') {
      if (answer.repair !== 'keep-first' && answer.repair !== 'replace-first') return incomplete();
      const label = answer.repair === 'keep-first'
        ? candidate.alternatives?.[0]?.label
        : candidate.alternatives?.[1]?.label;
      if (!label) return incomplete();
      actions.push(addAction(session, index, label));
      continue;
    }
    if (candidate.intent === 'add') {
      if (!candidate.requiresChoice) {
        actions.push(addAction(session, index, candidate.label));
        continue;
      }
      if (answer.repair === 'add-distinct') {
        actions.push(addAction(session, index, candidate.label));
        continue;
      }
      if (answer.repair === 'increment-existing') {
        const matches = incrementTargets(candidate);
        const itemId = answer.targetItemId ?? (matches.length === 1 ? matches[0] : null);
        if (!itemId || !matches.includes(itemId)) return incomplete();
        const target = session.snapshot.items.find((item) => item.id === itemId);
        actions.push({
          kind: 'increment',
          itemId,
          quantity: candidate.proposed?.quantity ?? 1,
          ...(candidate.proposed?.unit === undefined && target?.unit === undefined
            ? {}
            : { unit: candidate.proposed?.unit ?? target?.unit }),
        });
        continue;
      }
      return incomplete();
    }
    if (candidate.intent === 'remove') {
      const targets = candidate.targetItemIds ?? [];
      const itemId = answer.targetItemId ?? (targets.length === 1 ? targets[0] : null);
      const item = itemId ? session.snapshot.items.find((entry) => entry.id === itemId) : null;
      if (!item) return incomplete();
      if (answer.disposition === 'archive') {
        actions.push({ kind: 'archive', itemId });
        continue;
      }
      if (answer.disposition === 'detach' && item.collectionId) {
        actions.push({ kind: 'detach', itemId, fromCollectionId: item.collectionId });
        continue;
      }
      return incomplete();
    }
    return incomplete();
  }
  return { ok: true, actions, pending: 0 };
}

/** Concrete Spanish summaries for the confirmation card (`Archivar leche`, …). */
export function actionSummaries(actions, snapshot) {
  if (!Array.isArray(actions)) throw new TypeError('Se necesita una lista de acciones.');
  const findItem = (itemId) => snapshot?.items?.find((item) => item.id === itemId) ?? null;
  return actions.map((action) => {
    if (action.kind === 'archive') return `Archivar ${capitalize(findItem(action.itemId)?.label ?? 'artículo')}`;
    if (action.kind === 'detach') {
      const collection = snapshot?.collections?.find((entry) => entry.id === action.fromCollectionId)?.name ?? 'la lista';
      return `Quitar de ${collection}; conservar en Sin lista`;
    }
    if (action.kind === 'add') {
      const amount = action.item.quantity != null ? ` · ${action.item.quantity}${action.item.unit ? ` ${action.item.unit}` : ''}` : '';
      return `Agregar ${action.item.label}${amount}`;
    }
    if (action.kind === 'increment') {
      const item = findItem(action.itemId);
      const current = item?.quantity ?? 0;
      return `${capitalize(item?.label ?? 'artículo')}: ${current} → ${current + action.quantity}${action.unit ?? item?.unit ?? ''}`;
    }
    throw new TypeError(`Acción de voz sin resumen: ${action.kind}`);
  });
}

/** A18: the reviewed snapshot revision no longer matches the workspace. */
export function isSessionStale(session, snapshot) {
  return !snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision !== session.snapshot.revision;
}
