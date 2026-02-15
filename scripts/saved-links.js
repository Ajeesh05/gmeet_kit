/**
 * @fileoverview Main script for saved meetings page
 *  
 * @author Ajeesh T
 * @version 1.0
 * @date 2024-09-16
 */


let links = [];

const linksContainer = document.getElementById('linksContainer');
const newLinkName = document.getElementById('newLinkName');
const newLinkUrl = document.getElementById('newLinkUrl');
const addLink = document.getElementById('addLinkDiv');

// Render the links
function renderLinks() {
    linksContainer.innerHTML = ''; // Clear the container first

    // For instant meeting item
    const instantMeet = document.createElement('div');
    instantMeet.className = 'link-item';
    instantMeet.innerHTML = `<a href="https://meet.google.com/new" target="_blank" class="link-name">instant meeting</a>`;
    linksContainer.appendChild(instantMeet);

    // Click listener for instant meeting
    instantMeet.addEventListener('click', function () {
        this.querySelector('a').click();
    });

    // If no link return false to avoid error
    if(!links)
        return false;

    // Looping through all links to render the saved meeting items
    links.forEach((link, index) => {
        // Creating a link item div
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';

        // If edit mode, render item with inputs, save and delete icon
        if (link.editing) {
            linkItem.innerHTML = `
                <input type="text" value="${link.name}" class="name-edit-input" id="editName${index}">
                <input type="text" value="${link.url}" class="link-edit-input" id="editUrl${index}">
                <button class="icon-btn save-icon" id="saveBtn${index}"></button>
                <button class="icon-btn delete-icon" id="deleteBtn${index}"></button>
            `;
        // If non-edit mode, render item with edit and delete icon
        } else {
            linkItem.innerHTML = `
                <a href="${link.url}" target="_blank" class="link-name">${link.name}</a>
                <button class="icon-btn edit-icon" id="editBtn${index}"></button>
                <button class="icon-btn delete-icon" id="deleteBtn${index}"></button>
            `;

            // Click listener for opening saved meetings
            linkItem.addEventListener('click', function (event) {

                const editIcon = this.querySelector('button[class="icon-btn edit-icon"]');
                const deleteIcon = this.querySelector('button[class="icon-btn delete-icon"]');

                const link = this.querySelector('a');

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

// Gets all checkboxes
const meetings = document.querySelectorAll('div[class="link-item"]');

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
            chrome.storage.sync.set(result);
        }
    });

    // Re-render the page without removed link
    renderLinks();
}

// Get the links from chrome storage and initial render
chrome.storage.sync.get('links', function (result) {

    links = result.links || [];

    // Filter the links array to remove empty values
    links = links.filter(item => {
        return item !== undefined && item !== null && item.name != '' && item.url != '';
    });

    // Save the filteres links
    chrome.storage.sync.set({links: links});

    // Render the page
    renderLinks();

});
