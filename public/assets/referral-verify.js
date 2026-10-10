'use strict';

(() => {
  const form = document.getElementById('referral-verify-form');
  const emailInput = document.getElementById('verification-email');
  const codeInput = document.getElementById('verification-code');
  const submitButton = document.getElementById('verification-submit');
  const resendButton = document.getElementById('verification-resend');
  const status = document.getElementById('referral-verify-status');

  if (!form || !emailInput || !codeInput || !submitButton || !status) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  emailInput.value = String(params.get('email') || '').trim();

  let countdownTimer = null;

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('error', isError);
    status.setAttribute('role', isError ? 'alert' : 'status');
  }

  function startCooldown(seconds) {
    if (!resendButton) return;

    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    let remaining = Math.max(0, Math.ceil(Number(seconds) || 0));

    const updateButton = () => {
      if (remaining <= 0) {
        resendButton.disabled = false;
        resendButton.textContent = 'Resend verification code';
        if (countdownTimer) {
          clearInterval(countdownTimer);
          countdownTimer = null;
        }
        return;
      }

      resendButton.disabled = true;
      resendButton.textContent = `Resend code in ${remaining}s`;
      remaining -= 1;
    };

    updateButton();
    countdownTimer = setInterval(updateButton, 1000);
  }

  function getEmail() {
    return emailInput.value.trim().toLowerCase();
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 8);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    const email = getEmail();
    const code = codeInput.value.trim();

    if (!validEmail(email)) {
      showStatus('Please enter a valid email address.', true);
      emailInput.focus();
      return;
    }

    if (!/^\d{8}$/.test(code)) {
      showStatus('Enter the complete eight-digit verification code.', true);
      codeInput.focus();
      return;
    }

    submitButton.disabled = true;
    showStatus('Verifying your email address...');

    try {
      const response = await fetch('/api/referrals/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, code })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || 'Email verification failed. Please try again.');
      }

      showStatus('Email verified successfully. Opening your dashboard...');
      window.location.replace('/referral-dashboard.html');
    } catch (error) {
      showStatus(error.message || 'Unable to verify your email right now.', true);
      codeInput.focus();
    } finally {
      submitButton.disabled = false;
    }
  });

  if (resendButton) {
    resendButton.addEventListener('click', async () => {
      const email = getEmail();

      if (!validEmail(email)) {
        showStatus('Enter your email address before requesting a new code.', true);
        emailInput.focus();
        return;
      }

      resendButton.disabled = true;
      resendButton.textContent = 'Sending code...';

      try {
        const response = await fetch('/api/referrals/resend-verification', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 429 && data.retry_after_seconds) {
            startCooldown(data.retry_after_seconds);
          } else {
            resendButton.disabled = false;
            resendButton.textContent = 'Resend verification code';
          }

          throw new Error(data.error || 'Unable to resend the verification code.');
        }

        codeInput.value = '';
        showStatus(data.message || 'A new verification code has been sent.');
        startCooldown(60);
        codeInput.focus();
      } catch (error) {
        showStatus(error.message || 'Unable to resend the verification code.', true);
      } finally {
        if (!countdownTimer && resendButton.textContent === 'Sending code...') {
          resendButton.disabled = false;
          resendButton.textContent = 'Resend verification code';
        }
      }
    });
  }
})();
