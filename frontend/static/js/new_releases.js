// New Releases - sourced from League of Comic Geeks

function formatDate(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
};

function getMonday(date) {
	const d = new Date(date);
	const day = d.getDay();
	const diff = d.getDate() - day + (day === 0 ? -6 : 1);
	d.setDate(diff);
	d.setHours(0, 0, 0, 0);
	return d;
};

function formatWeekLabel(monday) {
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);
	const opts = { month: 'long', day: 'numeric' };
	return `${monday.toLocaleDateString('en-US', opts)} - `
		+ `${sunday.toLocaleDateString('en-US', opts)}, ${sunday.getFullYear()}`;
};

function formatPulls(n) {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
};

function formatReleaseDate(iso) {
	if (!iso) return '';
	const d = new Date(iso + 'T00:00:00');
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

let currentMonday = getMonday(new Date());
let allReleases = [];

const cardTemplate = document.querySelector('.pre-build-els .release-card');
const grid = document.querySelector('#releases-grid');
const loadingEl = document.querySelector('#loading-releases');
const emptyEl = document.querySelector('#empty-releases');
const noMatchEl = document.querySelector('#no-match-releases');
const metaEl = document.querySelector('#releases-meta');
const weekLabel = document.querySelector('#week-label');
const inLibraryToggle = document.querySelector('#in-library-only');
const publisherFilter = document.querySelector('#publisher-filter');

function createCard(release, api_key) {
	const card = cardTemplate.cloneNode(true);

	if (release.in_library && release.volume_id) {
		card.href = `${url_base}/volumes/${release.volume_id}`;
		card.classList.add('in-library');
		if (release.monitored) card.classList.add('monitored');
	} else {
		// LOCG releases have no ComicVine ID, so hand off to the Add Volume
		// page with the title pre-filled in its search bar.
		card.href = `${url_base}/add?q=${encodeURIComponent(release.title)}`;
	}

	card.setAttribute(
		'aria-label',
		`${release.title} #${release.issue_number} (${release.publisher})`
	);

	const cover = card.querySelector('.release-card-cover');
	if (release.in_library && release.volume_id) {
		cover.src = `${url_base}/api/volumes/${release.volume_id}/cover?api_key=${api_key}`;
	} else if (release.cover) {
		cover.src = release.cover;
	}
	cover.alt = release.title;

	const pullsEl = card.querySelector('.release-card-pulls');
	if (release.pulls) {
		pullsEl.textContent = formatPulls(release.pulls);
	} else {
		pullsEl.remove();
	}

	const issueLabel = release.issue_number
		? `${release.title} #${release.issue_number}`
		: release.title;
	card.querySelector('.release-card-title').textContent = issueLabel;

	const meta = card.querySelector('.release-card-meta');
	meta.innerHTML = '';
	const dateSpan = document.createElement('span');
	dateSpan.textContent = formatReleaseDate(release.release_date);
	meta.appendChild(dateSpan);
	if (release.price) {
		const priceSpan = document.createElement('span');
		priceSpan.className = 'price';
		priceSpan.textContent = release.price;
		meta.appendChild(priceSpan);
	}

	card.querySelector('.release-card-pub').textContent = release.publisher;

	return card;
};

function rebuildPublisherFilter(releases) {
	const previous = publisherFilter.value;
	const publishers = [...new Set(
		releases.map(r => r.publisher).filter(Boolean)
	)].sort();

	publisherFilter.innerHTML = '<option value="">All publishers</option>';
	publishers.forEach(p => {
		const option = document.createElement('option');
		option.value = p;
		option.textContent = p;
		publisherFilter.appendChild(option);
	});

	if (publishers.includes(previous)) publisherFilter.value = previous;
};

function renderReleases() {
	grid.innerHTML = '';

	const inLibOnly = inLibraryToggle.checked;
	const pubFilter = publisherFilter.value;

	const filtered = allReleases.filter(r => {
		if (inLibOnly && !r.in_library) return false;
		if (pubFilter && r.publisher !== pubFilter) return false;
		return true;
	});

	if (allReleases.length === 0) {
		hide([loadingEl, grid, noMatchEl, metaEl], [emptyEl]);
		return;
	}
	if (filtered.length === 0) {
		hide([loadingEl, grid, emptyEl, metaEl], [noMatchEl]);
		return;
	}

	hide([loadingEl, emptyEl, noMatchEl], [grid, metaEl]);

	const api_key = getLocalStorage('api_key').api_key;
	filtered.forEach(r => grid.appendChild(createCard(r, api_key)));

	const inLibCount = allReleases.filter(r => r.in_library).length;
	metaEl.textContent =
		`Showing ${filtered.length} of ${allReleases.length} releases · `
		+ `${inLibCount} in your library · sourced from League of Comic Geeks`;
};

function loadWeek() {
	hide([grid, emptyEl, noMatchEl, metaEl], [loadingEl]);
	weekLabel.textContent = formatWeekLabel(currentMonday);

	const week = formatDate(currentMonday);

	usingApiKey()
	.then(api_key => fetchAPI('/new-releases', api_key, { week: week }))
	.then(json => {
		allReleases = json.result || [];
		rebuildPublisherFilter(allReleases);
		renderReleases();
	})
	.catch(e => {
		console.error('Failed to load new releases:', e);
		allReleases = [];
		rebuildPublisherFilter(allReleases);
		renderReleases();
	});
};

document.querySelector('#prev-week').onclick = () => {
	currentMonday.setDate(currentMonday.getDate() - 7);
	loadWeek();
};

document.querySelector('#next-week').onclick = () => {
	currentMonday.setDate(currentMonday.getDate() + 7);
	loadWeek();
};

document.querySelector('#today-button').onclick = () => {
	currentMonday = getMonday(new Date());
	loadWeek();
};

inLibraryToggle.onchange = renderReleases;
publisherFilter.onchange = renderReleases;

loadWeek();
