(() => {
  const initGallery = async () => {
    const root = document.querySelector('[data-home-gallery]');
    if (!root) return;

    try {
      const response = await fetch('/api/gallery');
      if (!response.ok) throw new Error('Failed to load gallery');

      const images = await response.json();

      if (!Array.isArray(images) || !images.length) {
        root.remove();
        return;
      }

      if (images.length === 1) {
        root.innerHTML = `
          <div class="home-gallery-single">
            <img src="${escapeHtml(images[0].image_url)}" alt="Portfolio gallery image">
          </div>
        `;
        return;
      }

      const items = [...images, ...images];

      root.innerHTML = `
        <div class="home-gallery-viewport">
          <div class="home-gallery-track">
            ${items.map((item, index) => `
              <div class="home-gallery-card">
                <img
                  src="${escapeHtml(item.image_url)}"
                  alt="Portfolio gallery image ${index % images.length + 1}"
                  loading="${index < 3 ? 'eager' : 'lazy'}"
                  draggable="false"
                >
              </div>
            `).join('')}
          </div>

          <button class="home-gallery-arrow home-gallery-prev" type="button" aria-label="Previous image">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 18 9 12l6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          <button class="home-gallery-arrow home-gallery-next" type="button" aria-label="Next image">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      `;

      const viewport = root.querySelector('.home-gallery-viewport');
      const track = root.querySelector('.home-gallery-track');
      const prev = root.querySelector('.home-gallery-prev');
      const next = root.querySelector('.home-gallery-next');

      let position = 0;
      let timer = null;
      let paused = false;

      const getCardWidth = () => {
        const card = track.querySelector('.home-gallery-card');
        if (!card) return 0;

        const styles = getComputedStyle(track);
        const gap = parseFloat(styles.gap) || 0;

        return card.getBoundingClientRect().width + gap;
      };

      const move = (direction = 1, smooth = true) => {
        const cardWidth = getCardWidth();
        if (!cardWidth) return;

        position += direction;

        const total = images.length;

        if (position >= total) {
          position = 0;
          track.style.transition = 'none';
          track.style.transform = `translate3d(${-position * cardWidth}px,0,0)`;

          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              track.style.transition = '';
              if (direction > 0) {
                position = 1;
                track.style.transform = `translate3d(${-position * cardWidth}px,0,0)`;
              }
            });
          });

          return;
        }

        if (position < 0) {
          position = total - 1;
          track.style.transition = 'none';
          track.style.transform = `translate3d(${-position * cardWidth}px,0,0)`;

          requestAnimationFrame(() => {
            track.style.transition = '';
          });

          return;
        }

        track.style.transition = smooth ? 'transform 500ms ease' : 'none';
        track.style.transform = `translate3d(${-position * cardWidth}px,0,0)`;
      };

      const startAuto = () => {
        clearInterval(timer);

        timer = setInterval(() => {
          if (!paused) move(1);
        }, 3500);
      };

      const pause = () => {
        paused = true;
      };

      const resume = () => {
        paused = false;
      };

      next.addEventListener('click', () => {
        move(1);
        startAuto();
      });

      prev.addEventListener('click', () => {
        move(-1);
        startAuto();
      });

      viewport.addEventListener('mouseenter', pause);
      viewport.addEventListener('mouseleave', resume);

      let touchStartX = 0;
      let touchStartY = 0;

      viewport.addEventListener('touchstart', event => {
        const touch = event.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        pause();
      }, {passive:true});

      viewport.addEventListener('touchend', event => {
        const touch = event.changedTouches[0];
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;

        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
          move(dx < 0 ? 1 : -1);
        }

        resume();
        startAuto();
      }, {passive:true});

      window.addEventListener('resize', () => {
        const cardWidth = getCardWidth();
        track.style.transition = 'none';
        track.style.transform = `translate3d(${-position * cardWidth}px,0,0)`;
      });

      track.style.transform = 'translate3d(0,0,0)';
      startAuto();

    } catch (error) {
      console.error('Homepage gallery error:', error);
      root.remove();
    }
  };

  const escapeHtml = value =>
    String(value ?? '').replace(/[&<>"']/g, char => ({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#039;'
    }[char]));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGallery);
  } else {
    initGallery();
  }
})();
