/**
 * quiz.js — the "What type of skating coach or parent are you?" banner and full-screen quiz.
 *
 * Every string, question, result and Mailchimp tag comes from quiz-config.js. Nothing in this
 * file needs editing to change copy, add a question or add an archetype.
 *
 * The first question is always QUIZ.roleQuestion ("I am a: Parent / Coach"); its answer picks
 * which of QUIZ.flows the remaining questions come from. Both branches are assumed to have the
 * same question count (quiz-config.js's validate() checks this), so `state.step` can address
 * "the role question, then N flow questions" without the progress bar needing to know which
 * branch is active.
 *
 * Builds its own DOM rather than expecting markup in the page, so each HTML file only needs the
 * two script tags — nothing to keep in sync across index/privacy/terms.
 *
 * Traffic is mostly QR codes scanned at rinks, which shapes three decisions:
 *   - `?quiz=open` skips the banner and opens the quiz on load; that is what the codes link to.
 *   - Dismissal is sessionStorage, so it comes back next visit and nobody accidentally hides it
 *     forever on the phone they scan with.
 *   - A returning taker's email is remembered in localStorage so a retake skips the form. See
 *     `rememberedContact` below.
 *
 * ES5-flavoured and dependency-free to match the rest of the site, which ships unbundled.
 */
