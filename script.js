const STORAGE_KEYS = {
  progress: "licencia_c_progress_v3",
  settings: "licencia_c_settings_v3"
};

const EXAM_QUESTION_COUNT = 20;
const EXAM_DURATION_SECONDS = 30 * 60;
const EXAM_PENALTY_VALUE = 0.33;
const CONSOLIDATION_STREAK = 2;
const INTENSIVE_BATCH_SIZE = 15;

const DEFAULT_PROGRESS = {
  totals: {
    answered: 0,
    correct: 0,
    wrong: 0,
    sessions: 0
  },
  perQuestion: {},
  examHistory: []
};

const DEFAULT_SETTINGS = {
  passMark: 16,
  penaltyEnabled: false
};

const MODE_CONFIG = {
  practice: {
    label: "Modo práctica",
    title: "Corrección inmediata y explicación normativa"
  },
  exam: {
    label: "Examen real",
    title: "Simulación de 20 preguntas en 30 minutos"
  },
  mistakes: {
    label: "Solo fallos",
    title: "Repaso de preguntas que todavía requieren consolidación"
  },
  difficult: {
    label: "Preguntas difíciles",
    title: "Trampas normativas, matices y preguntas de alta exigencia"
  },
  intensive: {
    label: "Entrenamiento intensivo",
    title: "Repetición forzada hasta corregir errores pendientes"
  }
};

const state = {
  bank: [],
  filteredBank: [],
  questionMap: new Map(),
  categories: [],
  currentMode: "practice",
  selectedCategory: "Todas",
  currentSession: [],
  currentIndex: 0,
  answeredCurrent: false,
  progress: normalizeProgress(loadStoredJSON(STORAGE_KEYS.progress, DEFAULT_PROGRESS)),
  settings: normalizeSettings(loadStoredJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS)),
  exam: {
    active: false,
    timerId: null,
    remainingSeconds: EXAM_DURATION_SECONDS,
    answers: []
  },
  intensiveQueue: []
};

const elements = {
  totalQuestions: document.getElementById("totalQuestions"),
  globalAccuracy: document.getElementById("globalAccuracy"),
  globalAnswered: document.getElementById("globalAnswered"),
  activeMistakes: document.getElementById("activeMistakes"),
  lastExamBadge: document.getElementById("lastExamBadge"),
  lastExamMeta: document.getElementById("lastExamMeta"),
  correctAnswers: document.getElementById("correctAnswers"),
  wrongAnswers: document.getElementById("wrongAnswers"),
  masteredQuestions: document.getElementById("masteredQuestions"),
  sessionCount: document.getElementById("sessionCount"),
  categorySelect: document.getElementById("categorySelect"),
  passMarkInput: document.getElementById("passMarkInput"),
  penaltyToggle: document.getElementById("penaltyToggle"),
  startExamBtn: document.getElementById("startExamBtn"),
  resetProgressBtn: document.getElementById("resetProgressBtn"),
  modeButtons: [...document.querySelectorAll(".mode-btn")],
  modeLabel: document.getElementById("modeLabel"),
  stageTitle: document.getElementById("stageTitle"),
  questionCounter: document.getElementById("questionCounter"),
  timer: document.getElementById("timer"),
  statusMessage: document.getElementById("statusMessage"),
  questionCard: document.getElementById("questionCard"),
  questionCategory: document.getElementById("questionCategory"),
  questionDifficulty: document.getElementById("questionDifficulty"),
  questionSource: document.getElementById("questionSource"),
  questionText: document.getElementById("questionText"),
  optionsList: document.getElementById("optionsList"),
  feedbackPanel: document.getElementById("feedbackPanel"),
  feedbackTitle: document.getElementById("feedbackTitle"),
  feedbackExplanation: document.getElementById("feedbackExplanation"),
  nextBtn: document.getElementById("nextBtn"),
  resultsCard: document.getElementById("resultsCard"),
  resultsTitle: document.getElementById("resultsTitle"),
  resultsOutcome: document.getElementById("resultsOutcome"),
  resultsScore: document.getElementById("resultsScore"),
  resultsPercent: document.getElementById("resultsPercent"),
  resultsWrong: document.getElementById("resultsWrong"),
  resultsPenalty: document.getElementById("resultsPenalty"),
  retryExamBtn: document.getElementById("retryExamBtn"),
  reviewMistakesBtn: document.getElementById("reviewMistakesBtn"),
  resultsReview: document.getElementById("resultsReview"),
  emptyState: document.getElementById("emptyState"),
  weakAreas: document.getElementById("weakAreas"),
  examHistory: document.getElementById("examHistory"),
  trainingRadar: document.getElementById("trainingRadar")
};

