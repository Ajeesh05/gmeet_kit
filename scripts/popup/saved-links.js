/**
 * @fileoverview Main script for saved meetings page
 *  
 * @author Ajeesh T
 * @date 2024-09-16
 */


let links = [];

const linksContainer = document.getElementById('linksContainer');
const meetForLaterContainer = document.getElementById('meetForLaterContainer');
const recentMeetingsContainer = document.getElementById('recentMeetingsContainer');
const addLink = document.getElementById('addLinkDiv');
// Number of meeting urls to fetch to choose your meeting.
const fetchMeetingCount = 10;
// For controlling fetch meeting urls
let fetchController = null;

/**
 * Keeps a stored link navigable only if it is an ordinary web address.
 *
 * Saved links round-trip through chrome.storage.sync, so a javascript: url
 * saved once would come back as a clickable link inside the extension's own
 * origin on every device.
 *
 * @param {string} url
 *
 * @returns {string} the url, or "#" if it is not http(s)
 */
function safeMeetingUrl(url) {
    try {
        const parsed = new URL(url, 'https://meet.google.com');
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : '#';
    } catch (e) {
        return '#';
    }
}

// Render the links
function renderLinks() {
    linksContainer.innerHTML = ''; // Clear the container first

    // For instant meeting item
    const instantMeet = document.createElement('div');
    instantMeet.className = 'link-item';
    instantMeet.innerHTML = `
        <a href="https://meet.google.com/new" target="_blank" class="link-name">Start instant meeting</a>
        <img src="images/angle-small-right.svg" class="icon">
    `;
    linksContainer.appendChild(instantMeet);


    // For choose you meeting url page
    const generateMeet = document.createElement('div');
    generateMeet.className = 'link-item';
    generateMeet.innerHTML = `
        <a href="" target="_blank" class="link-name">Choose your meeting url</a>
        <img src="images/angle-small-right.svg" class="icon">
    `;
    linksContainer.appendChild(generateMeet);


    // For Last 10 meetings page
    const recentMeetings = document.createElement('div');
    recentMeetings.className = 'link-item';
    recentMeetings.innerHTML = `
        <a href="" target="_blank" class="link-name">Last 10 meetings</a>
        <img src="images/angle-small-right.svg" class="icon">
    `;
    linksContainer.appendChild(recentMeetings);


    // For sidepanel
    const sidePanel = document.createElement('div');
    sidePanel.className = 'link-item';
    sidePanel.innerHTML = `
        <a href="" target="_blank" class="link-name">Open transcript</a>
        <img src="images/angle-small-right.svg" class="icon">
    `;
    linksContainer.appendChild(sidePanel);
    setupSidePanelButton(sidePanel);


    const savedMeetings = document.createElement('div');
    savedMeetings.innerHTML = `<h3>Saved meetings<h3>`;
    linksContainer.appendChild(savedMeetings);


    // Click listener for instant meeting
    instantMeet.addEventListener('click', function () {
        this.querySelector('a').click();
    });

    // Fetch meeitng urls and append it.
    generateMeet.addEventListener('click', async function (event) {
        event.preventDefault();
        target.meetForLaterPage();
        fetchMeetsForLater(fetchMeetingCount);
    });

    // Get recent meetings and append it.
    recentMeetings.addEventListener('click', async function (event) {
        event.preventDefault();
        target.recentMeetingsPage();
        openRecentMeetings(fetchMeetingCount);
    });

    // If no link return false to avoid error
    if (!links)
        return false;

    // Looping through all links to render the saved meeting items
    links.forEach((link, index) => {
        // Creating a link item div
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';

        // If edit mode, render item with inputs, save and delete icon
        if (link.editing) {
            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = link.name;          // property, not an attribute in markup
            nameInput.placeholder = 'name';
            nameInput.className = 'name-edit-input';
            nameInput.id = `editName${index}`;

            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.value = link.url;
            urlInput.placeholder = 'url';
            urlInput.className = 'link-edit-input';
            urlInput.id = `editUrl${index}`;

            const saveBtn = document.createElement('button');
            saveBtn.className = 'icon-btn save-icon';
            saveBtn.id = `saveBtn${index}`;
            saveBtn.setAttribute('aria-label', 'save');

            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn delete-icon';
            delBtn.id = `deleteBtn${index}`;
            delBtn.setAttribute('aria-label', 'delete');

            linkItem.append(nameInput, urlInput, saveBtn, delBtn);

            linkItem.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    saveLink(index);
                }
            })


            // If non-edit mode, render item with edit and delete icon
        } else {
            const anchor = document.createElement('a');
            anchor.href = safeMeetingUrl(link.url);
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.className = 'link-name';
            anchor.textContent = link.name;       // text, never markup

            const editBtn = document.createElement('button');
            editBtn.className = 'icon-btn edit-icon';
            editBtn.id = `editBtn${index}`;
            editBtn.setAttribute('aria-label', 'edit');

            const delBtn = document.createElement('button');
            delBtn.className = 'icon-btn delete-icon';
            delBtn.id = `deleteBtn${index}`;
            delBtn.setAttribute('aria-label', 'delete');

            linkItem.append(anchor, editBtn, delBtn);

            // Click listener for opening saved meetings
            linkItem.addEventListener('click', function (event) {

                const editIcon = this.querySelector('button[class="icon-btn edit-icon"]');
                const deleteIcon = this.querySelector('button[class="icon-btn delete-icon"]');

                const link = this.querySelector('a');

                // To avoid opening meet while clicking edit or delete icon
                if (!(event.target === editIcon || event.target === deleteIcon))
                    link.click();

            });
        }

        linksContainer.appendChild(linkItem);

        // Add event listeners for edit, save, and delete
        if (link.editing) {
            document.getElementById(`saveBtn${index}`).addEventListener('click', () => saveLink(index));
        } else {
            document.getElementById(`editBtn${index}`).addEventListener('click', () => editLink(index));
        }
        document.getElementById(`deleteBtn${index}`).addEventListener('click', () => deleteLink(index));
    });
}

