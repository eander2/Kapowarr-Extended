// Calendar - Weekly Release View

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
	const startStr = monday.toLocaleDateString('en-US', opts);
	const endStr = sunday.toLocaleDateString('en-US', opts);
	const year = sunday.getFullYear();

	return `${startStr} - ${endStr}, ${year}`;
};

let currentMonday = getMonday(new Date());

const issueTemplate = document.querySelector('.pre-build-els .calendar-issue');
const calendarGrid = document.querySelector('#calendar-grid');
const loadingEl = document.querySelector('#loading-calendar');
const emptyEl = document.querySelector('#empty-calendar');
const weekLabel = document.querySelector('#week-label');

// Add Volume window elements
const calAddEls = {
	cover: document.querySelector('#cal-add-cover'),
	form: document.querySelector('#cal-add-form'),
	title: document.querySelector('#cal-add-window .window-header h2'),
	cv_input: document.querySelector('#cal-comicvine-input'),
	title_input: document.querySelector('#cal-volume-title-input'),
	year_input: document.querySelector('#cal-volume-year-input'),
	volume_number_input: document.querySelector('#cal-volume-number-input'),
	publisher_input: document.querySelector('#cal-volume-publisher-input'),
	root_folder_input: document.querySelector('#cal-rootfolder-input'),
	volume_folder_input: document.querySelector('#cal-volumefolder-input'),
	monitor_volume_input: document.querySelector('#cal-monitor-volume-input'),
	monitor_issues_input: document.querySelector('#cal-monitor-issues-input'),
	monitoring_scheme: document.querySelector('#cal-monitoring-scheme-input'),
	special_state_input: document.querySelector('#cal-specialoverride-input'),
	auto_search_input: document.querySelector('#cal-auto-search-input'),
	submit: document.querySelector('#cal-add-volume')
};

// Track the generated folder name for custom folder detection
let generatedFolderName = '';

function fillRootFolders(api_key) {
	fetchAPI('/rootfolder', api_key)
	.then(json => {
		json.result.forEach(folder => {
			const option = document.createElement('option');
			option.value = folder.id;
			option.innerText = folder.folder;
			calAddEls.root_folder_input.appendChild(option);
		});
	});
};

function showAddVolumeWindow(volumeCvId, volumeTitle, coverUrl) {
	// Set visible info
	calAddEls.title.innerText = `Add: ${volumeTitle}`;
	calAddEls.cover.src = coverUrl || '';
	calAddEls.cv_input.value = volumeCvId;
	calAddEls.special_state_input.value = 'auto';

	// Load user preferences
	const prefs = getLocalStorage(
		'monitor_new_volume', 'monitor_new_issues', 'monitoring_scheme'
	);
	calAddEls.monitor_volume_input.value = prefs.monitor_new_volume;
	calAddEls.monitor_issues_input.value = prefs.monitor_new_issues;
	calAddEls.monitoring_scheme.value = prefs.monitoring_scheme;

	// Reset submit button text
	calAddEls.submit.innerText = 'Add Volume';

	// Disable submit until folder name is generated
	calAddEls.submit.disabled = true;
	calAddEls.submit.innerText = 'Loading...';

	// Fetch full volume info from CV to generate folder name
	usingApiKey()
	.then(api_key => {
		return fetchAPI('/volumes/search', api_key, {
			query: `cv:${volumeCvId}`
		});
	})
	.then(json => {
		if (json.result.length > 0) {
			const vol = json.result[0];
			calAddEls.title_input.value = vol.title;
			calAddEls.year_input.value = vol.year || '';
			calAddEls.volume_number_input.value = vol.volume_number || 1;
			calAddEls.publisher_input.value = vol.publisher || '';

			// Generate folder name
			return usingApiKey().then(api_key =>
				sendAPI('POST', '/volumes/search', api_key, {}, {
					comicvine_id: volumeCvId,
					title: vol.title,
					year: vol.year,
					volume_number: vol.volume_number || 1,
					publisher: vol.publisher
				})
			);
		}
	})
	.then(response => {
		if (response) return response.json();
	})
	.then(json => {
		if (json) {
			generatedFolderName = json.result.folder;
			calAddEls.volume_folder_input.value = generatedFolderName;
		}
	})
	.finally(() => {
		calAddEls.submit.disabled = false;
		calAddEls.submit.innerText = 'Add Volume';
	});

	showWindow('cal-add-window');
};

