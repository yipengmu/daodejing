(() => {
  const readingDocument = document.getElementById('reading-document');
  const toolbar = document.querySelector('.toolbar');
  const tools = document.querySelector('.tools');
  const sections = [...document.querySelectorAll('.chapter-section')];
  const contents = document.getElementById('contents');
  const contentsButton = document.getElementById('contents-button');
  const contentsList = document.getElementById('contents-list');
  const presentButton = document.getElementById('present-button');
  const presentLabel = document.getElementById('present-label');

  let focusMode = false;

  if (typeof contents.showModal === 'function') {
    const links = sections.map((section, index) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const number = document.createElement('span');
      const title = document.createElement('span');

      const heading = section.querySelector('h1, h2');
      link.href = '#' + section.id;
      number.textContent = String(index + 1).padStart(2, '0');
      number.setAttribute('aria-hidden', 'true');
      title.textContent = heading.textContent.trim();
      link.append(number, title);
      item.append(link);
      contentsList.append(item);
      return link;
    });

    contentsButton.addEventListener('click', () => {
      const toolbarBottom = toolbar.getBoundingClientRect().bottom;
      const page = document.documentElement;
      let current = 0;
      for (let index = 1; index < sections.length; index += 1) {
        if (sections[index].getBoundingClientRect().top > toolbarBottom + 2) break;
        current = index;
      }
      if (window.scrollY + page.clientHeight >= page.scrollHeight - 2) {
        current = sections.length - 1;
      }
      links.forEach((link, index) => {
        if (index === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      contents.showModal();
      links[current].focus();
    });

    contentsList.addEventListener('click', (event) => {
      if (event.target.closest('a') && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        contents.close();
      }
    });
  } else {
    contentsButton.hidden = true;
  }

  function updatePresentMode() {
    const fullscreen = Boolean(document.fullscreenElement);
    const presenting = fullscreen || focusMode;
    readingDocument.classList.toggle('is-presenting', presenting);
    presentButton.setAttribute('aria-pressed', String(presenting));
    presentLabel.textContent = fullscreen ? '退出全屏' : focusMode ? '退出演示' : '全屏';
  }

  presentButton.addEventListener('click', async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (!focusMode && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
        return;
      } catch {
        // Use the compact toolbar when embedded browsers restrict full screen.
      }
    }
    focusMode = !focusMode;
    updatePresentMode();
  });

  document.addEventListener('fullscreenchange', updatePresentMode);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && focusMode && !contents.open && !event.defaultPrevented) {
      focusMode = false;
      updatePresentMode();
    }
  });

  tools.hidden = false;

  const share = /^\/api\/shares\/([a-z0-9-]+)\/presentation\/index\.html$/.exec(location.pathname);
  if (share) {
    const endpoint = '/api/shares/' + share[1];
    void (async () => {
      const response = await fetch(endpoint);
      if (!response.ok) return;
      const { data } = await response.json();
      const ticket = data?.readTicket;
      if (!ticket) return;

      let timer;
      function scheduleRead() {
        clearTimeout(timer);
        if (document.visibilityState !== 'visible') return;
        timer = setTimeout(() => {
          document.removeEventListener('visibilitychange', scheduleRead);
          void fetch(endpoint + '/view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket }),
          }).catch(() => {});
        }, 5100);
      }
      document.addEventListener('visibilitychange', scheduleRead);
      scheduleRead();
    })().catch(() => {});
  }
})();