// Add a new link
addLink.addEventListener('click', () => {
    links.push({ name: '', url: '', editing: true });
    renderLinks();
});

/**
 * Edit a link (switch to edit mode)
 * 
 * @param {number} - index 
 */
function editLink(index) {
    links[index].editing = true;
    renderLinks();
}

/**
 * Save a link (after editing)
 * 
 * @param {number} - index 
 */
function saveLink(index) {
    const editName = document.getElementById(`editName${index}`).value.trim();
    const editUrl = document.getElementById(`editUrl${index}`).value.trim();

    // Save only if name and url is not empty
    if (editName && editUrl) {
        links[index].name = editName;
        links[index].url = editUrl;
        links[index].editing = false;

        // Get and sync the links to chrome storage
        chrome.storage.sync.get('links', function (result) {
            result.links = links || [];
            chrome.storage.sync.set(result);
        });

        // Re-render page with new link
        renderLinks();
    }
}

/**
 * Delete a link
 * 
 * @param {number} - index 
 */
function deleteLink(index) {

    // Remove the link
    links.splice(index, 1);

    // Get, remove and save the links
    chrome.storage.sync.get('links', function (result) {
        if (result.links && result.links[index]) {
            // Delete the removed link
            delete result.links[index];
            // Re-indexing the links array
            result.links = result.links.filter(() => true)
            // Store it into chrome storage.
            chrome.storage.sync.set(result);
        }
    });

    // Re-render the page without removed link
    renderLinks();
}


/**
 * Save a meeting from choose your meeting url page
 * 
 * @param {string} - name 
 * @param {url} - url
 */
function saveMeetForLater(name, url) {

    links.push({ name: name, url: url, editing: false });

    // Get and sync the links to chrome storage
    chrome.storage.sync.get('links', function (result) {
        result.links = links || [];
        chrome.storage.sync.set(result);
    });

    renderLinks();
}

/**
 * Copy the given text into clipboard
 * 
 * @param {string} - text 
 */
