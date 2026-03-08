/**
 * Background Service Worker for Job Application Autofill
 * Handles keyboard shortcuts and message routing
 */

/**
 * Inject content scripts into a tab if not already injected
 */
async function ensureContentScriptInjected(tabId) {
    try {
        // Try to ping the content script first
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        return true; // Content script is already running
    } catch (error) {
        // Content script not running, inject it
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['shared/validation.js', 'shared/storage.js', 'content/fieldDetector.js', 'content/content.js']
            });
            await chrome.scripting.insertCSS({
                target: { tabId },
                files: ['content/content.css']
            });
            // Wait a bit for scripts to initialize
            await new Promise(resolve => setTimeout(resolve, 100));
            return true;
        } catch (injectError) {
            console.error('Failed to inject content script:', injectError);
            return false;
        }
    }
}

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'trigger-autofill') {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab?.id) {
            try {
                // Ensure content script is injected
                const injected = await ensureContentScriptInjected(tab.id);
                if (!injected) {
                    throw new Error('Could not inject content script');
                }

                // Send message to content script to trigger autofill
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'triggerAutofill' });

                // Update badge to show action
                chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
                chrome.action.setBadgeBackgroundColor({ color: '#00c389', tabId: tab.id });

                // Clear badge after 2 seconds
                setTimeout(() => {
                    chrome.action.setBadgeText({ text: '', tabId: tab.id });
                }, 2000);
            } catch (error) {
                console.error('Failed to trigger autofill:', error);
                // Show error badge
                chrome.action.setBadgeText({ text: '!', tabId: tab.id });
                chrome.action.setBadgeBackgroundColor({ color: '#ff3d3d', tabId: tab.id });

                setTimeout(() => {
                    chrome.action.setBadgeText({ text: '', tabId: tab.id });
                }, 2000);
            }
        }
    }
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ pong: true });
        return true;
    }

    if (message.action === 'getTabId') {
        sendResponse({ tabId: sender.tab?.id });
        return true;
    }

    if (message.action === 'updateBadge') {
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.action.setBadgeText({
                text: message.text || '',
                tabId
            });
            if (message.color) {
                chrome.action.setBadgeBackgroundColor({
                    color: message.color,
                    tabId
                });
            }
        }
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'triggerAutofillFromPopup') {
        // Forward to the active tab's content script
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.id) {
                    sendResponse({ success: false, error: 'No active tab found' });
                    return;
                }

                // Ensure content script is injected
                const injected = await ensureContentScriptInjected(tab.id);
                if (!injected) {
                    sendResponse({ success: false, error: 'Could not connect to page. Try refreshing the page.' });
                    return;
                }

                const response = await chrome.tabs.sendMessage(tab.id, { action: 'triggerAutofill' });
                sendResponse(response);
            } catch (error) {
                sendResponse({ success: false, error: error.message || 'Failed to trigger autofill' });
            }
        })();
        return true; // Keep channel open for async response
    }

    return false;
});

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Open options page on first install for setup
        chrome.tabs.create({ url: 'popup/popup.html?setup=true' });
    }
});

// Update badge when tab changes to show if autofill is available
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (isJobSite(tab.url)) {
            // Check if user has completed setup
            const result = await chrome.storage.local.get(['jobAutofill_userData']);
            if (result.jobAutofill_userData) {
                chrome.action.setBadgeText({ text: '', tabId: activeInfo.tabId });
            }
        }
    } catch (error) {
        // Tab might not exist anymore
    }
});

/**
 * Check if URL is a likely job application site
 * @param {string} url 
 * @returns {boolean}
 */
function isJobSite(url) {
    if (!url) return false;

    const jobSitePatterns = [
        'linkedin.com',
        'indeed.com',
        'glassdoor.com',
        'lever.co',
        'greenhouse.io',
        'workday.com',
        'myworkdayjobs.com',
        'icims.com',
        'taleo.net',
        'smartrecruiters.com',
        'jobvite.com',
        'ziprecruiter.com',
        'monster.com',
        'careerbuilder.com',
        'dice.com',
        'hired.com',
        'angel.co',
        'wellfound.com',
        'ashbyhq.com',
        'bamboohr.com',
        'recruitee.com',
        'breezy.hr',
        'jazz.co',
        'jazzhr.com',
        'pinpointhq.com',
        'rippling.com',
        'applytojob.com',
        'workable.com',
        'fountain.com',
        'hirebridge.com',
        'paylocity.com',
        'paycom.com',
        'adp.com',
        'successfactors.com',
        'oraclecloud.com'
    ];

    const urlLower = url.toLowerCase();
    return jobSitePatterns.some(pattern => urlLower.includes(pattern)) ||
        urlLower.includes('career') ||
        urlLower.includes('jobs') ||
        urlLower.includes('apply');
}