document.addEventListener("DOMContentLoaded", initializeApp);

function initializeApp() {
  bindEvents();
  hydrateSettings();
  initializeQuestionBank();
  renderDashboard();
  setMode("practice");
}

function bindEvents() {
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  elements.categorySelect.addEventListener("change", (event) => {
    state.selectedCategory = event.target.value;
    updateFilteredBank();

    if (state.currentMode === "exam") {
      resetStageToIdle("Pulsa \"Iniciar examen\" para lanzar una nueva simulación con el filtro actual.");
      return;
    }

    startModeSession(state.currentMode);
  });

  elements.startExamBtn.addEventListener("click", startExam);
  elements.retryExamBtn.addEventListener("click", startExam);
  elements.reviewMistakesBtn.addEventListener("click", () => setMode("mistakes"));
  elements.nextBtn.addEventListener("click", handleNext);
  elements.resetProgressBtn.addEventListener("click", resetProgress);

  elements.passMarkInput.addEventListener("change", () => {
    const sanitized = clampNumber(Number(elements.passMarkInput.value), 1, EXAM_QUESTION_COUNT, DEFAULT_SETTINGS.passMark);
    elements.passMarkInput.value = sanitized;
    state.settings.passMark = sanitized;
    persistSettings();
  });

  elements.penaltyToggle.addEventListener("change", () => {
    state.settings.penaltyEnabled = elements.penaltyToggle.checked;
    persistSettings();
  });
}

function initializeQuestionBank() {
  const dataset = window.APP_QUESTIONS;
  if (!dataset || !Array.isArray(dataset.questions)) {
    showStatus("No se ha podido cargar el banco de preguntas.", true);
    return;
  }

  const seenIds = new Set();
  state.bank = dataset.questions
    .map(normalizeQuestion)
    .filter((question) => isValidQuestion(question) && !seenIds.has(question.id) && seenIds.add(question.id));

  if (!state.bank.length) {
    showStatus("El banco de preguntas no contiene elementos válidos.", true);
    return;
  }

  state.questionMap = new Map(state.bank.map((question) => [question.id, question]));
  state.categories = dataset.categories && dataset.categories.length
    ? [...new Set(dataset.categories.map((category) => String(category)))]
    : inferCategories(state.bank);

  populateCategories(state.categories);
  updateFilteredBank();
}

function hydrateSettings() {
  elements.passMarkInput.value = state.settings.passMark;
  elements.penaltyToggle.checked = Boolean(state.settings.penaltyEnabled);
}

function normalizeQuestion(question) {
  return {
    ...question,
    id: Number(question.id),
    category: question.category || "Sin categoría",
    difficulty: question.difficulty || "Alta",
    sourceRef: question.sourceRef || "Referencia técnica",
    question: String(question.question || "").trim(),
    options: Array.isArray(question.options) ? question.options.map((option) => String(option || "").trim()) : [],
    correctIndex: Number(question.correctIndex),
    explanation: String(question.explanation || "").trim(),
    isDifficult: Boolean(question.isDifficult),
    examWeight: Number(question.examWeight) || 2,
    tags: Array.isArray(question.tags) ? question.tags : []
  };
}

function isValidQuestion(question) {
  if (!Number.isInteger(question.id) || question.id <= 0) {
    return false;
  }
  if (!question.question || question.options.length !== 4) {
    return false;
  }
  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) {
    return false;
  }
  return new Set(question.options).size === 4;
}

