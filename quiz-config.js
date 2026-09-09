/**
 * quiz-config.js — the ONLY file to edit when the quiz copy arrives.
 *
 * Everything the quiz says, scores and tags lives in the QUIZ object below. The browser UI
 * (quiz.js) and the server route (api/quiz-submit.js) both read this same file, so the two
 * can never disagree about which answer maps to which archetype or which Mailchimp tag.
 *
 * Loaded two ways, which is why the wrapper at the bottom looks odd:
 *   browser — <script src="/quiz-config.js"> sets window.GO_FIGURE_QUIZ
 *   server  — require('../quiz-config.js') in api/quiz-submit.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THE REAL COPY ARRIVES, edit only these things:
 *
 *   1. questions[].text            the question wording
 *   2. questions[].options[].text  the answer wording
 *   3. questions[].options[].weights   points toward each archetype id
 *   4. results[]                   title + description for each archetype
 *   5. tieBreak                    archetype ids, highest priority first
 *
 * Rules that keep the scoring honest — a mismatch throws loudly in the console
 * (and is rejected by the server) rather than silently mis-scoring someone:
 *
 *   - Every key used in a `weights` object must be an id in `results`.
 *   - Every id in `results` must appear exactly once in `tieBreak`.
 *   - Option ids must be unique across the whole quiz (they are what gets POSTed).
 *   - `tag` is what Mailchimp sees. Changing a tag after launch orphans the
 *     automation attached to the old one, so rename in Mailchimp too.
 *
 * You can add a 7th archetype or a 3rd question by adding entries here. No component
 * code changes: the progress indicator, scoring and tie-break all read these arrays.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function (global, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) module.exports = built;
  else global.GO_FIGURE_QUIZ = built;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ─── The content ──────────────────────────────────────────────────────── */

  var QUIZ = {
    /**
     * Bumped by hand whenever the questions or weights change in a way that makes old
     * results incomparable. Sent to Mailchimp so a segment can tell "took v1" from
     * "took v2" instead of silently mixing two different quizzes together.
     */
    version: 1,

    banner: {
      /* The whole banner is the tappable CTA; this is the text inside it. */
      text: 'What type of skating parent are you?',
      cta: 'Take the 30-second quiz →',
      /* Screen-reader name for the × button. */
      dismissLabel: 'Dismiss the quiz banner for this visit'
    },

    /* PLACEHOLDER COPY — replace text and weights, keep the shape. */
    questions: [
      {
        id: 'q1',
        text: 'Question 1',
        /* Optional supporting line under the question. Set to '' to hide it. */
        hint: '',
        options: [
          { id: 'q1a1', text: 'Answer 1', weights: { coach: 2, logistics: 1 } },
          { id: 'q1a2', text: 'Answer 2', weights: { logistics: 2, planner: 1 } },
          { id: 'q1a3', text: 'Answer 3', weights: { hype: 2, cheer: 1 } },
          { id: 'q1a4', text: 'Answer 4', weights: { zen: 2, cheer: 1 } }
        ]
      },
      {
        id: 'q2',
        text: 'Question 2',
        hint: '',
        options: [
          { id: 'q2a1', text: 'Answer 1', weights: { coach: 2, planner: 1 } },
          { id: 'q2a2', text: 'Answer 2', weights: { logistics: 2, coach: 1 } },
          { id: 'q2a3', text: 'Answer 3', weights: { hype: 2, zen: 1 } },
          { id: 'q2a4', text: 'Answer 4', weights: { zen: 2, cheer: 1 } }
        ]
      }
    ],

    /* PLACEHOLDER COPY — six archetypes. Rename the ids freely, but rename them in
       `weights`, `tieBreak` and Mailchimp at the same time. */
    results: [
      {
        id: 'coach',
        title: 'Result 1 title',
        description: 'Result 1 description.',
        tag: 'quiz-parent-coach'
      },
      {
        id: 'logistics',
        title: 'Result 2 title',
        description: 'Result 2 description.',
        tag: 'quiz-parent-logistics'
      },
      {
        id: 'hype',
        title: 'Result 3 title',
        description: 'Result 3 description.',
        tag: 'quiz-parent-hype'
      },
      {
        id: 'zen',
        title: 'Result 4 title',
        description: 'Result 4 description.',
        tag: 'quiz-parent-zen'
      },
      {
        id: 'planner',
        title: 'Result 5 title',
        description: 'Result 5 description.',
        tag: 'quiz-parent-planner'
      },
      {
        id: 'cheer',
        title: 'Result 6 title',
        description: 'Result 6 description.',
        tag: 'quiz-parent-cheer'
      }
    ],

    /**
     * Tie-break priority, highest first. On an exact points tie the archetype that appears
     * earliest here wins. The first four are the order you specified; the two placeholder
     * archetypes sit at the end — move them once they have real names.
     */
    tieBreak: ['coach', 'logistics', 'hype', 'zen', 'planner', 'cheer'],

    /* The info-collection step shown after the last question. */
    form: {
      title: 'Where should we send it?',
      subtitle: 'Get your result plus the occasional Go Figure update. Unsubscribe anytime.',
      nameLabel: 'Name',
      nameOptionalHint: 'optional',
      emailLabel: 'Email',
      submitLabel: 'See my result',
      /**
       * The exact consent wording. The server records this string on the contact as the
       * evidence for single opt-in, so it must be the sentence actually shown — read from
       * here by both sides so the two cannot drift apart.
       */
      consentText:
        'Yes, email me my result and Go Figure updates. I can unsubscribe anytime.',
      privacyNote: 'We’ll never sell your information.'
    },

    /* Every other string the UI can show, so no copy is stranded in component code. */
    strings: {
      overlayLabel: 'What type of skating parent are you? quiz',
      /* {current} and {total} are substituted at render time. */
      progress: 'Question {current} of {total}',
      back: 'Back',
      close: 'Close quiz',
      resultEyebrow: 'You are',
      retake: 'Take the quiz again',
      sending: 'Saving your result…',
      saved: 'Sent to {email}. Check your inbox.',
      savedPending: 'Almost there — check your inbox for a confirmation link.',
      /* Shown on the result screen when the Mailchimp call failed. The result is already
         on screen at this point; this only offers to retry the save. */
      saveFailed: 'We couldn’t save your result just now.',
      retry: 'Try again',
      /* Returning taker: we already have their email from a previous run on this device. */
      knownContact: 'Sending to {email}.',
      changeEmail: 'Use a different email',
      blocked:
        'This address is unsubscribed, so we can’t re-add it from here. Email contact@gofigureapp.io and we’ll sort it out.',
      invalidEmail: 'Please enter a valid email address.',
      needConsent: 'Please tick the box so we can email you your result.'
    }
  };

  /* ─── The scoring (logic only — no copy below this line) ────────────────── */

  /** id -> result object, for O(1) lookups. */
  var RESULTS_BY_ID = {};
  QUIZ.results.forEach(function (result) {
    RESULTS_BY_ID[result.id] = result;
  });

  /** option id -> { question, option }, so an answer can be validated and scored. */
  var OPTIONS_BY_ID = {};
  QUIZ.questions.forEach(function (question) {
    question.options.forEach(function (option) {
      OPTIONS_BY_ID[option.id] = { question: question, option: option };
    });
  });

  /**
   * Catches the config mistakes that would otherwise show up as a wrong archetype in
   * someone's inbox: a weight pointing at an archetype that no longer exists, a result
   * missing from the tie-break order, or two options sharing an id.
   *
   * Returns a list of human-readable problems; empty means the config is coherent.
   */
  function validate() {
    var problems = [];
    var seenOptionIds = {};

    QUIZ.questions.forEach(function (question) {
      if (!question.options.length) problems.push(question.id + ' has no options');
      question.options.forEach(function (option) {
        if (seenOptionIds[option.id]) problems.push('duplicate option id: ' + option.id);
        seenOptionIds[option.id] = true;
        Object.keys(option.weights || {}).forEach(function (resultId) {
          if (!RESULTS_BY_ID[resultId]) {
            problems.push(option.id + ' has a weight for unknown result "' + resultId + '"');
          }
        });
      });
    });

    QUIZ.results.forEach(function (result) {
      if (QUIZ.tieBreak.indexOf(result.id) === -1) {
        problems.push('result "' + result.id + '" is missing from tieBreak');
      }
    });

    QUIZ.tieBreak.forEach(function (resultId) {
      if (!RESULTS_BY_ID[resultId]) {
        problems.push('tieBreak lists unknown result "' + resultId + '"');
      }
    });

    return problems;
  }

  /**
   * Adds up the weights of the chosen options and returns the winning result object.
   *
   * `answers` is an array of option ids (one per question, in question order). Unknown ids
   * are ignored rather than throwing, so a stale QR link or an edited config can never 500
   * the submit route — a partial answer set still produces a defensible result.
   *
   * Ties are broken by QUIZ.tieBreak order, not by object key order, which is why the totals
   * are read back through tieBreak rather than iterated directly.
   *
   * Returns null only when nothing scored at all (no recognised answers).
   */
  function score(answers) {
    var totals = {};
    QUIZ.results.forEach(function (result) {
      totals[result.id] = 0;
    });

    var scored = 0;
    (Array.isArray(answers) ? answers : []).forEach(function (optionId) {
      var entry = OPTIONS_BY_ID[optionId];
      if (!entry) return;
      scored += 1;
      Object.keys(entry.option.weights || {}).forEach(function (resultId) {
        if (totals[resultId] === undefined) return; // unknown archetype; validate() reports it
        totals[resultId] += entry.option.weights[resultId];
      });
    });

    if (!scored) return null;

    // Walk tieBreak in priority order and keep the first strictly-highest total, so an exact
    // tie resolves to whichever archetype is listed earlier.
    var winner = null;
    QUIZ.tieBreak.forEach(function (resultId) {
      if (winner === null || totals[resultId] > totals[winner]) winner = resultId;
    });

    return RESULTS_BY_ID[winner] || null;
  }

  /** True when every id is a real option and no two come from the same question. */
  function answersAreWellFormed(answers) {
    if (!Array.isArray(answers) || !answers.length) return false;
    if (answers.length > QUIZ.questions.length) return false;
    var seenQuestions = {};
    return answers.every(function (optionId) {
      var entry = OPTIONS_BY_ID[optionId];
      if (!entry || seenQuestions[entry.question.id]) return false;
      seenQuestions[entry.question.id] = true;
      return true;
    });
  }

  function resultById(id) {
    return RESULTS_BY_ID[id] || null;
  }

  /** Fills {placeholders} in a strings entry. */
  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values || {}, key) ? values[key] : match;
    });
  }

  return {
    QUIZ: QUIZ,
    score: score,
    validate: validate,
    resultById: resultById,
    answersAreWellFormed: answersAreWellFormed,
    fill: fill
  };
});
