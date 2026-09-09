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
 *   3. results[]                   title + body + goFigureTieIn for each archetype
 *   4. resultMatrix                which archetype a given answer combo produces
 *
 * Scoring is a direct lookup, not additive weights: resultMatrix[q1AnswerId][q2AnswerId]
 * names the winning archetype for every one of the combinations, so there is no tie-break to
 * maintain. This does mean the matrix is inherently two-dimensional — adding a 3rd question
 * means nesting resultMatrix one level deeper (and updating score() below to read it), not
 * just appending to `questions`.
 *
 * Rules that keep the scoring honest — a mismatch throws loudly in the console
 * (and is rejected by the server) rather than silently mis-scoring someone:
 *
 *   - Every archetype id used in `resultMatrix` must be an id in `results`.
 *   - `resultMatrix` must have an entry for every q1 option crossed with every q2 option.
 *   - Option ids must be unique across the whole quiz (they are what gets POSTed).
 *   - `tag` is what Mailchimp sees. Changing a tag after launch orphans the
 *     automation attached to the old one, so rename in Mailchimp too.
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
     * Bumped by hand whenever the questions or scoring change in a way that makes old
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

    questions: [
      {
        id: 'q1',
        text: 'Your kid comes home and says they mastered twizzles today. You:',
        /* Optional supporting line under the question. Set to '' to hide it. */
        hint: '',
        options: [
          { id: 'A', text: 'Ask if it was just forward inside, or also outside and backwards?' },
          {
            id: 'B',
            text: 'Know they’ve been working on these for awhile and give them a high five!'
          },
          {
            id: 'C',
            text: 'Cheer enthusiastically, and sneakily Google “twizzle in skating” later'
          },
          { id: 'D', text: 'Think to yourself, “could this sport get any more complicated?”' }
        ]
      },
      {
        id: 'q2',
        text: "It's 8am Saturday and there's an early practice. You:",
        hint: '',
        options: [
          { id: '1', text: 'Are already there, rinkside with coffee, obviously' },
          {
            id: '2',
            text: 'Will catch the occasional session (if you have time between everything else you’re doing.)'
          },
          {
            id: '3',
            text: 'Believe practice is between my kid and their coach, I’m just there for competitions!'
          },
          { id: '4', text: "...wait, there's a practice this weekend?" }
        ]
      }
    ],

    /* Four archetypes. `body` is one or more paragraphs joined with "\n\n"; `goFigureTieIn` is
       the product-pitch paragraph shown as a separate callout on the result screen. */
    results: [
      {
        id: 'backseat-coach',
        title: 'The Backseat Coach',
        body:
          'You’re there for every practice, you know the sport inside and out, and honestly, half the other parents probably ask you what a twizzle is. Your skater never has to explain what just happened on the ice because you already saw it, understood it, and clocked whether the landing was clean. You are 100% invested in your child’s progress and, because of you, they have a great shot at achieving their dreams!\n\n' +
          'What’s genuinely hard about being this locked in: with this much time and attention invested, it’s easy to slip from “supportive” into “unofficial second coach,” and knowing when to step back and let the actual coach-skater relationship breathe can be the trickiest part of the job. Because even though you respect your kid’s coach, you are committed to being a part of the journey too.',
        goFigureTieIn:
          'This is where Go Figure can help: you can stay aligned with the coach on your kid’s goals, achievements, and progress videos even if you don’t get any more time with the coach than the 10 minutes during ice resurfacing. Every video and lesson note your skater’s coach sends lives permanently in your Go Figure account, so instead of trying to scroll through your camera roll, you’ve got a searchable archive to look back on and watch the progress compound.',
        tag: 'quiz-parent-backseat-coach'
      },
      {
        id: 'balancer',
        title: 'The Balancer',
        body:
          'Your kid’s skating is one ring in a much bigger circus (work, siblings, school, so many extracurriculars) and somehow you keep every ring spinning without dropping the ones that matter. You show up when it counts, you keep things in healthy perspective, and your skater is lucky to have a parent who treats this sport as part of their multi-faceted life instead of the whole thing.\n\n' +
          'The hard part: when you simply don’t have enough time to watch them skate, it’s easy to feel a beat behind; catching the highlights secondhand in the car ride home instead of seeing the actual progress happen. Your kid chose an incredibly complicated, time-consuming (and money-consuming) sport, and your ability to support a skating schedule among the many things you juggle is an accomplishment itself.',
        goFigureTieIn:
          'This is where Go Figure can help: We can sum up your skater’s progress in brief highlights, labeled video clips sent from the coach and lesson notes straight to your account, so you can catch up on your own time. You can look up a twizzle, see a video of your own kid mastering it, and feel the pride. You’ll even be able to see what level your kid is working on, and peek at what they’ll be doing next. Now you don’t have to be rinkside to stay looped in.',
        tag: 'quiz-parent-balancer'
      },
      {
        id: 'superfan',
        title: 'The Superfan!',
        body:
          'Nobody cheers louder, nobody’s prouder, and nobody makes a skater feel more supported walking off the ice than you! Whatever the results, whatever the level, your skater knows exactly one thing for certain: you’re their biggest fan, no notes attached.\n\n' +
          'Where it gets tricky: the technical side of the sport can feel like a foreign language sometimes — you know something great just happened, you’re just not always sure what, and that can leave you feeling one step removed from conversations other parents are having. You’ve kept up until this point, but it’s blind trust in the coach and your kid to explain what comes next.',
        goFigureTieIn:
          'This is where Go Figure can help: Not only can you explore for yourself all the different skating tracks and levels, with an interface built to be understood, you can also archive all your kid’s practice videos with names. Coaches can send labeled videos, lesson notes, and generally bring you along for the ride. So the next time something clicks on the ice, you’ll know exactly what to cheer for, not just that it was cheer-worthy.',
        tag: 'quiz-parent-superfan'
      },
      {
        id: 'goe-genius',
        title: 'The GOE Genius',
        body:
          'You speak skating fluently — GOE, spin levels, jump downgrades, base values, the works — and competition day is where you shine, tracking every score in real time like it’s your own event. Whether you used to be a competitive skater or you’re simply too smart to sit idly in the stands, you are giving the technical specialist a run for their money.\n\n' +
          'What’s tough: since you leave practice up to your kid and their coach, you miss the wins that don’t show up on a scoresheet. The jump they just landed for the first time that is nowhere near program-ready. The crazy new positions they’re trying out to level up their spins. Highlights that you hear about, but never see.',
        goFigureTieIn:
          'This is where Go Figure can help: practice videos and lesson notes capture that in-between story so you get the full arc of your skater’s season, not just the performance moments. And since you already know what you’re looking for, you can search for any element by name and see their whole journey from first attempt to competition-ready.',
        tag: 'quiz-parent-goe-genius'
      }
    ],

    /**
     * resultMatrix[q1AnswerId][q2AnswerId] = resultId
     * Direct lookup, not additive scoring — every one of the 16 combinations is mapped
     * explicitly, so there is nothing to tie-break.
     */
    resultMatrix: {
      A: { 1: 'backseat-coach', 2: 'backseat-coach', 3: 'goe-genius', 4: 'goe-genius' },
      B: { 1: 'backseat-coach', 2: 'goe-genius', 3: 'goe-genius', 4: 'goe-genius' },
      C: { 1: 'superfan', 2: 'superfan', 3: 'balancer', 4: 'balancer' },
      D: { 1: 'superfan', 2: 'balancer', 3: 'balancer', 4: 'balancer' }
    },

    /* The info-collection step shown after the last question. */
    form: {
      title: 'Where should we send it?',
      subtitle: 'Get your result plus the occasional Go Figure update. Unsubscribe anytime.',
      firstNameLabel: 'First name',
      lastNameLabel: 'Last name',
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
   * Catches the config mistakes that would otherwise show up as a wrong (or missing) archetype
   * in someone's inbox: a matrix cell pointing at an archetype that no longer exists, a missing
   * combination, or two options sharing an id.
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
      });
    });

    var q1 = QUIZ.questions[0];
    var q2 = QUIZ.questions[1];
    var referencedResultIds = {};

    if (q1 && q2) {
      q1.options.forEach(function (opt1) {
        var row = QUIZ.resultMatrix[opt1.id];
        if (!row) {
          problems.push('resultMatrix is missing an entry for "' + opt1.id + '"');
          return;
        }
        q2.options.forEach(function (opt2) {
          var resultId = row[opt2.id];
          if (!resultId) {
            problems.push(
              'resultMatrix["' + opt1.id + '"]["' + opt2.id + '"] is missing'
            );
            return;
          }
          referencedResultIds[resultId] = true;
          if (!RESULTS_BY_ID[resultId]) {
            problems.push(
              'resultMatrix["' + opt1.id + '"]["' + opt2.id + '"] points at unknown result "' +
                resultId + '"'
            );
          }
        });
      });
    }

    QUIZ.results.forEach(function (result) {
      if (!referencedResultIds[result.id]) {
        problems.push('result "' + result.id + '" is never produced by resultMatrix');
      }
    });

    return problems;
  }

  /**
   * Looks up the archetype for a completed quiz via resultMatrix — a direct lookup, not
   * additive scoring, so both answers must be present to produce a result.
   *
   * `answers` is an array of option ids in any order. Unknown ids are ignored rather than
   * throwing, so a stale QR link or an edited config can never 500 the submit route.
   *
   * Returns null when either question is unanswered or the combination has no mapped result.
   */
  function score(answers) {
    var byQuestion = {};
    (Array.isArray(answers) ? answers : []).forEach(function (optionId) {
      var entry = OPTIONS_BY_ID[optionId];
      if (!entry) return;
      byQuestion[entry.question.id] = optionId;
    });

    var q1 = QUIZ.questions[0];
    var q2 = QUIZ.questions[1];
    if (!q1 || !q2) return null;

    var a1 = byQuestion[q1.id];
    var a2 = byQuestion[q2.id];
    if (!a1 || !a2) return null;

    var row = QUIZ.resultMatrix[a1];
    var resultId = row && row[a2];
    return resultId ? RESULTS_BY_ID[resultId] || null : null;
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
