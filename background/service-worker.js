/**
 * Background Service Worker for Job Application Autofill
 * Handles keyboard shortcuts and message routing
 */

/**
 * Inject content scripts into a tab if not already injected
 */
const CONTENT_SCRIPT_FILES = [
    'shared/validation.js',
    'shared/storage.js',
    'content/fieldDetector.js',
    'content/content.js'
];

const CONTENT_SCRIPT_CSS = ['content/content.css'];
const MESSAGE_TIMEOUT_MS = 1500;
const INJECTION_RETRY_COUNT = 8;
const INJECTION_RETRY_DELAY_MS = 150;
const USER_DATA_STORAGE_KEY = 'jobAutofill_userData';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendMessageWithTimeout(tabId, message, timeoutMs = MESSAGE_TIMEOUT_MS) {
    return await Promise.race([
        chrome.tabs.sendMessage(tabId, message),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Timed out waiting for ${message.action}`)), timeoutMs);
        })
    ]);
}

async function waitForContentScriptReady(tabId) {
    for (let attempt = 0; attempt < INJECTION_RETRY_COUNT; attempt += 1) {
        try {
            const response = await sendMessageWithTimeout(tabId, { action: 'ping' });
            if (response?.pong && response?.ready) {
                return true;
            }
        } catch (error) {
            if (attempt === INJECTION_RETRY_COUNT - 1) {
                throw error;
            }
        }

        await delay(INJECTION_RETRY_DELAY_MS);
    }

    return false;
}

async function ensureContentScriptInjected(tabId) {
    try {
        return await waitForContentScriptReady(tabId);
    } catch (error) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: CONTENT_SCRIPT_FILES
            });
            await chrome.scripting.insertCSS({
                target: { tabId },
                files: CONTENT_SCRIPT_CSS
            });

            return await waitForContentScriptReady(tabId);
        } catch (injectError) {
            console.error('Failed to inject content script:', injectError);
            return false;
        }
    }
}

async function triggerAutofillForTab(tabId) {
    const injected = await ensureContentScriptInjected(tabId);
    if (!injected) {
        return {
            success: false,
            error: 'Could not connect to the page. Try refreshing the page.'
        };
    }

    try {
        await sendMessageWithTimeout(tabId, { action: 'refreshRuntimeData' });
    } catch (error) {
        console.warn('Failed to refresh content-script runtime state before autofill:', error);
    }

    return await sendMessageWithTimeout(tabId, { action: 'triggerAutofill' }, 20000);
}

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'trigger-autofill') {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab?.id) {
            try {
                const response = await triggerAutofillForTab(tab.id);
                if (!response?.success) {
                    throw new Error(response?.error || 'Autofill failed');
                }

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

                const response = await triggerAutofillForTab(tab.id);
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
            const result = await chrome.storage.local.get([USER_DATA_STORAGE_KEY]);
            if (result[USER_DATA_STORAGE_KEY]) {
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
