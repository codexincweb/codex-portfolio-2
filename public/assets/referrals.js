(() => {
  'use strict';

  const registerForm =
    document.getElementById('referral-register-form');

  const registerStatus =
    document.getElementById('referral-register-status');

  const registerTurnstileContainer =
    document.getElementById('turnstile-container');

  const loginForm =
    document.getElementById('referral-login-form');

  const loginStatus =
    document.getElementById('referral-login-status');

  const loginTurnstileContainer =
    document.getElementById('login-turnstile-container');

  let siteKey = '';

  let registerWidgetId = null;
  let registerToken = '';

  let loginWidgetId = null;
  let loginToken = '';

  function setStatus(element, message, type = '') {
    if (!element) return;

    element.textContent = message;
    element.className =
      `form-status${type ? ` ${type}` : ''}`;
  }

  function loadTurnstile() {
    return new Promise((resolve, reject) => {
      let attempts = 0;

      const waitUntilReady = () => {
        if (
          window.turnstile &&
          typeof window.turnstile.render === 'function'
        ) {
          resolve();
          return;
        }

        attempts += 1;

        if (attempts > 100) {
          reject(
            new Error(
              'Cloudflare Turnstile failed to become ready.'
            )
          );
          return;
        }

        setTimeout(waitUntilReady, 100);
      };

      if (
        window.turnstile &&
        typeof window.turnstile.render === 'function'
      ) {
        resolve();
        return;
      }

      const existing = document.querySelector(
        'script[data-codex-turnstile]'
      );

      if (existing) {
        existing.addEventListener(
          'load',
          waitUntilReady,
          { once: true }
        );

        existing.addEventListener(
          'error',
          reject,
          { once: true }
        );

        waitUntilReady();
        return;
      }

      const script = document.createElement('script');

      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

      script.async = true;
      script.defer = true;
      script.dataset.codexTurnstile = 'true';

      script.addEventListener(
        'load',
        waitUntilReady,
        { once: true }
      );

      script.addEventListener(
        'error',
        reject,
        { once: true }
      );

      document.head.appendChild(script);
    });
  }

  async function loadConfig() {
    const response = await fetch(
      '/api/referrals/config',
      {
        credentials: 'same-origin'
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        'Unable to load referral configuration.'
      );
    }

    siteKey =
      String(data.turnstile_site_key || '').trim();

    if (!siteKey) {
      throw new Error(
        'Human verification is not configured yet.'
      );
    }
  }

  async function initialiseTurnstile() {
    try {
      await loadTurnstile();
      await loadConfig();

      if (
        registerTurnstileContainer &&
        registerForm
      ) {
        registerWidgetId =
          window.turnstile.render(
            registerTurnstileContainer,
            {
              sitekey: siteKey,

              callback(token) {
                registerToken = token;
              },

              'expired-callback'() {
                registerToken = '';
              },

              'error-callback'() {
                registerToken = '';

                setStatus(
                  registerStatus,
                  'Human verification could not be completed. Please try again.',
                  'error'
                );
              }
            }
          );
      }

      if (
        loginTurnstileContainer &&
        loginForm
      ) {
        loginWidgetId =
          window.turnstile.render(
            loginTurnstileContainer,
            {
              sitekey: siteKey,

              callback(token) {
                loginToken = token;
              },

              'expired-callback'() {
                loginToken = '';
              },

              'error-callback'() {
                loginToken = '';

                setStatus(
                  loginStatus,
                  'Human verification could not be completed. Please try again.',
                  'error'
                );
              }
            }
          );
      }

    } catch (error) {
      console.error(
        'Turnstile initialization error:',
        error
      );

      setStatus(
        registerStatus,
        error.message ||
          'Unable to load human verification.',
        'error'
      );

      setStatus(
        loginStatus,
        error.message ||
          'Unable to load human verification.',
        'error'
      );
    }
  }

  if (registerForm) {
    registerForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const submitButton =
          registerForm.querySelector(
            'button[type="submit"]'
          );

        const formData =
          new FormData(registerForm);

        const payload = {
          full_name:
            String(
              formData.get('full_name') || ''
            ).trim(),

          phone:
            String(
              formData.get('phone') || ''
            ).trim(),

          email:
            String(
              formData.get('email') || ''
            ).trim(),

          password:
            String(
              formData.get('password') || ''
            ),

          confirm_password:
            String(
              formData.get('confirm_password') || ''
            ),

          terms_agreed:
            Boolean(
              document.getElementById('referral-terms')?.checked
            ),

          turnstile_token:
            registerToken
        };

        const passwordValue = String(
          formData.get('password') || ''
        );

        const strongPassword =
          passwordValue.length >= 8 &&
          passwordValue.length <= 128 &&
          /[A-Z]/.test(passwordValue) &&
          /[a-z]/.test(passwordValue) &&
          /[0-9]/.test(passwordValue) &&
          /[^A-Za-z0-9]/.test(passwordValue);

        if (!strongPassword) {
          setStatus(
            registerStatus,
            'Please create a strong password that meets all the requirements.',
            'error'
          );

          return;
        }

        if (!registerToken) {
          setStatus(
            registerStatus,
            'Please complete the human verification first.',
            'error'
          );

          return;
        }

        submitButton.disabled = true;

        setStatus(
          registerStatus,
          'Creating your referral account...'
        );

        try {
          const response =
            await fetch(
              '/api/referrals/register',
              {
                method: 'POST',

                headers: {
                  'content-type':
                    'application/json'
                },

                credentials: 'same-origin',

                body:
                  JSON.stringify(payload)
              }
            );

          const data =
            await response.json()
              .catch(() => ({}));

          if (!response.ok) {
            throw new Error(
              data.error ||
                'Unable to create your referral account.'
            );
          }

          setStatus(
            registerStatus,
            'Your referral account has been created. Redirecting...'
          );

          window.location.href =
            '/referral-dashboard.html';

        } catch (error) {
          console.error(
            'Referral registration error:',
            error
          );

          setStatus(
            registerStatus,
            error.message ||
              'Unable to create your referral account right now.',
            'error'
          );

          registerToken = '';

          if (
            window.turnstile &&
            registerWidgetId !== null
          ) {
            window.turnstile.reset(
              registerWidgetId
            );
          }

        } finally {
          submitButton.disabled = false;
        }
      }
    );
  }

  if (loginForm) {
    loginForm.addEventListener(
      'submit',
      async event => {
        event.preventDefault();

        const submitButton =
          loginForm.querySelector(
            'button[type="submit"]'
          );

        const formData =
          new FormData(loginForm);

        const payload = {
          email:
            String(
              formData.get('email') || ''
            ).trim(),

          password:
            String(
              formData.get('password') || ''
            ),

          turnstile_token:
            loginToken
        };

        if (!loginToken) {
          setStatus(
            loginStatus,
            'Please complete the human verification first.',
            'error'
          );

          return;
        }

        submitButton.disabled = true;

        setStatus(
          loginStatus,
          'Signing you in...'
        );

        try {
          const response =
            await fetch(
              '/api/referrals/login',
              {
                method: 'POST',

                headers: {
                  'content-type':
                    'application/json'
                },

                credentials: 'same-origin',

                body:
                  JSON.stringify(payload)
              }
            );

          const data =
            await response.json()
              .catch(() => ({}));

          if (!response.ok) {
            throw new Error(
              data.error ||
                'Unable to sign you in.'
            );
          }

          setStatus(
            loginStatus,
            'Signed in successfully. Redirecting...'
          );

          window.location.href =
            '/referral-dashboard.html';

        } catch (error) {
          console.error(
            'Referral login error:',
            error
          );

          setStatus(
            loginStatus,
            error.message ||
              'Unable to sign you in right now.',
            'error'
          );

          loginToken = '';

          if (
            window.turnstile &&
            loginWidgetId !== null
          ) {
            window.turnstile.reset(
              loginWidgetId
            );
          }

        } finally {
          submitButton.disabled = false;
        }
      }
    );
  }

  initialiseTurnstile();
})();

  function setupPasswordControls() {
    document.querySelectorAll('[data-password-toggle]').forEach(button => {
      const input = document.getElementById(
        button.getAttribute('data-password-toggle')
      );

      if (!input) return;

      button.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        button.setAttribute(
          'aria-label',
          showing ? 'Show password' : 'Hide password'
        );
        button.setAttribute(
          'title',
          showing ? 'Show password' : 'Hide password'
        );
      });
    });

    const password = document.getElementById('referral-password');
    const strength = document.getElementById('password-strength');
    const requirements = document.getElementById('password-requirements');

    if (!password || !strength || !requirements) return;

    const checks = {
      length: value => value.length >= 8,
      uppercase: value => /[A-Z]/.test(value),
      lowercase: value => /[a-z]/.test(value),
      number: value => /[0-9]/.test(value),
      special: value => /[^A-Za-z0-9]/.test(value)
    };

    function updatePasswordStrength() {
      const value = password.value;
      let passed = 0;

      Object.entries(checks).forEach(([name, check]) => {
        const item = requirements.querySelector(
          `[data-requirement="${name}"]`
        );

        const valid = check(value);

        if (valid) passed++;

        if (item) {
          item.classList.toggle('valid', valid);
        }
      });

      if (!value) {
        strength.textContent = '';
        return;
      }

      if (passed <= 2) {
        strength.textContent = 'Password strength: Weak';
      } else if (passed <= 4) {
        strength.textContent = 'Password strength: Medium';
      } else {
        strength.textContent = 'Password strength: Strong';
      }
    }

    password.addEventListener('input', updatePasswordStrength);
    updatePasswordStrength();
  }

  setupPasswordControls();