function copyToClipboard(text) {
    // Use the Clipboard API
    navigator.clipboard.writeText(text)
        .then(() => {
            console.log("Content copied to clipboard!");
        })
        .catch((err) => {
            console.error("Failed to copy: ", err);
        });
}

/**
 * fetch number of meetings to show on choose your meeting url page.
 * 
 * @async
 * @param {number} - count 
 */
async function fetchMeetsForLater(count) {

    // If a previous instance is running, abort it
    if (fetchController) {
        fetchController.abort(); // Abort ongoing fetches
    }

    // Create a new AbortController for the current instance
    fetchController = new AbortController();
    const signal = fetchController.signal;

    // Reset the choose meeting urls page.
    meetForLaterContainer.innerHTML = '';

    // Looping for fetching number of meeitng urls
    for (let i = 0; i < count; i++) {

        // Fetch a new meeting url
        const newMeetUrl = await fetchNewMeets(signal);

        // If the fetch is aborted, break the loop.
        if (newMeetUrl === 'AbortError')
            break;

        // Get the unique code part of the meeting url
        const newMeetName = newMeetUrl.replace("https://meet.google.com/", "");

        // If meeting url is not fetched, continue to next loop.
        if (!newMeetUrl)
            continue;

        // Creating a link item div
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';

        linkItem.innerHTML = `
            <a href="${newMeetUrl}" target="_blank" class="link-name">${newMeetName}</a>
            <button class="icon-btn copy-icon" id="copyMeetForLaterBtn${i}" aria-label="copy"></button>
            <button class="icon-btn save-icon" id="saveMeetForLaterBtn${i}" aria-label="save"></button>
        `;

        meetForLaterContainer.appendChild(linkItem);

        // Event listener for copying the url to clipboard
        document.getElementById(`copyMeetForLaterBtn${i}`).addEventListener('click', function () {
            copyToClipboard(newMeetUrl);
        });

        // Event listener for saving the meeting urls for later use
        document.getElementById(`saveMeetForLaterBtn${i}`).addEventListener('click', function () {
            saveMeetForLater(newMeetName, newMeetUrl);
            this.classList.remove('save-icon');
            this.classList.add('saved-icon');
            this.disabled = true;
        });
    }

}

/**
 * Fetch new meeting url.
 * 
 * @async
 * @param {signal} - signal 
 * @returns {url|string|null}
 */
async function fetchNewMeets(signal) {

    try {
        // Fetch instant meeting url
        const response = await fetch("https://meet.google.com/new", { signal: signal })

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // Get the response as text
        html = await response.text(); // Get the response as text (HTML)

        // Parse the HTML string into a DOM object
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Select all <script> elements
        const scripts = doc.querySelectorAll('script');

        // Extract meeting url from the html response
        return exctractMeetUrls(scripts);

    } catch (error) {

        // If aborted, return the error name to break the loop
        if (error.name === 'AbortError')
            return error.name

        console.error('Error fetching or processing URL:', error);

        // If exception catched, assume gmail account is not logged in and redirect to new meeting url to sign in.
        window.open('https://meet.google.com/new', '_blank')

        return null;
    }
}

/**
 * Extract meeting url from the provided array of scripts
 * 
 * @param {Array} - scripts 
 * @returns {url|null}
 */
function exctractMeetUrls(scripts) {

    // Define the regular expression for the meeting URL
    const meetingUrlRegex = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/;

    // Iterate through the array in reverse order
    for (let i = scripts.length - 1; i >= 0; i--) {
        const script = scripts[i].textContent;
        const match = script.match(meetingUrlRegex);

        // Return the first match found
        if (match)
            return match[0];
    }

    // If no match is found, return null or a default value
    return null;
}

/**
 * Generates recent meetings div
 * 
 * @async
 * @returns {void}
 */