function addVolumeFromCalendar() {
	showLoadWindow('cal-add-window');

	const volumeFolder = calAddEls.volume_folder_input.value;
	const data = {
		comicvine_id: parseInt(calAddEls.cv_input.value),
		root_folder_id: parseInt(calAddEls.root_folder_input.value),
		monitor: calAddEls.monitor_volume_input.value === 'true',
		monitoring_scheme: calAddEls.monitoring_scheme.value,
		monitor_new_issues: calAddEls.monitor_issues_input.value === 'true',
		volume_folder: '',
		special_version: calAddEls.special_state_input.value || null,
		auto_search: calAddEls.auto_search_input.checked
	};

	// Only set custom folder if user changed it
	if (volumeFolder !== '' && volumeFolder !== generatedFolderName) {
		data.volume_folder = volumeFolder;
	}

	setLocalStorage({
		monitor_new_volume: data.monitor,
		monitor_new_issues: data.monitor_new_issues,
		monitoring_scheme: data.monitoring_scheme
	});

	usingApiKey()
	.then(api_key =>
		sendAPI('POST', '/volumes', api_key, {}, data)
	)
	.then(response => response.json())
	.then(json => {
		closeWindow();
		// Reload the calendar to reflect the newly added volume
		loadWeek();
	})
	.catch(e => {
		if (e.status === 509) {
			calAddEls.submit.innerText = 'ComicVine API rate limit reached';
			showWindow('cal-add-window');
		} else if (e.status === 400) {
			calAddEls.submit.innerText = 'Volume folder is parent or child of other volume folder';
			showWindow('cal-add-window');
		} else {
			console.error('Failed to add volume:', e);
			closeWindow();
		}
	});
};

// Wire up the add form
calAddEls.form.action = 'javascript:addVolumeFromCalendar();';

function updateDayHeaders() {
	const days = calendarGrid.querySelectorAll('.calendar-day');
	const today = formatDate(new Date());

	days.forEach((dayEl, i) => {
		const date = new Date(currentMonday);
		date.setDate(currentMonday.getDate() + i);
		const dateStr = formatDate(date);

		dayEl.querySelector('.day-date').textContent = date.toLocaleDateString(
			'en-US', { month: 'short', day: 'numeric' }
		);
		dayEl.dataset.date = dateStr;

		if (dateStr === today) {
			dayEl.classList.add('today');
		} else {
			dayEl.classList.remove('today');
		}
	});

	weekLabel.textContent = formatWeekLabel(currentMonday);
};

function clearIssues() {
	calendarGrid.querySelectorAll('.day-issues').forEach(
		container => container.innerHTML = ''
	);
};

function renderIssues(issues) {
	clearIssues();

	// Always show the grid
	hide([loadingEl], [calendarGrid]);

	if (issues.length === 0) {
		emptyEl.classList.remove('hidden');
	} else {
		emptyEl.classList.add('hidden');
	}

	const api_key = getLocalStorage('api_key').api_key;

	issues.forEach(issue => {
		const dayEl = calendarGrid.querySelector(
			`.calendar-day[data-date="${issue.date}"]`
		);
		if (!dayEl) return;

		const entry = issueTemplate.cloneNode(true);

		if (issue.in_library && issue.volume_id) {
			// Library issue — link to volume page
			entry.href = `${url_base}/volumes/${issue.volume_id}`;
			entry.classList.add('in-library');
			if (issue.monitored) {
				entry.classList.add('monitored');
			}
		} else {
			// Non-library issue — open add volume window
			entry.href = '#';
			entry.classList.add('not-in-library');
			entry.onclick = e => {
				e.preventDefault();
				showAddVolumeWindow(
					issue.volume_comicvine_id,
					issue.volume_title,
					issue.cover
				);
			};
		}

		entry.setAttribute('aria-label',
			`${issue.volume_title} #${issue.issue_number}`
		);

		// Set cover image
		const cover = entry.querySelector('.calendar-issue-cover');
		if (issue.in_library && issue.volume_id) {
			cover.src = `${url_base}/api/volumes/${issue.volume_id}/cover?api_key=${api_key}`;
		} else if (issue.cover) {
			cover.src = issue.cover;
		}
		cover.alt = issue.volume_title;

		// Title
		entry.querySelector('.calendar-issue-title').textContent =
			issue.volume_title;

		// Issue number + title
		let issueLabel = `#${issue.issue_number}`;
		if (issue.issue_title) {
			issueLabel += ` - ${issue.issue_title}`;
		}
		entry.querySelector('.calendar-issue-number').textContent = issueLabel;

		dayEl.querySelector('.day-issues').appendChild(entry);
	});

	// Mark empty days for mobile hiding
	calendarGrid.querySelectorAll('.calendar-day').forEach(dayEl => {
		const issues = dayEl.querySelector('.day-issues');
		if (!issues || issues.children.length === 0) {
			dayEl.classList.add('empty-day');
		} else {
			dayEl.classList.remove('empty-day');
		}
	});
};

function loadWeek() {
	hide([calendarGrid, emptyEl], [loadingEl]);
	updateDayHeaders();

	const start = formatDate(currentMonday);
	const sunday = new Date(currentMonday);
	sunday.setDate(currentMonday.getDate() + 6);
	const end = formatDate(sunday);

	usingApiKey()
	.then(api_key =>
		fetchAPI('/calendar', api_key, { start: start, end: end })
	)
	.then(json => {
		renderIssues(json.result);
	})
	.catch(e => {
		console.error('Failed to load calendar:', e);
		hide([loadingEl], [calendarGrid]);
		emptyEl.classList.remove('hidden');
	});
};

// Navigation
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

// Initial load
usingApiKey().then(api_key => fillRootFolders(api_key));
loadWeek();