(function () {
  'use strict';

  var engine = window.GO_FIGURE_QUIZ;
  if (!engine || !engine.QUIZ) return; // config failed to load; leave the page untouched

  var QUIZ = engine.QUIZ;
  var STRINGS = QUIZ.strings;
  var fill = engine.fill;

  // Surfaces a broken config immediately in the console instead of as a wrong archetype in
  // someone's inbox a week later.
  var problems = engine.validate();
  if (problems.length) {
    console.error('quiz-config.js problems:\n  ' + problems.join('\n  '));
  }

  /** sessionStorage: cleared when the tab closes, so the banner returns on the next visit. */
  var BANNER_KEY = 'gf-quiz-banner-dismissed';
  /** localStorage: survives across visits so a retake can skip the sign-up step. */
  var CONTACT_KEY = 'gf-quiz-contact';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/; // same test the server runs

  /* ─── Storage (every access guarded: Safari private mode throws) ─────────── */

  function readStore(store, key) {
    try {
      return window[store].getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writeStore(store, key, value) {
    try {
      window[store].setItem(key, value);
    } catch (err) {
      /* Full or blocked storage is not a reason to break the quiz. */
    }
  }

  function clearStore(store, key) {
    try {
      window[store].removeItem(key);
    } catch (err) {
      /* ignore */
    }
  }

  /**
   * The remembered taker. Only written after a submission we know Mailchimp accepted, and only
   * when they actually ticked consent — so skipping the form on a retake never invents an opt-in
   * that did not happen.
   */
  function rememberedContact() {
    var raw = readStore('localStorage', CONTACT_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (parsed && EMAIL_RE.test(parsed.email || '') && parsed.consentedAt) return parsed;
    } catch (err) {
      /* Corrupt entry — fall through and treat them as a new taker. */
    }
    return null;
  }

  function rememberContact(contact) {
    writeStore(
      'localStorage',
      CONTACT_KEY,
      JSON.stringify({
        email: contact.email,
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        consentedAt: new Date().toISOString()
      })
    );
  }

  /* ─── Tiny DOM helper ────────────────────────────────────────────────────── */

  /**
   * el('button', { class: 'x', onclick: fn }, ['text']) — text children are set as text nodes,
   * never innerHTML, so an apostrophe or ampersand in the copy can never break the markup.
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key.indexOf('on') === 0 && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (key === 'text') {
        node.textContent = value;
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function prefersReducedMotion() {
    return (
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /* ─── State ──────────────────────────────────────────────────────────────── */

  /**
   * `step` 0 is always the role question; steps 1..N are questions[step - 1] of whichever flow
   * `state.flowKey` names. Once step reaches totalQuestionSteps() the flow moves to 'form' (or
   * straight to 'result' for a remembered taker). Held in memory rather than storage: closing
   * the overlay keeps your place for this pageview, a reload starts fresh.
   */
  var state = {
    open: false,
    step: 0,
    screen: 'question', // 'question' | 'form' | 'result'
    flowKey: null, // 'parent' | 'coach' | null until the role question is answered
    answers: [], // option ids: [roleOptionId, ...flow question option ids], index-aligned to step
    result: null, // the scored result object once known
    submitting: false,
    /** null | 'saved' | 'pending' | 'blocked' | 'failed' — drives the note on the result screen. */
    saveState: null,
    saveError: '',
    /** Set when a remembered taker chose "use a different email" this run. */
    forceForm: false,
    /**
     * The contact the in-flight submission was made with. Needed because a FIRST-time taker is
     * only written to localStorage once Mailchimp accepts them — so on a failure there is no
     * remembered contact for the retry button to re-post.
     */
    pendingContact: null,
    lastFocused: null,
    scrollY: 0
  };

  /* ─── Banner ─────────────────────────────────────────────────────────────── */

  var banner = null;

  function bannerDismissed() {
    return readStore('sessionStorage', BANNER_KEY) === '1';
  }

  /**
   * Publishes the banner's real rendered height as a CSS variable so the fixed nav sits below it
   * and the hero clears both. Measured rather than hard-coded because the copy wraps to two
   * lines on narrow phones.
   */
  function syncBannerHeight() {
    // Checked via the `hidden` flag, NOT offsetParent: the banner is position:fixed, and a
    // fixed element always reports a null offsetParent even when it is plainly on screen.
    // Using offsetParent here left the variable at 0 and the nav sat on top of the banner.
    var height = banner && !banner.hidden ? banner.offsetHeight : 0;
    document.documentElement.style.setProperty('--quiz-banner-h', height + 'px');
  }

  function showBanner() {
    if (!banner || bannerDismissed()) return;
    banner.hidden = false;
    document.body.classList.add('has-quiz-banner');
    syncBannerHeight();
  }

  function hideBanner() {
    if (!banner) return;
    banner.hidden = true;
    document.body.classList.remove('has-quiz-banner');
    syncBannerHeight();
  }

  function dismissBanner() {
    writeStore('sessionStorage', BANNER_KEY, '1');
    hideBanner();
  }

  function buildBanner() {
    var dismiss = el('button', {
      type: 'button',
      class: 'quiz-banner-dismiss',
      'aria-label': QUIZ.banner.dismissLabel,
      onclick: function (event) {
        // The whole banner is clickable, so stop this from also opening the quiz.
        event.stopPropagation();
        dismissBanner();
      }
    });
    dismiss.innerHTML = '<span aria-hidden="true">&times;</span>';

    // <button> wrapping the copy rather than a clickable <div>: it is keyboard-reachable and
    // announced as a control for free. The × sits outside it — a button inside a button is
    // invalid and browsers drop one of them.
    var cta = el('button', {
      type: 'button',
      class: 'quiz-banner-cta',
      onclick: function () {
        openQuiz('banner');
      }
    }, [
      el('span', { class: 'quiz-banner-text', text: QUIZ.banner.text }),
      el('span', { class: 'quiz-banner-action', text: QUIZ.banner.cta })
    ]);

    banner = el('div', { class: 'quiz-banner', hidden: true }, [cta, dismiss]);
    document.body.insertBefore(banner, document.body.firstChild);

    if (window.ResizeObserver) {
      new window.ResizeObserver(syncBannerHeight).observe(banner);
    } else {
      window.addEventListener('resize', syncBannerHeight);
    }
  }

  /* ─── Overlay shell ──────────────────────────────────────────────────────── */

  var overlay = null;
  var overlayBody = null;
  var overlayProgress = null;
  var overlayBar = null;
  var backButton = null;
  var liveRegion = null;

  function buildOverlay() {
    backButton = el('button', {
      type: 'button',
      class: 'quiz-nav-btn quiz-back',
      onclick: goBack
    }, [
      el('span', { 'aria-hidden': 'true', text: '←' }),
      el('span', { text: ' ' + STRINGS.back })
    ]);

    var closeButton = el('button', {
      type: 'button',
      class: 'quiz-nav-btn quiz-close',
      'aria-label': STRINGS.close,
      onclick: function () {
        closeQuiz();
      }
    });
    closeButton.innerHTML = '<span aria-hidden="true">&times;</span>';

    overlayProgress = el('p', { class: 'quiz-progress', id: 'quiz-progress' });
    overlayBar = el('div', { class: 'quiz-bar-fill' });

    // aria-live on a separate node so progress changes are announced without moving focus
    // away from the question heading.
    liveRegion = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });

    overlayBody = el('div', { class: 'quiz-body' });

    overlay = el('div', {
      class: 'quiz-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': STRINGS.overlayLabel,
      hidden: true
    }, [
      el('div', { class: 'quiz-shell' }, [
        el('header', { class: 'quiz-head' }, [
          el('div', { class: 'quiz-head-row' }, [backButton, overlayProgress, closeButton]),
          el('div', { class: 'quiz-bar', 'aria-hidden': 'true' }, [overlayBar])
        ]),
        overlayBody,
        liveRegion
      ])
    ]);

    overlay.addEventListener('keydown', onOverlayKeydown);
    document.body.appendChild(overlay);
  }

  /** Esc closes; Tab is trapped inside the dialog so focus can't wander to the hidden page. */
  function onOverlayKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeQuiz();
      return;
    }
    if (event.key !== 'Tab') return;

    // offsetParent filters out the back button while it is hidden — trapping onto a control
    // that cannot take focus would drop focus out of the dialog entirely.
    var focusable = Array.prototype.filter.call(
      overlay.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      ),
      function (node) {
        return node.offsetParent !== null;
      }
    );
    if (!focusable.length) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * Hides the rest of the page from assistive tech and pointer input while the quiz is up.
   * `inert` does both in one attribute; the aria-hidden fallback covers older Safari, where the
   * CSS overlay still blocks pointer input.
   */
  function setBackgroundInert(inert) {
    var supportsInert = 'inert' in HTMLElement.prototype;
    Array.prototype.forEach.call(document.body.children, function (child) {
      if (child === overlay) return;
      if (supportsInert) {
        child.inert = inert;
      } else if (inert) {
        child.setAttribute('aria-hidden', 'true');
      } else {
        child.removeAttribute('aria-hidden');
      }
    });
  }

  /* ─── Open / close ───────────────────────────────────────────────────────── */

  function openQuiz(source) {
    if (state.open) return;
    state.open = true;
    state.lastFocused = document.activeElement;

    // Read the scroll offset BEFORE anything sets position:fixed on the body — doing so
    // collapses the page scroll to 0, and capturing it afterwards recorded 0 every time,
    // so closing the overlay dumped the visitor back at the top of the page.
    state.scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

    overlay.hidden = false;
    document.body.classList.add('quiz-open');
    setBackgroundInert(true);

    // position:fixed rather than overflow:hidden — iOS Safari scrolls the page behind an
    // overflow-hidden body, which would drag the quiz around under the user's thumb. The
    // offset keeps the frozen page visually where it was.
    document.body.style.top = -state.scrollY + 'px';

    // Opened straight from a QR link: no banner was ever shown, and it must not appear behind
    // the overlay or when they close it mid-session.
    if (source === 'query') dismissBanner();

    render();
  }

  function closeQuiz() {
    if (!state.open) return;
    state.open = false;

    overlay.hidden = true;
    document.body.classList.remove('quiz-open');
    document.body.style.top = '';
    setBackgroundInert(false);

    // Bring the banner back BEFORE restoring the scroll offset. It stays gone if it was
    // dismissed; when it returns it adds its own height back to the top of the page, and
    // scrolling first would land the visitor one banner-height off from where they left.
    showBanner();

    // styles.css sets scroll-behavior: smooth on <html>, which would animate this restore
    // into a visible lurch down the page. Suspend it for the jump back.
    var htmlStyle = document.documentElement.style;
    var previousBehavior = htmlStyle.scrollBehavior;
    htmlStyle.scrollBehavior = 'auto';
    window.scrollTo(0, state.scrollY);
    htmlStyle.scrollBehavior = previousBehavior;

    if (state.lastFocused && document.contains(state.lastFocused)) {
      state.lastFocused.focus();
    }
  }

  /* ─── Flow ───────────────────────────────────────────────────────────────── */

  /** True when this taker still has to hand over an email. */
  function needsForm() {
    return state.forceForm || !rememberedContact();
  }

  function activeFlow() {
    return state.flowKey ? QUIZ.flows[state.flowKey] : null;
  }

  /**
   * The current question's copy: the role question at step 0, otherwise the active flow's
   * question at step - 1. Every branch has the same question count (quiz-config.js's validate()
   * checks this), so this only needs the active flow once step > 0.
   */
  function questionForStep(step) {
    if (step === 0) return QUIZ.roleQuestion;
    var flow = activeFlow();
    return flow && flow.questions[step - 1];
  }

  /** Role question + however many questions a flow branch has (both branches match). */
  function totalQuestionSteps() {
    return 1 + QUIZ.flows[Object.keys(QUIZ.flows)[0]].questions.length;
  }

  /**
   * Steps shown in the progress indicator: the role question, each flow question, plus the
   * sign-up step when it is going to be shown. A remembered taker sees "Question 1 of 3", not a
   * phantom extra step.
   */
  function totalSteps() {
    return totalQuestionSteps() + (needsForm() ? 1 : 0);
  }

  function chooseOption(questionIndex, optionId) {
    if (questionIndex === 0) {
      var chosenRoleOption = QUIZ.roleQuestion.options.filter(function (option) {
        return option.id === optionId;
      })[0];
      var newFlowKey = chosenRoleOption && chosenRoleOption.flow;
      // Changing the role answer (including on a "Back" from further in) invalidates any
      // flow-question answers already given for the OTHER branch, so drop them rather than
      // letting a stale coach answer score a parent submission or vice versa.
      if (newFlowKey !== state.flowKey) {
        state.flowKey = newFlowKey;
        state.answers = [];
      }
    }

    state.answers[questionIndex] = optionId;
    render(); // paints the selected state before the advance below

    var advance = function () {
      if (questionIndex + 1 < totalQuestionSteps()) {
        state.step = questionIndex + 1;
        state.screen = 'question';
      } else if (needsForm()) {
        state.screen = 'form';
      } else {
        // Remembered taker: score now and save in the background while they read the result.
        finishWithRememberedContact();
        return;
      }
      render();
    };

    // A beat so the tap registers visibly before the screen changes — skipped for anyone who
    // has asked for reduced motion, and short enough not to feel laggy.
    if (prefersReducedMotion()) advance();
    else window.setTimeout(advance, 180);
  }

  function goBack() {
    if (state.screen === 'result') {
      // Back from the result returns to the last question rather than the form, so they can
      // change an answer; the form (if any) will be offered again on the way forward.
      state.screen = 'question';
      state.step = totalQuestionSteps() - 1;
    } else if (state.screen === 'form') {
      state.screen = 'question';
      state.step = totalQuestionSteps() - 1;
    } else if (state.step > 0) {
      state.step -= 1;
    }
    render();
  }

  function resetQuiz() {
    state.step = 0;
    state.screen = 'question';
    state.flowKey = null;
    state.answers = [];
    state.result = null;
    state.submitting = false;
    state.saveState = null;
    state.saveError = '';
    state.forceForm = false;
    state.pendingContact = null;
    render();
  }

  /* ─── Submission ─────────────────────────────────────────────────────────── */

  /**
   * Scores locally so the result can be shown even if the network call fails — the brief is
   * that a Mailchimp outage must never cost someone their result. The server scores the same
   * answers again independently and is the authority on which tag gets applied.
   */
  function scoreNow() {
    state.result = engine.score(state.answers);
    return state.result;
  }

  function submit(contact) {
    state.pendingContact = contact;
    state.submitting = true;
    state.saveState = null;
    state.saveError = '';
    render();

    return fetch('/api/quiz-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: state.answers,
        firstName: contact.firstName || '',
        lastName: contact.lastName || '',
        email: contact.email,
        consent: true,
        company: contact.company || '' // honeypot; empty for a remembered taker
      })
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, body: body || {} };
        });
      })
      .then(function (result) {
        // `blocked` means Mailchimp will never accept this address (a compliance hold, or a
        // contact that was permanently deleted). Handle it before the throw below, so the
        // result screen explains the situation instead of offering a retry that cannot work.
        if (result.body.blocked) {
          state.submitting = false;
          state.saveState = 'blocked';
          if (result.body.error) state.saveError = result.body.error;
          render();
          return;
        }

        if (!result.ok || !result.body.ok) {
          throw new Error(result.body.error || 'Something went wrong.');
        }

        state.submitting = false;

        if (result.body.blocked) {
          state.saveState = 'blocked';
        } else if (result.body.pending) {
          state.saveState = 'pending';
        } else {
          state.saveState = 'saved';
        }

        // Only remembered once Mailchimp has actually accepted them, and never for an
        // unsubscribed address — otherwise a retake would silently skip the form and post to an
        // endpoint that will refuse them again.
        if (!result.body.blocked) rememberContact(contact);

        render();
      })
      .catch(function (error) {
        state.submitting = false;
        state.saveState = 'failed';
        state.saveError = error.message;
        render();
      });
  }

  /** Last-question path for a taker we already have an email for. */
  function finishWithRememberedContact() {
    var contact = rememberedContact();
    scoreNow();
    state.screen = 'result';
    render();
    if (contact) submit(contact);
  }

  /* ─── Screens ────────────────────────────────────────────────────────────── */

  function renderQuestion() {
    var index = state.step;
    var question = questionForStep(index);
    var chosen = state.answers[index];

    var heading = el('h2', {
      class: 'quiz-question',
      id: 'quiz-q-' + question.id,
      tabindex: '-1',
      text: question.text
    });

    var options = question.options.map(function (option) {
      return el('button', {
        type: 'button',
        class: 'quiz-option' + (chosen === option.id ? ' is-chosen' : ''),
        'aria-pressed': chosen === option.id ? 'true' : 'false',
        onclick: function () {
          chooseOption(index, option.id);
        }
      }, [el('span', { class: 'quiz-option-text', text: option.text })]);
    });

    return [
      heading,
      question.hint ? el('p', { class: 'quiz-hint', text: question.hint }) : null,
      el('div', {
        class: 'quiz-options',
        role: 'group',
        'aria-labelledby': 'quiz-q-' + question.id
      }, options)
    ];
  }

  function renderForm() {
    var heading = el('h2', {
      class: 'quiz-question',
      id: 'quiz-form-heading',
      tabindex: '-1',
      text: QUIZ.form.title
    });

    var firstNameInput = el('input', {
      type: 'text',
      id: 'quiz-first-name',
      name: 'firstName',
      autocomplete: 'given-name'
    });

    var lastNameInput = el('input', {
      type: 'text',
      id: 'quiz-last-name',
      name: 'lastName',
      autocomplete: 'family-name'
    });

    var emailInput = el('input', {
      type: 'email',
      id: 'quiz-email',
      name: 'email',
      autocomplete: 'email',
      required: true,
      'aria-describedby': 'quiz-form-status'
    });

    var consentInput = el('input', { type: 'checkbox', id: 'quiz-consent' });

    // Honeypot: hidden from people, catnip for bots. Positioned off-screen rather than
    // display:none, which some bots skip.
    var honeypot = el('input', {
      type: 'text',
      id: 'quiz-company',
      name: 'company',
      tabindex: '-1',
      autocomplete: 'off'
    });

    var status = el('p', {
      class: 'quiz-form-status',
      id: 'quiz-form-status',
      role: 'status',
      'aria-live': 'polite'
    });

    var submitButton = el('button', {
      type: 'submit',
      class: 'btn btn-ice quiz-submit',
      disabled: true,
      text: QUIZ.form.submitLabel
    });

    // Email + consent gate the button; first/last name are optional. It ships disabled and is
    // only switched on here, so it stays off if anything above throws.
    function syncSubmit() {
      submitButton.disabled = !consentInput.checked || !emailInput.value.trim();
    }
    consentInput.addEventListener('change', syncSubmit);
    emailInput.addEventListener('input', syncSubmit);

    var form = el('form', {
      class: 'quiz-form',
      novalidate: true,
      onsubmit: function (event) {
        event.preventDefault();

        var email = emailInput.value.trim();
        if (!EMAIL_RE.test(email)) {
          status.textContent = STRINGS.invalidEmail;
          status.className = 'quiz-form-status is-error';
          emailInput.focus();
          return;
        }
        if (!consentInput.checked) {
          status.textContent = STRINGS.needConsent;
          status.className = 'quiz-form-status is-error';
          consentInput.focus();
          return;
        }

        // Scored and shown before the network call returns, so a Mailchimp failure costs them
        // nothing but a retry button.
        scoreNow();
        state.screen = 'result';
        submit({
          firstName: firstNameInput.value.trim(),
          lastName: lastNameInput.value.trim(),
          email: email,
          company: honeypot.value
        });
      }
    }, [
      el('p', { class: 'quiz-form-sub', text: QUIZ.form.subtitle }),
      el('div', { class: 'field' }, [
        el('label', { for: 'quiz-first-name', text: QUIZ.form.firstNameLabel }),
        firstNameInput
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'quiz-last-name', text: QUIZ.form.lastNameLabel }),
        lastNameInput
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'quiz-email' }, [
          QUIZ.form.emailLabel,
          el('span', { class: 'req', text: ' *' })
        ]),
        emailInput
      ]),
      el('div', { class: 'hp', 'aria-hidden': 'true' }, [
        el('label', { for: 'quiz-company', text: 'Company' }),
        honeypot
      ]),
      el('label', { class: 'consent', for: 'quiz-consent' }, [
        consentInput,
        el('span', { text: QUIZ.form.consentText })
      ]),
      submitButton,
      el('p', { class: 'quiz-privacy' }, [
        QUIZ.form.privacyNote + ' ',
        el('a', { href: '/privacy', text: 'Privacy Policy' }),
        '.'
      ]),
      status
    ]);

    syncSubmit();
    return [heading, form];
  }

  /**
   * The result screen doubles as the save-status screen: the archetype is always visible, and
   * the note underneath says whether Mailchimp took it, with a retry when it did not.
   */
  function renderResult() {
    var result = state.result;
    if (!result) return renderQuestion(); // defensive: nothing scored, fall back to the quiz

    var contact = rememberedContact();

    var note;
    if (state.submitting) {
      note = el('p', { class: 'quiz-save-note', text: STRINGS.sending });
    } else if (state.saveState === 'saved') {
      note = el('p', {
        class: 'quiz-save-note',
        text: fill(STRINGS.saved, { email: (contact && contact.email) || '' })
      });
    } else if (state.saveState === 'pending') {
      note = el('p', { class: 'quiz-save-note', text: STRINGS.savedPending });
    } else if (state.saveState === 'blocked') {
      note = el('p', { class: 'quiz-save-note is-error', text: state.saveError || STRINGS.blocked });
    } else if (state.saveState === 'failed') {
      note = el('div', { class: 'quiz-save-note is-error' }, [
        el('p', { text: STRINGS.saveFailed + (state.saveError ? ' ' + state.saveError : '') }),
        el('button', {
          type: 'button',
          class: 'btn btn-ghost quiz-retry',
          text: STRINGS.retry,
          onclick: function () {
            // The answers are still in state, so the retry re-posts the same submission rather
            // than making them take the quiz again.
            var again = state.pendingContact || rememberedContact();
            if (again) submit(again);
          }
        })
      ]);
    }

    var bodyParagraphs = String(result.body || '')
      .split(/\n\n+/)
      .filter(Boolean)
      .map(function (paragraph) {
        return el('p', { class: 'quiz-result-desc', text: paragraph });
      });

    return [
      el('p', { class: 'quiz-result-eyebrow', text: STRINGS.resultEyebrow }),
      el('h2', {
        class: 'quiz-result-title',
        id: 'quiz-result-heading',
        tabindex: '-1',
        text: result.title
      }),
      el('div', { class: 'quiz-result-body' }, bodyParagraphs),
      result.goFigureTieIn
        ? el('p', { class: 'quiz-result-tiein', text: result.goFigureTieIn })
        : null,
      note,
      el('div', { class: 'quiz-result-actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-ice quiz-retake',
          text: STRINGS.retake,
          onclick: resetQuiz
        }),
        // Escape hatch for a shared phone at the rink: the second parent can hand over their own
        // address instead of overwriting the first one's result.
        contact
          ? el('button', {
              type: 'button',
              class: 'quiz-link-btn',
              text: STRINGS.changeEmail,
              onclick: function () {
                clearStore('localStorage', CONTACT_KEY);
                state.forceForm = true;
                state.screen = 'form';
                state.saveState = null;
                render();
              }
            })
          : null
      ])
    ];
  }

  /* ─── Render ─────────────────────────────────────────────────────────────── */

  function render() {
    if (!state.open) return;

    var children;
    var current;

    if (state.screen === 'result') {
      children = renderResult();
      current = totalSteps();
    } else if (state.screen === 'form') {
      children = renderForm();
      current = totalQuestionSteps() + 1;
    } else {
      children = renderQuestion();
      current = state.step + 1;
    }

    var total = totalSteps();

    // The progress row is meaningless on the result screen — hide it there rather than showing
    // a permanently full bar.
    var showProgress = state.screen !== 'result';
    overlayProgress.hidden = !showProgress;
    overlayBar.parentNode.hidden = !showProgress;
    if (showProgress) {
      overlayProgress.textContent = fill(STRINGS.progress, { current: current, total: total });
      overlayBar.style.width = Math.round((current / total) * 100) + '%';
    }

    // No back button on the first question — there is nowhere to go — and none while a save is
    // in flight, which would strand the request.
    backButton.hidden =
      state.submitting || (state.screen === 'question' && state.step === 0);

    overlayBody.innerHTML = '';
    children.forEach(function (child) {
      if (child) overlayBody.appendChild(child);
    });

    // Focus the heading of the new step so screen readers announce it and keyboard users start
    // at the top of the content, not wherever the previous button happened to be.
    var heading = overlayBody.querySelector('[tabindex="-1"]');
    if (heading) heading.focus({ preventScroll: true });

    liveRegion.textContent = showProgress
      ? fill(STRINGS.progress, { current: current, total: total })
      : (state.result ? state.result.title : '');
  }

  /* ─── Boot ───────────────────────────────────────────────────────────────── */

  function init() {
    buildBanner();
    buildOverlay();

    // Any element marked data-quiz-open becomes an entry point — currently the homepage CTA.
    // Declarative so a new button anywhere on the site needs no change here. Their href is
    // "?quiz=open", which is what the click would fall back to if this listener never ran.
    Array.prototype.forEach.call(document.querySelectorAll('[data-quiz-open]'), function (trigger) {
      trigger.addEventListener('click', function (event) {
        event.preventDefault();
        openQuiz('trigger');
      });
    });

    // ?quiz=open — what the printed QR codes point at. Opens straight into question 1 with no
    // banner in the way.
    var opensImmediately = false;
    try {
      opensImmediately = new URLSearchParams(window.location.search).get('quiz') === 'open';
    } catch (err) {
      opensImmediately = /[?&]quiz=open(&|$)/.test(window.location.search);
    }

    if (opensImmediately) openQuiz('query');
    else showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