async function openRecentMeetings() {

    const recentMeetings = await getRecentMeetings();

    recentMeetingsContainer.innerHTML = '';

    if (recentMeetings && recentMeetings.length == 0) {
        const linkItem = document.createElement('div');
        linkItem.innerHTML = `No recent meeting to display`;
        recentMeetingsContainer.appendChild(linkItem);
        return;
    }

    for (const meeting of recentMeetings) {

        // Creating a link item div
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';

        const anchor = document.createElement('a');
        anchor.href = `https://meet.google.com/${encodeURIComponent(meeting.id)}`;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'link-name';
        anchor.textContent = `${meeting.id} `;

        const ago = document.createElement('small');
        ago.className = 'time-ago';
        ago.textContent = `(${getTimeAgo(meeting.history?.[0]?.endTime)})`;
        anchor.appendChild(ago);

        const chevron = document.createElement('img');
        chevron.src = 'images/angle-small-right.svg';
        chevron.className = 'icon';

        linkItem.append(anchor, chevron);

        linkItem.addEventListener('click', function () {
            this.querySelector('a').click();
        });

        recentMeetingsContainer.appendChild(linkItem);

    }
}

// Check Chrome version & Meet URL — then update UI
async function setupSidePanelButton(linkItem) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const chromeVersion = parseInt(/Chrome\/(\d+)/.exec(navigator.userAgent)[1]);
    const isMeetURL = tab.url.startsWith("https://meet.google.com/");

    if (chromeVersion < 116) {
        // Disable — Chrome too old
        linkItem.classList.add("disabled-item");
        linkItem.title = "Transcript is not supported in Chrome versions below 116.";
        linkItem.onclick = (e) => e.preventDefault();
        return;
    }

    if (!isMeetURL) {
        // Disable — Not on a Meet page
        linkItem.classList.add("disabled-item");
        linkItem.title = "Transcript is only available on Google Meet pages.";
        linkItem.onclick = (e) => e.preventDefault();
        return;
    }

    // Enable click
    linkItem.onclick = (e) => {
        e.preventDefault();
        openSidePanel();
    };
}


/**
 * Opens side panal
 * 
 * @async
 * @returns {void}
 */
async function openSidePanel() {
    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Enable the side panel for that tab
        await chrome.sidePanel.setOptions({
            tabId: tab.id,
            path: "sidebar.html",
            enabled: true
        });

        // Open it — allowed because we are inside a popup click (user gesture)
        await chrome.sidePanel.open({ tabId: tab.id });

        window.close(); // optional: close popup once opened
    } catch (err) {
        console.error("Failed to open side panel:", err);
    }
}

/**
 * Get recent meetings from chrome storage
 * 
 * @async
 * @returns {Promise<void>} Resolves when the data retreived from chrome storage
 */
async function getRecentMeetings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get("recentMeetings", (data) => {
            const grouped = data.recentMeetings || {};

            // Convert to array with id included
            const meetings = Object.entries(grouped).map(([id, info]) => ({
                id,
                ...info
            }));

            // Sort by most recent meeting time (from history[0])
            meetings.sort((a, b) => {
                const timeA = new Date(a.history[0]?.endTime || 0).getTime();
                const timeB = new Date(b.history[0]?.endTime || 0).getTime();
                return timeB - timeA; // Descending (most recent first)
            });

            resolve(meetings);
        });
    });
}

/**
 * Calculates time ago for recent meetings
 * 
 * @param {string} - time 
 * @returns {string} - time ago
 */
function getTimeAgo(startTimeStr) {
    const then = new Date(startTimeStr).getTime();
    const now = Date.now();
    const diffMs = now - then;

    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const secs = totalSeconds % 60;
    const mins = minutes % 60;
    const hrs = hours % 24;

    if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        return `${hours} hr${hours > 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} min${minutes !== 1 ? 's' : ''} ${secs} sec${secs !== 1 ? 's' : ''} ago`;
    } else {
        return `${secs} sec${secs !== 1 ? 's' : ''} ago`;
    }
}

// Get the links from chrome storage and initial render
chrome.storage.sync.get('links', function (result) {

    links = result.links || [];

    // Filter the links array to remove empty values
    links = links.filter(item => {
        return item !== undefined && item !== null && item.name != '' && item.url != '';
    });

    // Save the filteres links
    chrome.storage.sync.set({ links: links });

    // Render the page
    renderLinks();

});

