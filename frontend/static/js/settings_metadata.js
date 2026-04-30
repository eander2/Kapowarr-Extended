function fillSettings(api_key) {
	fetchAPI('/settings', api_key)
	.then(json => {
		document.querySelector('#date-type-input').value = json.result.date_type;
		document.querySelector('#locg-enabled-input').checked =
			!!json.result.locg_enabled;
		document.querySelector('#locg-crawl-delay-input').value =
			json.result.locg_crawl_delay_seconds || 30;
	});
};

function saveSettings(api_key) {
	document.querySelector("#save-button p").innerText = 'Saving';
	const delayRaw = parseInt(
		document.querySelector('#locg-crawl-delay-input').value, 10
	);
	const delay = Number.isFinite(delayRaw) && delayRaw >= 1 ? delayRaw : 30;
	const data = {
		'date_type': document.querySelector('#date-type-input').value,
		'locg_enabled': document.querySelector('#locg-enabled-input').checked,
		'locg_crawl_delay_seconds': delay
	};
	sendAPI('PUT', '/settings', api_key, {}, data)
	.then(response => response.json())
	.then(json => {
		document.querySelector("#save-button p").innerText = 'Saved';
	})
	.catch(e => {
		document.querySelector("#save-button p").innerText = 'Failed';
		console.log(e);
	});
};

// code run on load

usingApiKey()
.then(api_key => {
	fillSettings(api_key);
	document.querySelector('#save-button').onclick = e => saveSettings(api_key);
});
