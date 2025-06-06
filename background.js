// background.js - główna logika rozszerzenia (wersja z zapisywaniem pliku)

/**
 * Pobiera aktywną kartę w bieżącym oknie.
 * @returns {Promise<chrome.tabs.Tab|null>} Obiekt karty lub null, jeśli nie znaleziono.
 */
async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs.length > 0 ? tabs[0] : null;
}

// Nasłuchiwanie na wiadomości z innych części rozszerzenia
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        const tab = await getActiveTab();

        if (!tab) {
            showErrorNotification("Nie znaleziono aktywnej karty.", "Kliknij na kartę, której zrzut chcesz zrobić i spróbuj ponownie.");
            sendResponse({ status: 'error', message: 'No active tab found' });
            return;
        }
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('https://chrome.google.com')) {
            showErrorNotification("Ograniczenia przeglądarki.", "Nie można wykonać zrzutu ekranu na tej specjalnej stronie.");
            sendResponse({ status: 'error', message: 'Restricted URL' });
            return;
        }

        const format = request.format || 'png';

        switch (request.action) {
            case "captureVisible":
                await captureVisibleTab(tab, format, sendResponse);
                break;
            case "captureFull":
                sendResponse({ status: 'started' });
                await captureFullPage(tab, format);
                break;
            case "initiateAreaSelection":
                await initiateAreaSelection(tab, sendResponse);
                break;
            case "captureArea":
                await captureSelectedArea(request.area, tab, format, sendResponse);
                break;
        }
    })();
    return true;
});


// --- FUNKCJE PRZECHWYTYWANIA ---

async function captureVisibleTab(tab, format, sendResponse) {
    try {
        const options = { format: format === 'jpg' ? 'jpeg' : 'png' };
        if (options.format === 'jpeg') options.quality = 92;
        const dataUrl = await chrome.tabs.captureVisibleTab(null, options);
        if (handleCaptureError(sendResponse)) return;
        saveImage(dataUrl, format); // Zmieniono z openInNewTab
        sendResponse({ status: 'complete' });
    } catch (e) {
        console.error("Błąd przechwytywania widoku:", e);
        showErrorNotification("Błąd przechwytywania widoku.", e.message);
        if (sendResponse) sendResponse({ status: 'error', message: e.message });
    }
}

async function initiateAreaSelection(tab, sendResponse) {
    try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
        sendResponse({ status: 'injected' });
    } catch (e) {
        console.error("Błąd wstrzykiwania content_script:", e);
        showErrorNotification('Błąd inicjacji zaznaczania.', 'Odśwież kartę i spróbuj ponownie.');
        sendResponse({ status: 'error', message: e.message });
    }
}

async function captureSelectedArea(area, tab, format, sendResponse) {
    try {
        await new Promise(resolve => setTimeout(resolve, 150));
        const captureOptions = { format: format === 'jpg' ? 'jpeg' : 'png' };
        if (captureOptions.format === 'jpeg') captureOptions.quality = 92;
        const dataUrl = await chrome.tabs.captureVisibleTab(null, captureOptions);
        if (handleCaptureError(sendResponse)) return;

        const canvas = new OffscreenCanvas(area.width, area.height);
        const ctx = canvas.getContext('2d');
        const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
        ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

        const blobOptions = { type: `image/${format === 'jpg' ? 'jpeg' : 'png'}` };
        if (blobOptions.type === 'image/jpeg') blobOptions.quality = 0.92;
        const blob = await canvas.convertToBlob(blobOptions);
        const croppedDataUrl = await blobToDataURL(blob);

        saveImage(croppedDataUrl, format); // Zmieniono z openInNewTab
        sendResponse({ status: 'complete' });
    } catch (e) {
        console.error("Błąd przycinania obrazu:", e);
        showErrorNotification("Wystąpił błąd podczas przycinania obrazu.", e.message);
        sendResponse({ status: 'error', message: e.toString() });
    }
}

async function captureFullPage(tab, format) {
    const notificationId = `capture-progress-${Date.now()}`;
    let originalScrollY;
    try {
        showProgressNotification(notificationId, 'Rozpoczynanie przechwytywania...');
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({ totalWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth), totalHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), viewportHeight: window.innerHeight, originalScrollY: window.scrollY })
        });
        if (!result) throw new Error("Nie udało się pobrać wymiarów strony.");

        const { totalWidth, totalHeight, viewportHeight } = result;
        originalScrollY = result.originalScrollY;

        const captureOptions = { format: format === 'jpg' ? 'jpeg' : 'png' };
        if (captureOptions.format === 'jpeg') captureOptions.quality = 92;

        if (totalHeight <= viewportHeight) {
            showProgressNotification(notificationId, 'Strona mieści się w oknie, robię zrzut...');
            const dataUrl = await chrome.tabs.captureVisibleTab(null, captureOptions);
            if (!chrome.runtime.lastError) saveImage(dataUrl, format);
            chrome.notifications.clear(notificationId);
            return;
        }
        
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.scrollTo(0, 0) });
        const canvas = new OffscreenCanvas(totalWidth, totalHeight);
        const ctx = canvas.getContext('2d');
        
        for (let y = 0; y < totalHeight; y += viewportHeight) {
            const progress = Math.round((y / totalHeight) * 100);
            showProgressNotification(notificationId, `Przechwytywanie... ${progress}%`);
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (newY) => window.scrollTo(0, newY), args: [y] });
            await new Promise(resolve => setTimeout(resolve, 550));
            const dataUrl = await chrome.tabs.captureVisibleTab(null, captureOptions);
            if (chrome.runtime.lastError) throw new Error(chrome.runtime.lastError.message);
            const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
            ctx.drawImage(img, 0, y);
        }

        showProgressNotification(notificationId, 'Składanie obrazu...');
        const blobOptions = { type: `image/${format === 'jpg' ? 'jpeg' : 'png'}` };
        if (blobOptions.type === 'image/jpeg') blobOptions.quality = 0.92;
        const blob = await canvas.convertToBlob(blobOptions);
        const fullPageDataUrl = await blobToDataURL(blob);

        saveImage(fullPageDataUrl, format); // Zmieniono z openInNewTab
        chrome.notifications.clear(notificationId);
    } catch (e) {
        console.error("Błąd podczas przechwytywania całej strony:", e);
        showErrorNotification(`Wystąpił błąd: ${e.message}`, "Spróbuj odświeżyć stronę.");
        chrome.notifications.clear(notificationId);
    } finally {
        if (originalScrollY !== undefined) {
             await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: (y) => window.scrollTo(0, y), args: [originalScrollY] });
        }
    }
}


// --- FUNKCJE POMOCNICZE ---

function getFormattedDateTimeString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function saveImage(dataUrl, format) {
    const filename = `screen_shoot_${getFormattedDateTimeString()}.${format}`;
    chrome.downloads.download({
        url: dataUrl,
        filename: filename
    });
}

function handleCaptureError(sendResponse) {
    if (chrome.runtime.lastError) {
        console.error("Błąd przechwytywania:", chrome.runtime.lastError);
        showErrorNotification(`Błąd przechwytywania`, chrome.runtime.lastError.message);
        if (sendResponse) sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
        return true;
    }
    return false;
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function showProgressNotification(id, message) {
    chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Przechwytywanie strony',
        message: message,
        silent: true
    });
}

function showErrorNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: title,
        message: message
    });
}
