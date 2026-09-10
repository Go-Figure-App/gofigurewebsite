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
 * SHAPE: a single gate question (`roleQuestion`) picks Parent or Coach, then that
 * answer's `flow` selects one of the two branches under `flows`. Each branch is a
 * self-contained quiz — its own questions, results and resultMatrix — so editing one
 * branch's copy or scoring can never accidentally affect the other.
 *
 * WHEN THE REAL COPY ARRIVES, edit only these things:
 *
 *   1. roleQuestion.options[].text     the "I am a:" wording
 *   2. flows[branch].questions[].text            the question wording
 *   3. flows[branch].questions[].options[].text  the answer wording
 *   4. flows[branch].results[]                   title + body + goFigureTieIn for each archetype
 *   5. flows[branch].resultMatrix                which archetype a given answer combo produces
 *
 * Scoring is a direct lookup, not additive weights: resultMatrix[q1AnswerId][q2AnswerId]
 * names the winning archetype for every one of the combinations, so there is no tie-break to
 * maintain. This does mean the matrix is inherently two-dimensional — adding a 3rd question
 * to a branch means nesting resultMatrix one level deeper (and updating score() below to read
 * it), not just appending to that branch's `questions`.
 *
 * Rules that keep the scoring honest — a mismatch throws loudly in the console
 * (and is rejected by the server) rather than silently mis-scoring someone:
 *
 *   - Every archetype id used in a branch's `resultMatrix` must be an id in that same
 *     branch's `results` — branches never share result ids.
 *   - `resultMatrix` must have an entry for every q1 option crossed with every q2 option.
 *   - Option ids (including roleQuestion's) must be unique across the WHOLE quiz, not just
 *     within a branch — they are what gets POSTed, and answers are matched to a branch by id
 *     alone, with no branch name sent alongside them.
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
     * Bumped by hand whenever a branch's questions or scoring change in a way that makes old
     * results incomparable. Sent to Mailchimp so a segment can tell "took v1" from
     * "took v2" instead of silently mixing two different quizzes together.
     */
    version: 1,

    banner: {
      /* The whole banner is the tappable CTA; this is the text inside it. */
      text: 'What type of skating coach or parent are you?',
      cta: 'Take the 30-second quiz →',
      /* Screen-reader name for the × button. */
      dismissLabel: 'Dismiss the quiz banner for this visit'
    },

    /**
     * The first thing everyone answers, before either branch's questions. `flow` on each
     * option is the key into `flows` below that the rest of the quiz continues into.
     */
    roleQuestion: {
      id: 'role',
      text: 'I am a:',
      hint: '',
      options: [
        { id: 'role-parent', text: 'Parent', flow: 'parent' },
        { id: 'role-coach', text: 'Coach', flow: 'coach' }
      ]
    },

    /**
     * One self-contained quiz per branch. Both currently run exactly 2 questions with 4
     * options each — score() and quiz.js's progress bar assume every branch has the same
     * question count, so keep it that way (or update both if a branch ever needs a 3rd).
     */
    flows: {
      parent: {
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

        /* Four archetypes. `body` is one or more paragraphs joined with "\n\n"; `goFigureTieIn`
           is the product-pitch paragraph shown as a separate callout on the result screen. */
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
        }
      },

      coach: {
        questions: [
          {
            id: 'q1',
            text: 'A competition is happening this weekend so, of course, you:',
            hint: '',
            options: [
              { id: 'E', text: 'Expect every one of your students to win their events, because you know they can' },
              {
                id: 'F',
                text: 'Are running around all day long fixing hair, chatting with parents, overseeing off ice warmups, and have extra tights and bandaids in your bag'
              },
              { id: 'G', text: 'Swing by for a few events because (thankfully!) you’re not the main coach' },
              {
                id: 'H',
                text: 'Make sure all of your students know it’s enough to try their best and have fun, because isn’t that the point?'
              }
            ]
          },
          {
            id: 'q2',
            text: 'Your skater made a silly mistake in their program that cost them the podium, you say:',
            hint: '',
            options: [
              { id: '5', text: '“This is unacceptable and will never happen again under my watch.”' },
              { id: '6', text: 'Nothing, they know what they did and we will talk about it next practice' },
              { id: '7', text: '“At least you nailed your combo spin!”' },
              { id: '8', text: '“It’s okay, mistakes happen and medaling isn’t the only thing that matters.”' }
            ]
          }
        ],

        results: [
          {
            id: 'traditionalist',
            title: 'The Traditionalist',
            body:
              'You’ve been doing this a long time, and it shows! Your standards are exacting, your students know exactly what’s expected of them, and when they rise to meet it, the results speak for themselves. You didn’t get this good at coaching by going soft on mistakes, and your athletes respect that they’re being pushed toward something real.\n\n' +
              'What’s tough about holding the line this firmly: you know that you have done everything in your power to set your skaters up for success, so when a skater experiences a failure, you feel it too. And even though you’ve done everything right, some parents don’t understand why their skater didn’t win gold.',
            goFigureTieIn:
              'This is where Go Figure can help: every lesson note and video clip uploaded from practice becomes the evidence of a skaters’ excellence and readiness to compete. Parents stay updated without any extra time out of your busy schedule. High standards, backed by hard evidence.',
            tag: 'quiz-coach-traditionalist'
          },
          {
            id: 'specialist',
            title: 'The Specialist',
            body:
              'You know your lane, and you know it cold. Whether it’s choreography, spins or jumps, students get the best, targeted expertise from you; the kind that only comes from narrowing in on one thing and getting exceptional at teaching it.\n\n' +
              'The tricky part: since you’re not the main coach carrying overall responsibility for the student’s season, you don’t get the full picture of their progress. You’re invested in every skater you’ve worked with, but rarely get the satisfaction of seeing the results.',
            goFigureTieIn:
              'This is where Go Figure can help: the video clips from your skater’s practices are tagged by element name and shared securely with their coaches. So even if you’re across the country and haven’t seen a skater in months, you can watch their recent achievements and cheer them on (or message them a much-needed correction)!',
            tag: 'quiz-coach-specialist'
          },
          {
            id: 'all-inclusive',
            title: 'The All Inclusive (aka Second Mom)',
            body:
              'You’re the whole package! You will do anything for your students if it will help them skate. That includes a million thankless jobs off the ice: doing hair and makeup, looking up skaters’ USFS number and test history, running off ice, lending gloves and hair ties, coordinating amongst the parents, and setting up sessions with specialists and choreographers. Your students and their families don’t just get a coach, they get someone who genuinely holds the whole experience together.\n\n' +
              'Where it gets hard: with this much ground to cover, it’s tough to find time to communicate with the parents as much as they’d like. Sure, they’re footing the bill, but the skater is your primary concern and you need the parents to sit back into their support role and trust your process.',
            goFigureTieIn:
              'This is where Go Figure can help: the app serves as your bridge between parents, sharing lesson notes and video clips with parents so they can answer their own questions at home with their skater. By cutting down on the time you spend texting parents, sending videos and hand-writing warmup exercises, you’ll have more space for what matters – your skaters.',
            tag: 'quiz-coach-all-inclusive'
          },
          {
            id: 'morale-booster',
            title: 'The Morale Booster',
            body:
              'Nobody builds confidence like you. You’re the coach who reminds a student that mistakes happen, that medaling isn’t the whole point, and that loving the sport matters more than any single score. Students who train with you don’t just get better, they stay in love with skating, which is the thing that actually keeps kids in this sport long-term.\n\n' +
              'What’s hard about leading with encouragement first: it can be tougher to have the harder technical conversations, or to point to concrete proof of growth when the focus is more on feeling good than tracking metrics. Parents also bring their own expectations, which can add a layer of pressure on the skater, and you as a coach, when the results aren’t what they expected.',
            goFigureTieIn:
              'This is where Go Figure can help: video clips documenting progress over time can be tagged by element and searched or sorted, so the second a parent questions your methods or a skater starts to get down on themself, you have hard evidence of their growth! We empower you with the proof that your coaching method gets the most important results: progress and the motivation to continue skating.',
            tag: 'quiz-coach-morale-booster'
          }
        ],

        /**
         * resultMatrix[q1AnswerId][q2AnswerId] = resultId
         * q1 option ids E/F/G/H correspond, in order, to the 1/2/3/4 answers to "A competition
         * is happening this weekend..."; q2 option ids 5/6/7/8 correspond, in order, to the
         * A/B/C/D answers to "Your skater made a silly mistake...". Values below are a direct
         * transcription of the supplied mapping.
         */
        resultMatrix: {
          E: { 5: 'traditionalist', 6: 'traditionalist', 7: 'traditionalist', 8: 'all-inclusive' },
          F: { 5: 'traditionalist', 6: 'all-inclusive', 7: 'specialist', 8: 'all-inclusive' },
          G: { 5: 'morale-booster', 6: 'all-inclusive', 7: 'specialist', 8: 'morale-booster' },
          H: { 5: 'morale-booster', 6: 'morale-booster', 7: 'specialist', 8: 'morale-booster' }
        }
      }
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
      overlayLabel: 'What type of skating coach or parent are you? quiz',
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

  /** roleQuestion option id -> flow key, e.g. 'role-coach' -> 'coach'. */
  var FLOW_BY_ROLE_OPTION = {};
  QUIZ.roleQuestion.options.forEach(function (option) {
    FLOW_BY_ROLE_OPTION[option.id] = option.flow;
  });

  var FLOW_KEYS = Object.keys(QUIZ.flows);

  /**
   * Per-branch lookup tables, built once. `resultsById`: id -> result object. `optionsById`:
   * option id -> { question, option }, scoped to that branch, so a branch can never be scored
   * against another branch's question.
   */
  FLOW_KEYS.forEach(function (flowKey) {
    var flow = QUIZ.flows[flowKey];

    flow.resultsById = {};
    flow.results.forEach(function (result) {
      flow.resultsById[result.id] = result;
    });

    flow.optionsById = {};
    flow.questions.forEach(function (question) {
      question.options.forEach(function (option) {
        flow.optionsById[option.id] = { question: question, option: option };
      });
    });
  });

  /**
   * Catches the config mistakes that would otherwise show up as a wrong (or missing) archetype
   * in someone's inbox: a matrix cell pointing at an archetype that no longer exists, a missing
   * combination, an option id reused across branches, or two options sharing an id.
   *
   * Returns a list of human-readable problems; empty means the config is coherent.
   */
  function validate() {
    var problems = [];
    var seenOptionIds = {};

    QUIZ.roleQuestion.options.forEach(function (option) {
      if (seenOptionIds[option.id]) problems.push('duplicate option id: ' + option.id);
      seenOptionIds[option.id] = true;
      if (!option.flow || !QUIZ.flows[option.flow]) {
        problems.push('roleQuestion option "' + option.id + '" points at unknown flow "' + option.flow + '"');
      }
    });

    var flowQuestionCount = null;

    FLOW_KEYS.forEach(function (flowKey) {
      var flow = QUIZ.flows[flowKey];

      if (flowQuestionCount === null) flowQuestionCount = flow.questions.length;
      else if (flow.questions.length !== flowQuestionCount) {
        problems.push(
          'flow "' + flowKey + '" has ' + flow.questions.length +
            ' questions, but other flows have ' + flowQuestionCount +
            ' — quiz.js assumes every branch is the same length'
        );
      }

      flow.questions.forEach(function (question) {
        if (!question.options.length) problems.push(flowKey + '.' + question.id + ' has no options');
        question.options.forEach(function (option) {
          if (seenOptionIds[option.id]) problems.push('duplicate option id: ' + option.id);
          seenOptionIds[option.id] = true;
        });
      });

      var q1 = flow.questions[0];
      var q2 = flow.questions[1];
      var referencedResultIds = {};

      if (q1 && q2) {
        q1.options.forEach(function (opt1) {
          var row = flow.resultMatrix[opt1.id];
          if (!row) {
            problems.push(flowKey + ': resultMatrix is missing an entry for "' + opt1.id + '"');
            return;
          }
          q2.options.forEach(function (opt2) {
            var resultId = row[opt2.id];
            if (!resultId) {
              problems.push(
                flowKey + ': resultMatrix["' + opt1.id + '"]["' + opt2.id + '"] is missing'
              );
              return;
            }
            referencedResultIds[resultId] = true;
            if (!flow.resultsById[resultId]) {
              problems.push(
                flowKey + ': resultMatrix["' + opt1.id + '"]["' + opt2.id + '"] points at unknown result "' +
                  resultId + '"'
              );
            }
          });
        });
      }

      flow.results.forEach(function (result) {
        if (!referencedResultIds[result.id]) {
          problems.push(flowKey + ': result "' + result.id + '" is never produced by resultMatrix');
        }
      });
    });

    return problems;
  }

  /**
   * Looks up the archetype for a completed quiz. `answers` is an array of option ids in any
   * order — the role answer picks which branch scores the rest, then that branch's
   * resultMatrix is a direct lookup, not additive scoring, so both of its questions must be
   * present to produce a result.
   *
   * Unknown ids are ignored rather than throwing, so a stale QR link or an edited config can
   * never 500 the submit route.
   *
   * Returns null when the role, or either of that branch's two questions, is unanswered, or
   * the combination has no mapped result. The returned object is a shallow copy of the matched
   * result with a `flow` key added (the branch key, e.g. 'parent' or 'coach') — never the
   * shared result object itself, since that is reused across requests in a warm container.
   */
  function score(answers) {
    var list = Array.isArray(answers) ? answers : [];

    var flowKey = null;
    list.forEach(function (id) {
      if (FLOW_BY_ROLE_OPTION[id]) flowKey = FLOW_BY_ROLE_OPTION[id];
    });
    var flow = flowKey && QUIZ.flows[flowKey];
    if (!flow) return null;

    var byQuestion = {};
    list.forEach(function (optionId) {
      var entry = flow.optionsById[optionId];
      if (!entry) return;
      byQuestion[entry.question.id] = optionId;
    });

    var q1 = flow.questions[0];
    var q2 = flow.questions[1];
    if (!q1 || !q2) return null;

    var a1 = byQuestion[q1.id];
    var a2 = byQuestion[q2.id];
    if (!a1 || !a2) return null;

    var row = flow.resultMatrix[a1];
    var resultId = row && row[a2];
    var result = resultId ? flow.resultsById[resultId] : null;
    if (!result) return null;

    // A shallow copy, not the shared result object itself — that object is reused across
    // requests in a warm container, so mutating it (or callers assuming a fresh object) would
    // leak `flow` (or anything else) between unrelated submissions.
    var withFlow = {};
    Object.keys(result).forEach(function (key) {
      withFlow[key] = result[key];
    });
    withFlow.flow = flowKey;
    return withFlow;
  }

  /**
   * True when `answers` contains exactly one valid roleQuestion option, plus valid options for
   * that branch with no two from the same question.
   */
  function answersAreWellFormed(answers) {
    if (!Array.isArray(answers) || !answers.length) return false;

    var flowKey = null;
    var roleCount = 0;
    answers.forEach(function (id) {
      if (FLOW_BY_ROLE_OPTION[id]) {
        roleCount += 1;
        flowKey = FLOW_BY_ROLE_OPTION[id];
      }
    });
    if (roleCount !== 1) return false;

    var flow = QUIZ.flows[flowKey];
    if (!flow) return false;
    if (answers.length > flow.questions.length + 1) return false;

    var seenQuestions = {};
    return answers.every(function (optionId) {
      if (FLOW_BY_ROLE_OPTION[optionId]) return true; // already counted above
      var entry = flow.optionsById[optionId];
      if (!entry || seenQuestions[entry.question.id]) return false;
      seenQuestions[entry.question.id] = true;
      return true;
    });
  }

  /** Looks up a result by id within one specific branch. */
  function resultById(flowKey, id) {
    var flow = QUIZ.flows[flowKey];
    return (flow && flow.resultsById[id]) || null;
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