function normalizeProgress(progress) {
  const safe = cloneValue(DEFAULT_PROGRESS);
  if (!progress || typeof progress !== "object") {
    return safe;
  }

  const totals = progress.totals && typeof progress.totals === "object" ? progress.totals : {};
  safe.totals.answered = positiveInteger(totals.answered);
  safe.totals.correct = positiveInteger(totals.correct);
  safe.totals.wrong = positiveInteger(totals.wrong);
  safe.totals.sessions = positiveInteger(totals.sessions);
  safe.examHistory = Array.isArray(progress.examHistory) ? progress.examHistory.slice(-10) : [];

  if (progress.perQuestion && typeof progress.perQuestion === "object") {
    Object.entries(progress.perQuestion).forEach(([questionId, stats]) => {
      const sourceStats = stats && typeof stats === "object" ? stats : {};
      safe.perQuestion[questionId] = {
        seen: positiveInteger(sourceStats.seen),
        correct: positiveInteger(sourceStats.correct),
        wrong: positiveInteger(sourceStats.wrong),
        streak: positiveInteger(sourceStats.streak),
        lastSeenAt: typeof sourceStats.lastSeenAt === "string" ? sourceStats.lastSeenAt : null,
        category: typeof sourceStats.category === "string" ? sourceStats.category : ""
      };
    });
  }

  return safe;
}

function normalizeSettings(settings) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    passMark: clampNumber(Number(source.passMark), 1, EXAM_QUESTION_COUNT, DEFAULT_SETTINGS.passMark),
    penaltyEnabled: Boolean(source.penaltyEnabled)
  };
}

function populateCategories(categories) {
  const values = ["Todas", ...new Set(categories)];
  elements.categorySelect.innerHTML = values
    .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
    .join("");
  elements.categorySelect.value = state.selectedCategory;
}

function inferCategories(bank) {
  return [...new Set(bank.map((question) => question.category))];
}

function updateFilteredBank() {
  state.filteredBank = state.selectedCategory === "Todas"
    ? [...state.bank]
    : state.bank.filter((question) => question.category === state.selectedCategory);
}

function setMode(mode) {
  state.currentMode = mode;
  syncModeButtons();
  applyModeCopy(mode);

  if (mode === "exam") {
    resetStageToIdle("Pulsa \"Iniciar examen\" para comenzar una simulación real sin ayudas.");
    return;
  }

  startModeSession(mode);
}

