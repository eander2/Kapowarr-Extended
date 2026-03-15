// Comic Reader

const fileId = window.location.pathname.split('/').pop();

const toolbar = document.querySelector('#reader-toolbar');
const loadingEl = document.querySelector('#reader-loading');
const errorEl = document.querySelector('#reader-error');
const pageView = document.querySelector('#page-view');
const scrollView = document.querySelector('#scroll-view');
const pageImage = document.querySelector('#page-image');
const pageIndicator = document.querySelector('#page-indicator');
const filenameEl = document.querySelector('#reader-filename');
const fitSelect = document.querySelector('#fit-mode');
const viewSelect = document.querySelector('#view-mode');

let pageCount = 0;
let currentPage = 0;
let apiKey = null;
let idleTimer = null;

// Toolbar auto-hide
function showToolbar() {
	toolbar.classList.remove('toolbar-hidden');
	clearTimeout(idleTimer);
	idleTimer = setTimeout(() => {
		if (viewSelect.value === 'page') {
			toolbar.classList.add('toolbar-hidden');
		}
	}, 3000);
};

document.addEventListener('mousemove', showToolbar);
document.addEventListener('click', showToolbar);

// Navigation
function goToPage(page) {
	if (page < 0 || page >= pageCount) return;
	currentPage = page;
	pageIndicator.textContent = `Page ${currentPage + 1} / ${pageCount}`;

	const src = `${url_base}/api/files/${fileId}/pages/${currentPage}?api_key=${apiKey}`;
	pageImage.src = src;

	// Preload adjacent pages
	if (currentPage + 1 < pageCount) {
		const next = new Image();
		next.src = `${url_base}/api/files/${fileId}/pages/${currentPage + 1}?api_key=${apiKey}`;
	}
};

function prevPage() {
	goToPage(currentPage - 1);
};

function nextPage() {
	goToPage(currentPage + 1);
};

// Page view click zones
document.querySelector('#nav-prev').onclick = prevPage;
document.querySelector('#nav-next').onclick = nextPage;
document.querySelector('#page-prev').onclick = prevPage;
document.querySelector('#page-next').onclick = nextPage;

// Keyboard shortcuts
document.addEventListener('keydown', e => {
	if (e.target.tagName === 'SELECT') return;

	switch (e.key) {
		case 'ArrowLeft':
			prevPage();
			e.preventDefault();
			break;
		case 'ArrowRight':
			nextPage();
			e.preventDefault();
			break;
		case 'Home':
			goToPage(0);
			e.preventDefault();
			break;
		case 'End':
			goToPage(pageCount - 1);
			e.preventDefault();
			break;
		case 'f':
		case 'F':
			cycleFitMode();
			e.preventDefault();
			break;
		case 'Escape':
			window.history.back();
			e.preventDefault();
			break;
	}
});

// Fit mode
function cycleFitMode() {
	const modes = ['contain', 'width', 'none'];
	const idx = modes.indexOf(fitSelect.value);
	fitSelect.value = modes[(idx + 1) % modes.length];
	applyFitMode();
};

function applyFitMode() {
	const mode = fitSelect.value;
	pageImage.className = `fit-${mode}`;

	scrollView.querySelectorAll('img').forEach(img => {
		img.className = `fit-${mode}`;
	});

	setLocalStorage({ reader_fit: mode });
};

fitSelect.onchange = applyFitMode;

// View mode
function setViewMode(mode) {
	viewSelect.value = mode;

	if (mode === 'page') {
		hide([scrollView], [pageView]);
		goToPage(currentPage);
	} else {
		hide([pageView], [scrollView]);
		renderScrollView();
	}

	setLocalStorage({ reader_view: mode });
};

viewSelect.onchange = () => setViewMode(viewSelect.value);

function renderScrollView() {
	scrollView.innerHTML = '';
	const mode = fitSelect.value;

	for (let i = 0; i < pageCount; i++) {
		const img = document.createElement('img');
		img.src = `${url_base}/api/files/${fileId}/pages/${i}?api_key=${apiKey}`;
		img.alt = `Page ${i + 1}`;
		img.loading = 'lazy';
		img.className = `fit-${mode}`;
		scrollView.appendChild(img);
	}
};

// Touch swipe navigation
let touchStartX = 0;
let touchStartY = 0;

pageView.addEventListener('touchstart', e => {
	touchStartX = e.changedTouches[0].screenX;
	touchStartY = e.changedTouches[0].screenY;
}, { passive: true });

pageView.addEventListener('touchend', e => {
	const dx = e.changedTouches[0].screenX - touchStartX;
	const dy = e.changedTouches[0].screenY - touchStartY;

	// Only trigger if horizontal swipe is dominant and > 50px
	if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
		if (dx < 0) {
			nextPage();
		} else {
			prevPage();
		}
	}
}, { passive: true });

// Back button
document.querySelector('#reader-back').onclick = () => window.history.back();

// Load
function loadReader() {
	usingApiKey()
	.then(key => {
		apiKey = key;
		return fetchAPI(`/files/${fileId}/pages`, key);
	})
	.then(json => {
		pageCount = json.result.page_count;

		if (pageCount === 0) {
			hide([loadingEl], [errorEl]);
			return;
		}

		// Set filename from first page path
		if (json.result.pages.length > 0) {
			const parts = json.result.pages[0].split('/');
			filenameEl.textContent = parts.length > 1
				? parts[0]
				: `File #${fileId}`;
		}

		pageIndicator.textContent = `Page 1 / ${pageCount}`;

		// Restore preferences
		const prefs = getLocalStorage('reader_fit', 'reader_view');
		if (prefs.reader_fit) fitSelect.value = prefs.reader_fit;
		if (prefs.reader_view) viewSelect.value = prefs.reader_view;

		applyFitMode();

		const mode = viewSelect.value;
		if (mode === 'scroll') {
			hide([loadingEl], [scrollView]);
			renderScrollView();
		} else {
			hide([loadingEl], [pageView]);
			goToPage(0);
		}

		showToolbar();
	})
	.catch(e => {
		console.error('Failed to load reader:', e);
		hide([loadingEl], [errorEl]);
	});
};

loadReader();
