/**
 * @fileoverview Holds scripts related to extension designs
 *
 * @author Ajeesh T
 * @date 2024-08-31
 */

// Gets all checkboxes
const checkboxDivs = document.querySelectorAll('div[class="checkbox-item"]');

// Click on the outer div to toggle checkbox.
checkboxDivs.forEach((div) => {
    div.addEventListener('click', function (event) {
        const checkbox = this.querySelector('input[type="checkbox"]');

        const label = this.querySelector('label[class="tgl-btn"]');

        // Toggle checkbox state only if the click wasn't directly on the checkbox itself
        if (!(event.target === checkbox || event.target === label))
            checkbox.click();

    });
});

// Uncheck disable-mic, if auto -mute is unchecked
document.getElementById('auto-mute').addEventListener("change", function () {

    if (!this.checked) {
        if (document.getElementById('disable-mic').checked == true)
            document.getElementById('disable-mic').click();
    }
});

// Checks and unchecks auto-mute and push-to-talk, if disable-mic is checked
document.getElementById('disable-mic').addEventListener("change", function () {

    if (this.checked) {
        if (document.getElementById('auto-mute').checked == false)
            document.getElementById('auto-mute').click();

        if (document.getElementById('push-to-talk').checked == true)
            document.getElementById('push-to-talk').click();
    }
});

// Unchecks disable-mic, if push-to-talk is checked
document.getElementById('push-to-talk').addEventListener("change", function () {

    if (this.checked) {
        if (document.getElementById('disable-mic').checked == true)
            document.getElementById('disable-mic').click();
    }
});

// Unchecks disable-camera, if auto-video-off id unchecked
document.getElementById('auto-video-off').addEventListener("change", function () {

    if (!this.checked) {
        if (document.getElementById('disable-camera').checked == true)
            document.getElementById('disable-camera').click();
    }
});

// Checks autp-video-off, if disable-camera is checked
document.getElementById('disable-camera').addEventListener("change", function () {

    if (this.checked) {
        if (document.getElementById('auto-video-off').checked == false)
            document.getElementById('auto-video-off').click();
    }
});


// Gets all checkboxe wrappers
const checkboxWrappers = document.querySelectorAll('.checkbox-wrapper-7');

// For accessing through tab and Enter or space to toggle checkbox
checkboxWrappers.forEach((div) => {
    const checkbox = div.querySelector("input[type=checkbox]");
    div.addEventListener('keydown', function (event) {
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault(); // Prevent page scrolling
            checkbox.checked = !checkbox.checked; // Toggle the checkbox state
        }
    });
});