function syncModeButtons() {
  elements.modeButtons.forEach((button) => {
    const isActive = button.dataset.mode === state.currentMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function applyModeCopy(mode) {
  const config = MODE_CONFIG[mode];
  elements.modeLabel.textContent = config.label;
  elements.stageTitle.textContent = config.title;
  elements.timer.classList.toggle("hidden", mode !== "exam");
}

function startModeSession(mode) {
  resetSessionState();

  if (mode === "practice") {
    state.currentSession = buildPracticeSession();
  } else if (mode === "mistakes") {
    state.currentSession = buildMistakesSession();
  } else if (mode === "difficult") {
    state.currentSession = buildDifficultSession();
  } else if (mode === "intensive") {
    state.currentSession = buildIntensiveSession();
  } else {
    state.currentSession = [];
  }

  renderQuestionOrEmpty();
}

function resetSessionState() {
  clearExamTimer();
  state.exam.active = false;
  state.exam.answers = [];
  state.exam.remainingSeconds = EXAM_DURATION_SECONDS;
  state.currentIndex = 0;
  state.answeredCurrent = false;
  state.intensiveQueue = [];

  renderTimer(EXAM_DURATION_SECONDS);
  elements.resultsCard.classList.add("hidden");
  hideFeedback();
  setNextButtonState(false);
}

function buildPracticeSession() {
  return prioritizeQuestions(state.filteredBank, (question) => getQuestionPriority(question) + 1);
}

function buildMistakesSession() {
  const pool = state.filteredBank.filter((question) => needsReinforcement(getQuestionStats(question.id)));
  return prioritizeQuestions(pool, (question) => getQuestionPriority(question) + 2);
}

function buildDifficultSession() {
  const pool = state.filteredBank.filter((question) => question.isDifficult || getQuestionPriority(question) >= 3);
  return prioritizeQuestions(pool, (question) => getQuestionPriority(question) + 2);
}

function buildIntensiveSession() {
  const mistakes = buildMistakesSession();
  if (mistakes.length) {
    return mistakes.slice(0, INTENSIVE_BATCH_SIZE);
  }
  return buildPracticeSession().slice(0, INTENSIVE_BATCH_SIZE);
}

function prioritizeQuestions(questions, getWeight) {
  return [...questions].sort((left, right) => {
    const leftScore = getWeight(left) + Math.random();
    const rightScore = getWeight(right) + Math.random();
    return rightScore - leftScore;
  });
}

function getQuestionPriority(question) {
  const stats = getQuestionStats(question.id);
  const reinforcement = needsReinforcement(stats) ? 3 : 0;
  const unseen = stats.seen === 0 ? 2 : 0;
  const difficult = question.isDifficult ? 1 : 0;
  return reinforcement + unseen + difficult;
}

function startExam() {
  updateFilteredBank();

  if (state.filteredBank.length < EXAM_QUESTION_COUNT) {
    showStatus(`El filtro actual deja menos de ${EXAM_QUESTION_COUNT} preguntas. Amplía el tema o usa "Todas".`, true);
    return;
  }

  state.currentMode = "exam";
  syncModeButtons();
  applyModeCopy("exam");
  resetSessionState();
  hideStatus();

  state.exam.active = true;
  state.currentSession = prioritizeQuestions(state.filteredBank, (question) => question.examWeight).slice(0, EXAM_QUESTION_COUNT);
  startExamTimer();
  renderCurrentQuestion();
}

function startExamTimer() {
  clearExamTimer();
  renderTimer(state.exam.remainingSeconds);
  state.exam.timerId = window.setInterval(() => {
    state.exam.remainingSeconds -= 1;
    renderTimer(Math.max(0, state.exam.remainingSeconds));

    if (state.exam.remainingSeconds <= 0) {
      finishExam();
    }
  }, 1000);
}

function clearExamTimer() {
  if (state.exam.timerId) {
    window.clearInterval(state.exam.timerId);
    state.exam.timerId = null;
  }
}

function renderQuestionOrEmpty() {
  if (!state.currentSession.length) {
    resetStageToIdle(getEmptyMessageForMode());
    return;
  }

  hideStatus();
  renderCurrentQuestion();
}

function getEmptyMessageForMode() {
  if (state.currentMode === "mistakes") {
    return "No tienes fallos activos con el filtro actual. Buen momento para pasar a preguntas difíciles o a examen real.";
  }
  if (state.currentMode === "difficult") {
    return "No hay preguntas difíciles disponibles con este filtro. Cambia de tema o vuelve a práctica.";
  }
  if (state.currentMode === "intensive") {
    return "No hay preguntas pendientes de refuerzo intensivo con este filtro.";
  }
  return "No hay preguntas disponibles con el filtro seleccionado.";
}

function renderCurrentQuestion() {
  const question = state.currentSession[state.currentIndex];
  if (!question) {
    resetStageToIdle(getEmptyMessageForMode());
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.resultsCard.classList.add("hidden");
  elements.questionCard.classList.remove("hidden");
  hideFeedback();

  state.answeredCurrent = false;
  elements.questionCounter.textContent = `Pregunta ${state.currentIndex + 1} / ${state.currentSession.length}`;
  elements.questionCategory.textContent = question.category;
  elements.questionDifficulty.textContent = question.difficulty;
  elements.questionSource.textContent = question.sourceRef;
  elements.questionText.textContent = question.question;

  renderOptions(question);
  setNextButtonState(false);
}

function renderOptions(question) {
  elements.optionsList.innerHTML = "";

  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-btn";
    button.innerHTML = `<strong>${String.fromCharCode(65 + index)}.</strong> ${escapeHtml(option)}`;
    button.addEventListener("click", () => handleAnswer(index));
    elements.optionsList.appendChild(button);
  });
}

function handleAnswer(selectedIndex) {
  if (state.answeredCurrent) {
    return;
  }

  const question = state.currentSession[state.currentIndex];
  if (!question) {
    return;
  }

  const isCorrect = selectedIndex === question.correctIndex;
  state.answeredCurrent = true;

  const optionButtons = [...elements.optionsList.querySelectorAll(".option-btn")];
  optionButtons.forEach((button, index) => {
    button.disabled = true;
    if (index === question.correctIndex) {
      button.classList.add("correct");
    }
    if (index === selectedIndex && !isCorrect) {
      button.classList.add("wrong");
    }
  });

  registerAnswer(question, isCorrect);

  if (state.currentMode === "exam") {
    state.exam.answers.push({
      questionId: question.id,
      selectedIndex,
      isCorrect
    });
    setNextButtonState(true);
    return;
  }

  if (state.currentMode === "intensive" && !isCorrect) {
    state.intensiveQueue.push(question);
  }

  showFeedback(isCorrect, question.explanation);
  setNextButtonState(true);
}

function handleNext() {
  if (!state.currentSession.length) {
    return;
  }

  if (!state.answeredCurrent) {
    showStatus("Debes responder la pregunta antes de continuar.", true);
    return;
  }

  hideStatus();
  state.currentIndex += 1;

  if (state.currentMode === "intensive" && state.currentIndex >= state.currentSession.length && state.intensiveQueue.length) {
    state.currentSession = [...state.intensiveQueue];
    state.intensiveQueue = [];
    state.currentIndex = 0;
  }

  if (state.currentIndex >= state.currentSession.length) {
    finishNonExamSessionOrRestart();
    return;
  }

  renderCurrentQuestion();
}

function finishNonExamSessionOrRestart() {
  if (state.currentMode === "exam") {
    finishExam();
    return;
  }

  state.progress.totals.sessions += 1;
  persistProgress();
  renderDashboard();
  startModeSession(state.currentMode);
}

function finishExam() {
  clearExamTimer();
  state.exam.active = false;

  const total = state.currentSession.length || EXAM_QUESTION_COUNT;
  const correct = state.exam.answers.filter((answer) => answer.isCorrect).length;
  const wrong = total - correct;
  const penaltyValue = state.settings.penaltyEnabled ? wrong * EXAM_PENALTY_VALUE : 0;
  const netScore = Math.max(0, roundToTwo(correct - penaltyValue));
  const percent = Math.round((netScore / total) * 100);
  const passed = netScore >= state.settings.passMark;

  const result = {
    date: new Date().toISOString(),
    correct,
    wrong,
    total,
    percent,
    passed,
    penaltyApplied: state.settings.penaltyEnabled,
    penaltyValue,
    netScore,
    passMark: state.settings.passMark,
    answers: [...state.exam.answers]
  };

  state.progress.totals.sessions += 1;
  state.progress.examHistory.push(result);
  state.progress.examHistory = state.progress.examHistory.slice(-10);
  persistProgress();
  renderDashboard();

  elements.questionCard.classList.add("hidden");
  elements.emptyState.classList.add("hidden");
  elements.resultsCard.classList.remove("hidden");
  elements.questionCounter.textContent = `Pregunta ${total} / ${total}`;
  elements.resultsTitle.textContent = passed
    ? "Nivel de aprobado alcanzado"
    : "Aún no llegas al umbral configurado";
  elements.resultsOutcome.textContent = passed ? "Apto estimado" : "Refuerzo necesario";
  elements.resultsOutcome.className = `result-chip ${passed ? "pass" : "fail"}`;
  elements.resultsScore.textContent = `${formatScore(netScore)} / ${total}`;
  elements.resultsPercent.textContent = `${percent}%`;
  elements.resultsWrong.textContent = wrong;
  elements.resultsPenalty.textContent = state.settings.penaltyEnabled ? `Sí (-${formatScore(penaltyValue)})` : "No";

  renderResultsReview(result);
}

function renderResultsReview(result) {
  const wrongAnswers = result.answers.filter((answer) => !answer.isCorrect);

  if (!wrongAnswers.length) {
    elements.resultsReview.innerHTML = `
      <div class="review-item">
        <p>No hubo errores en este simulacro.</p>
        <p>Buen momento para repetir el examen con otro filtro o subir la exigencia.</p>
      </div>
    `;
    return;
  }

  elements.resultsReview.innerHTML = wrongAnswers.slice(0, 6).map((answer) => {
    const question = state.questionMap.get(answer.questionId);
    if (!question) {
      return "";
    }

    return `
      <article class="review-item">
        <p><strong>${escapeHtml(question.question)}</strong></p>
        <p>Marcaste: ${escapeHtml(question.options[answer.selectedIndex] || "Sin respuesta")}</p>
        <p>Correcta: ${escapeHtml(question.options[question.correctIndex])}</p>
        <p>${escapeHtml(question.explanation)}</p>
      </article>
    `;
  }).join("");
}

function showFeedback(isCorrect, explanation) {
  elements.feedbackPanel.className = `feedback ${isCorrect ? "correct" : "wrong"}`;
  elements.feedbackTitle.textContent = isCorrect ? "Respuesta correcta" : "Respuesta incorrecta";
  elements.feedbackExplanation.textContent = explanation;
  elements.feedbackPanel.classList.remove("hidden");
}

function hideFeedback() {
  elements.feedbackPanel.classList.add("hidden");
}

function renderDashboard() {
  const totals = state.progress.totals;
  const answered = totals.answered;
  const accuracy = answered ? Math.round((totals.correct / answered) * 100) : 0;
  const lastExam = state.progress.examHistory[state.progress.examHistory.length - 1];
  const activeMistakes = state.bank.filter((question) => needsReinforcement(getQuestionStats(question.id))).length;
  const mastered = state.bank.filter((question) => isMastered(getQuestionStats(question.id))).length;

  elements.totalQuestions.textContent = state.bank.length;
  elements.globalAccuracy.textContent = `${accuracy}%`;
  elements.globalAnswered.textContent = `${answered} respuestas`;
  elements.activeMistakes.textContent = activeMistakes;
  elements.correctAnswers.textContent = totals.correct;
  elements.wrongAnswers.textContent = totals.wrong;
  elements.masteredQuestions.textContent = mastered;
  elements.sessionCount.textContent = totals.sessions;

  if (lastExam) {
    elements.lastExamBadge.textContent = `${formatScore(lastExam.netScore)}/${lastExam.total}`;
    elements.lastExamMeta.textContent = `${lastExam.percent}% · corte ${lastExam.passMark}`;
  } else {
    elements.lastExamBadge.textContent = "Sin datos";
    elements.lastExamMeta.textContent = "30 min · 20 preguntas";
  }

  renderWeakAreas();
  renderExamHistory();
  renderTrainingRadar();
}

function renderWeakAreas() {
  const areas = state.categories.map((category) => {
    const questions = state.bank.filter((question) => question.category === category);
    let seen = 0;
    let correct = 0;

    questions.forEach((question) => {
      const stats = getQuestionStats(question.id);
      seen += stats.seen;
      correct += stats.correct;
    });

    return {
      category,
      seen,
      accuracy: seen ? Math.round((correct / seen) * 100) : 0
    };
  }).sort((left, right) => {
    const leftPending = left.seen === 0 ? 1 : 0;
    const rightPending = right.seen === 0 ? 1 : 0;
    return leftPending - rightPending || left.accuracy - right.accuracy;
  });

  if (!areas.length) {
    elements.weakAreas.innerHTML = `<div class="stack-item"><strong>Sin datos</strong><small>No hay categorías cargadas.</small></div>`;
    return;
  }

  elements.weakAreas.innerHTML = areas.slice(0, 4).map((area) => {
    const subtitle = area.seen ? `${area.accuracy}% de acierto` : "Sin datos todavía";
    return renderStackItem(area.category, subtitle, area.accuracy);
  }).join("");
}

function renderExamHistory() {
  const exams = state.progress.examHistory;
  if (!exams.length) {
    elements.examHistory.innerHTML = `<div class="stack-item"><strong>Sin simulacros</strong><small>El historial aparecerá aquí cuando completes tu primer examen.</small></div>`;
    return;
  }

  elements.examHistory.innerHTML = exams.map((exam, index) => {
    const height = Math.max(24, Math.round((exam.percent / 100) * 160));
    return `
      <div class="history-bar" title="${escapeHtml(`Examen ${index + 1}: ${exam.percent}%`)}">
        <div class="history-bar-fill" style="height:${height}px"></div>
        <small>${exam.percent}%</small>
      </div>
    `;
  }).join("");
}

function renderTrainingRadar() {
  const candidates = state.bank.map((question) => {
    const stats = getQuestionStats(question.id);
    return {
      question,
      stats,
      score: getQuestionPriority(question)
    };
  }).filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);

  if (!candidates.length) {
    elements.trainingRadar.innerHTML = `<div class="stack-item"><strong>Buen equilibrio</strong><small>Ahora mismo no hay alertas claras. Puedes seguir con examen o preguntas difíciles.</small></div>`;
    return;
  }

  elements.trainingRadar.innerHTML = candidates.map((entry) => {
    const subtitle = entry.stats.seen === 0
      ? "Pregunta nueva"
      : `${entry.stats.correct} aciertos · ${entry.stats.wrong} fallos`;
    return renderStackItem(entry.question.topic || entry.question.category, subtitle, Math.min(100, 20 + entry.score * 20));
  }).join("");
}

function renderStackItem(title, subtitle, progress) {
  return `
    <article class="stack-item">
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(subtitle)}</small>
      <div class="progress-track">
        <div class="progress-bar" style="width:${Math.max(8, progress)}%"></div>
      </div>
    </article>
  `;
}

function setNextButtonState(enabled) {
  elements.nextBtn.disabled = !enabled;
  elements.nextBtn.textContent = state.currentMode === "exam" && state.currentIndex === state.currentSession.length - 1
    ? "Ver resultado"
    : "Siguiente";
}

function getQuestionStats(questionId) {
  return state.progress.perQuestion[questionId] || {
    seen: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    lastSeenAt: null,
    category: ""
  };
}

function isMastered(stats) {
  return stats.correct >= CONSOLIDATION_STREAK && stats.wrong === 0;
}

function needsReinforcement(stats) {
  return stats.wrong > 0 && stats.streak < CONSOLIDATION_STREAK;
}

function registerAnswer(question, isCorrect) {
  state.progress.totals.answered += 1;
  if (isCorrect) {
    state.progress.totals.correct += 1;
  } else {
    state.progress.totals.wrong += 1;
  }

  const current = getQuestionStats(question.id);
  state.progress.perQuestion[question.id] = {
    seen: current.seen + 1,
    correct: current.correct + (isCorrect ? 1 : 0),
    wrong: current.wrong + (isCorrect ? 0 : 1),
    streak: isCorrect ? current.streak + 1 : 0,
    lastSeenAt: new Date().toISOString(),
    category: question.category
  };

  persistProgress();
  renderDashboard();
}

function resetProgress() {
  state.progress = cloneValue(DEFAULT_PROGRESS);
  persistProgress();
  renderDashboard();

  if (state.currentMode === "exam") {
    resetStageToIdle("Pulsa \"Iniciar examen\" para comenzar una nueva simulación.");
    return;
  }

  startModeSession(state.currentMode);
}

function resetStageToIdle(message, isError = false) {
  clearExamTimer();
  state.exam.active = false;
  state.currentSession = [];
  state.currentIndex = 0;
  state.answeredCurrent = false;
  state.intensiveQueue = [];

  elements.questionCard.classList.add("hidden");
  elements.resultsCard.classList.add("hidden");
  elements.emptyState.classList.remove("hidden");
  elements.questionCounter.textContent = "Pregunta 0 / 0";
  renderTimer(EXAM_DURATION_SECONDS);
  hideFeedback();
  setNextButtonState(false);

  if (message) {
    showStatus(message, isError);
  } else {
    hideStatus();
  }
}

function showStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status ${isError ? "error" : "info"}`;
  elements.statusMessage.classList.remove("hidden");
}

function hideStatus() {
  elements.statusMessage.classList.add("hidden");
}

function renderTimer(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  elements.timer.textContent = `${minutes}:${seconds}`;
}

function persistProgress() {
  saveStoredJSON(STORAGE_KEYS.progress, state.progress);
}

function persistSettings() {
  saveStoredJSON(STORAGE_KEYS.settings, state.settings);
}

function loadStoredJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : cloneValue(fallback);
  } catch {
    return cloneValue(fallback);
  }
}

function saveStoredJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showStatus("No se ha podido guardar el progreso en este navegador.", true);
  }
}

function positiveInteger(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0;
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

